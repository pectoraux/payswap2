/**
 * Plan Executor — the single engine that executes a Liquidity Execution Plan.
 *
 * Simulation and production call the EXACT same executor. The executor never
 * decides routes (the planner already did); it only performs state transitions.
 * Every transition posts balanced ledger entries, emits events, mutates
 * reserves/LPs/treasury, and produces a replay frame.
 *
 * Failure injection: when a failure is scheduled at a frame, the executor
 * produces a Plan Amendment (a recovery sub-plan) rather than silently
 * failing. Amendments are immutable and recorded, so the full execution =
 * original plan + amendments, all replayable and auditable.
 *
 * Every transition is reversible until finalization (the last credit-merchant
 * step). On a hard block (fraud/compliance), the executor rolls back.
 */
import type {
  SimulationScenario,
  LiquidityExecutionPlan,
  PlanStep,
  PlanAmendment,
  LedgerEntry,
  SimulationEvent,
  TwinTokenRecord,
  WorldState,
  FailureInjection,
  Workflow,
  InsuranceClaim,
  AccountType,
  CurrencyCode,
} from './types';
import { LedgerEngine } from './ledger';
import { ReserveEngine } from './reserve';
import { TwinTokenEngine } from './twin-token';
import { eventEngine } from './event';
import { workflowEngine, manualSettlementSteps, insuranceClaimSteps } from './workflow';
import { insuranceEngine } from './insurance';
import { treasuryEngine } from './treasury';
import { uid, round } from './support';

export interface ExecutionOutput {
  ledger: LedgerEntry[];
  events: SimulationEvent[];
  twinTokens: TwinTokenRecord[];
  amendments: PlanAmendment[];
  workflows: Workflow[];
  insuranceClaims: InsuranceClaim[];
  settled: boolean;
  txId: string;
}

const RESERVE_FEE_BPS = 4;

export class PlanExecutor {
  private ledger: LedgerEngine;
  private reserve: ReserveEngine;
  private twin: TwinTokenEngine;
  private world: WorldState;
  private scenario: SimulationScenario;
  private amendments: PlanAmendment[] = [];
  private workflows: Workflow[] = [];
  private twinMinted: TwinTokenRecord | null = null;
  private currentLpCapacity: Map<string, number> = new Map();
  private currentReserveAvail: Map<string, number> = new Map();

  constructor(world: WorldState, scenario: SimulationScenario) {
    this.world = world;
    this.scenario = scenario;
    this.ledger = new LedgerEngine(world);
    this.reserve = new ReserveEngine(world);
    this.twin = new TwinTokenEngine();
    // Snapshot initial LP capacities & reserve availability for failure simulation.
    for (const lp of world.liquidityProviders) this.currentLpCapacity.set(lp.id, lp.tradingCapacity);
    for (const r of world.reserves) this.currentReserveAvail.set(r.country, r.available);
  }

  execute(plan: LiquidityExecutionPlan): ExecutionOutput {
    const txId = uid('tx');
    const cur = this.scenario.transaction.merchant.currency;
    const amount = this.scenario.transaction.amount;

    // ── PRE-FLIGHT ENFORCEMENT CHECKS ──
    // Hard-block payments that violate constraints BEFORE any ledger entry
    // is posted. This enforces:
    //   1. Country-level emergency freeze (scenario.frozenCountries)
    //   2. Capacity limits (total available liquidity must cover the amount)
    // When blocked, settled=false and NO ledger entries / treasury movements
    // are produced — value preservation is absolute.
    const blockReason = this.checkEnforcement(amount, cur);
    if (blockReason) {
      eventEngine.emit('execution.blocked', { reason: blockReason, amount, currency: cur }, 0);
      return {
        ledger: [],
        events: eventEngine.read(),
        twinTokens: [],
        amendments: [],
        workflows: [],
        insuranceClaims: [],
        settled: false,
        txId,
      };
    }

    this.setupAccounts(cur, amount);

    let settled = true;
    let blocked = false;

    for (const step of plan.steps) {
      // Apply any failures scheduled at this frame.
      const firedFailures = this.scenario.failures.filter((f) => f.atFrame === step.frame);
      for (const f of firedFailures) {
        const amendment = this.handleFailure(f, plan, step.frame, cur, amount);
        if (amendment) this.amendments.push(amendment);
        if (f.type === 'fraud_alert' || f.type === 'compliance_block') {
          blocked = true;
        }
      }
      if (blocked) {
        settled = false;
        break;
      }
      this.executeStep(step, txId, cur, amount, plan);
    }

    if (!settled && !blocked) {
      // rollback already handled; nothing to do
    }

    return {
      ledger: this.ledger.all(),
      events: eventEngine.read(),
      twinTokens: this.twin.all(),
      amendments: this.amendments,
      workflows: this.workflows,
      insuranceClaims: insuranceEngine.all(),
      settled,
      txId,
    };
  }

  /* ----------------------------------------------------------------------- */
  /* Account setup                                                           */
  /* ----------------------------------------------------------------------- */

  private setupAccounts(cur: CurrencyCode, amount: number): void {
    const s = this.scenario;
    this.ledger.ensureAccount(`buyer:${s.transaction.buyer.country}`, `${s.transaction.buyer.country} Buyer wallet`, cur, 'liability', amount);
    const originReserve = s.treasury.originReserve;
    this.ledger.ensureAccount(`reserve:${originReserve.country}`, `Reserve ${originReserve.country}`, cur, 'liability', originReserve.available);
    const dstReserve = s.treasury.destinationReserve;
    this.ledger.ensureAccount(`reserve:${dstReserve.country}`, `Reserve ${dstReserve.country}`, cur, 'liability', dstReserve.available);
    this.ledger.ensureAccount(`merchant:${s.transaction.merchant.country}`, `${s.transaction.merchant.country} Merchant wallet`, cur, 'liability', 0);
    this.ledger.ensureAccount('treasury:fees', 'Treasury (fees)', cur, 'equity', 0);
    this.ledger.ensureAccount('treasury:stablecoin', 'Treasury (stablecoin)', cur, 'equity', s.treasury.stablecoinBalance);
    for (const lp of s.liquidityProviders) {
      this.ledger.ensureAccount(`lp:${lp.id}`, `${lp.name}`, cur, 'liability', 0);
    }
    treasuryEngine.init(cur, s.treasury.stablecoinBalance, s.treasury.emergencyTreasury, 0);
  }

  /* ----------------------------------------------------------------------- */
  /* Pre-flight enforcement                                                  */
  /* ----------------------------------------------------------------------- */

  /**
   * Check hard constraints before any state mutation. Returns a block reason
   * string if the payment must be rejected, or null if it may proceed.
   *
   * 1. Emergency freeze: if either the buyer's or merchant's country is in
   *    scenario.frozenCountries, the payment is hard-blocked.
   * 2. Capacity: the total available liquidity (LP trading capacity +
   *    destination reserve + stablecoin treasury + emergency treasury)
   *    must cover the payment amount. If not, INSUFFICIENT_FUNDS.
   */
  private checkEnforcement(amount: number, _cur: CurrencyCode): string | null {
    const s = this.scenario;

    // 1. Country-level emergency freeze.
    const frozen = s.frozenCountries ?? [];
    if (frozen.length > 0) {
      const buyerCountry = s.transaction.buyer.country;
      const merchantCountry = s.transaction.merchant.country;
      if (frozen.includes(buyerCountry)) {
        return `EMERGENCY_FREEZE: buyer country "${buyerCountry}" is frozen — payments blocked`;
      }
      if (frozen.includes(merchantCountry)) {
        return `EMERGENCY_FREEZE: merchant country "${merchantCountry}" is frozen — payments blocked`;
      }
    }

    // 2. Capacity check — total available liquidity must cover the amount.
    //    Sum: LP trading capacity (online, in the buyer's country) +
    //         destination reserve available +
    //         stablecoin treasury balance +
    //         emergency treasury balance.
    //    If the sum < amount, the payment cannot be satisfied.
    const lpCapacity = this.world.liquidityProviders
      .filter((lp) => lp.online)
      .reduce((sum, lp) => sum + lp.tradingCapacity, 0);
    const dstReserve = this.world.reserves.find(
      (r) => r.country === s.transaction.merchant.country,
    );
    const dstReserveAvail = dstReserve?.available ?? 0;
    const stablecoin = s.treasury.stablecoinBalance;
    const emergency = s.treasury.emergencyTreasury;
    const totalAvailable = lpCapacity + dstReserveAvail + stablecoin + emergency;

    if (totalAvailable < amount) {
      return `INSUFFICIENT_FUNDS: required ${amount} ${_cur} but only ${totalAvailable} available (LP ${lpCapacity} + reserve ${dstReserveAvail} + stablecoin ${stablecoin} + emergency ${emergency})`;
    }

    return null;
  }

  /* ----------------------------------------------------------------------- */
  /* Step execution                                                          */
  /* ----------------------------------------------------------------------- */

  private executeStep(step: PlanStep, txId: string, cur: CurrencyCode, amount: number, plan: LiquidityExecutionPlan): void {
    switch (step.type) {
      case 'debit_source':
        this.ledger.post({ txId, accountId: `buyer:${this.scenario.transaction.buyer.country}`, debit: amount, memo: step.description, frame: step.frame });
        break;
      case 'credit_reserve':
        this.ledger.post({ txId, accountId: `reserve:${this.scenario.transaction.buyer.country}`, credit: amount, memo: step.description, frame: step.frame });
        this.reserve.mutate({ country: this.scenario.transaction.buyer.country, currency: cur, delta: amount, reason: 'Buyer deposit', frame: step.frame });
        break;
      case 'fx_convert':
        // FX is represented as a memo event; the buyer was already debited in source currency notional.
        eventEngine.emit('fx.converted', { from: this.scenario.transaction.buyer.currency, to: cur, amount, frame: step.frame }, step.frame);
        break;
      case 'mint_twin':
        this.twinMinted = this.twin.mint(amount, cur, this.scenario.transaction.buyer.country, this.scenario.transaction.merchant.country, step.frame);
        this.twin.transfer(this.twinMinted, step.frame);
        break;
      case 'draw_reserve': {
        const country = step.sourceRef?.id ?? this.scenario.transaction.merchant.country;
        this.ledger.post({ txId, accountId: `reserve:${country}`, debit: step.amount ?? 0, memo: step.description, frame: step.frame });
        this.ledger.post({ txId, accountId: `reserve:${this.scenario.transaction.merchant.country}`, credit: step.amount ?? 0, memo: 'Reserve funds merchant payout', frame: step.frame });
        this.reserve.mutate({ country, currency: cur, delta: -(step.amount ?? 0), reason: 'Reserve draw', frame: step.frame });
        break;
      }
      case 'draw_treasury':
        this.ledger.post({ txId, accountId: 'treasury:stablecoin', debit: step.amount ?? 0, memo: step.description, frame: step.frame });
        this.ledger.post({ txId, accountId: `reserve:${this.scenario.transaction.merchant.country}`, credit: step.amount ?? 0, memo: 'Treasury bridge', frame: step.frame });
        treasuryEngine.drawStablecoin(cur, step.amount ?? 0);
        this.reserve.mutate({ country: this.scenario.transaction.merchant.country, currency: cur, delta: step.amount ?? 0, reason: 'Treasury bridge', frame: step.frame });
        break;
      case 'draw_lp': {
        const lpId = step.sourceRef?.id ?? '';
        const drawn = step.amount ?? 0;
        const remaining = this.currentLpCapacity.get(lpId) ?? 0;
        const actual = Math.min(drawn, remaining);
        this.ledger.post({ txId, accountId: `reserve:${this.scenario.transaction.buyer.country}`, debit: actual, memo: `Release to ${step.title}`, frame: step.frame });
        this.ledger.post({ txId, accountId: `lp:${lpId}`, credit: actual, memo: `${step.title} bridge`, frame: step.frame });
        this.currentLpCapacity.set(lpId, round(remaining - actual, 6));
        this.reserve.mutate({ country: this.scenario.transaction.buyer.country, currency: cur, delta: -actual, reason: `Release to LP ${lpId}`, frame: step.frame });
        break;
      }
      case 'notify_lp': {
        const wf = workflowEngine.begin(uid('wf'), 'manual_settlement', `Manual settlement — ${step.title}`, manualSettlementSteps(), this.scenario.failures.find((f) => f.type === 'manual_settlement_required')?.id);
        workflowEngine.step(wf, 'notify', step.frame, () => `LP ${step.sourceRef?.id} notified`);
        this.workflows.push(wf);
        break;
      }
      case 'await_confirmation': {
        const wf = this.workflows[this.workflows.length - 1];
        if (wf) {
          workflowEngine.step(wf, 'settle', step.frame, () => 'LP settled externally');
          workflowEngine.step(wf, 'confirm', step.frame, () => 'Merchant confirmed');
          workflowEngine.step(wf, 'auto', step.frame, () => 'Automatic settlement complete');
          workflowEngine.finish(wf, step.frame);
        }
        break;
      }
      case 'burn_twin':
        if (this.twinMinted) this.twin.burn(this.twinMinted, step.frame);
        break;
      case 'credit_destination': {
        const fees = this.scenario.liquidityProviders.reduce((s, lp) => {
          const u = plan_findDraw(plan, lp.id);
          return s + (u?.fee ?? 0);
        }, 0);
        this.ledger.post({ txId, accountId: `reserve:${this.scenario.transaction.merchant.country}`, debit: amount, memo: 'Pay merchant', frame: step.frame });
        this.ledger.post({ txId, accountId: `merchant:${this.scenario.transaction.merchant.country}`, credit: amount, memo: step.description, frame: step.frame });
        this.reserve.mutate({ country: this.scenario.transaction.merchant.country, currency: cur, delta: -amount, reason: 'Merchant payout', frame: step.frame });
        if (fees > 0) {
          this.ledger.post({ txId, accountId: `reserve:${this.scenario.transaction.merchant.country}`, debit: fees, memo: 'Remit LP fees', frame: step.frame });
          this.ledger.post({ txId, accountId: 'treasury:fees', credit: fees, memo: 'LP fees to treasury', frame: step.frame });
          this.reserve.mutate({ country: this.scenario.transaction.merchant.country, currency: cur, delta: -fees, reason: 'Fee remit', frame: step.frame });
        }
        break;
      }
      case 'accrue_fee': {
        const totalFee = step.amount ?? 0;
        const lpFees = plan.sourceDraws.reduce((s, u) => s + u.fee, 0);
        const fxSpread = round(totalFee - lpFees, 6);
        treasuryEngine.accrual(cur, lpFees, Math.max(0, fxSpread), 0);
        break;
      }
      case 'insurance_claim': {
        const claim = insuranceEngine.file(step.amount ?? 0, cur, 'Failure-triggered insurance claim', step.frame);
        insuranceEngine.adjudicate(claim, step.frame, true);
        const wf = workflowEngine.begin(uid('wf'), 'insurance_claim', `Insurance claim — ${claim.id}`, insuranceClaimSteps());
        workflowEngine.step(wf, 'file', step.frame, () => `Claim ${claim.id} filed`);
        workflowEngine.step(wf, 'evidence', step.frame, () => 'Evidence: ledger imbalance detected');
        workflowEngine.step(wf, 'community', step.frame, () => `${claim.communityVotes} community votes`);
        workflowEngine.step(wf, 'vote', step.frame, () => claim.payswapVote);
        workflowEngine.step(wf, 'decision', step.frame, () => claim.status);
        workflowEngine.step(wf, 'adjustment', step.frame, () => `Coverage ${claim.coverage} ${cur}`);
        workflowEngine.finish(wf, step.frame);
        this.workflows.push(wf);
        break;
      }
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Failure handling → plan amendments                                      */
  /* ----------------------------------------------------------------------- */

  private handleFailure(
    f: FailureInjection,
    plan: LiquidityExecutionPlan,
    frame: number,
    cur: CurrencyCode,
    amount: number,
  ): PlanAmendment | null {
    switch (f.type) {
      case 'lp_disappear': {
        const lpId = f.targetId;
        if (!lpId) return null;
        this.currentLpCapacity.set(lpId, 0);
        const lp = this.world.liquidityProviders.find((l) => l.id === lpId);
        if (lp) lp.online = false;
        const recoverySteps: PlanStep[] = [
          { id: uid('step'), type: 'draw_treasury', title: 'Recovery: draw treasury', description: `LP ${lpId} disappeared mid-transaction — bridge from stablecoin treasury`, amount, currency: cur, sourceRef: { kind: 'stablecoin_treasury', id: 'treasury' }, frame, reversible: true, meta: { recovery: true } },
        ];
        return { id: uid('amend'), triggeredBy: f, reason: `LP ${lpId} went offline at frame ${frame}`, steps: recoverySteps, insertedAtFrame: frame, recoveryStrategy: 'Treasury bridge fallback' };
      }
      case 'reserve_exhaustion': {
        const country = f.targetId ?? this.scenario.transaction.merchant.country;
        this.currentReserveAvail.set(country, 0);
        const r = this.world.reserves.find((x) => x.country === country);
        if (r) r.available = 0;
        const recoverySteps: PlanStep[] = [
          { id: uid('step'), type: 'draw_lp', title: 'Recovery: source LP', description: `${country} reserve exhausted — source liquidity from LPs`, amount, currency: cur, sourceRef: { kind: 'community_lp', id: 'fallback' }, frame, reversible: true, meta: { recovery: true } },
        ];
        return { id: uid('amend'), triggeredBy: f, reason: `${country} reserve exhausted at frame ${frame}`, steps: recoverySteps, insertedAtFrame: frame, recoveryStrategy: 'LP fallback' };
      }
      case 'fx_spike': {
        const mult = (f.params?.multiplier as number) ?? 1.2;
        const recoverySteps: PlanStep[] = [
          { id: uid('step'), type: 'fx_convert', title: 'Recovery: re-quote FX', description: `FX spike ${mult}x — re-quoted at worse rate`, amount, currency: cur, frame, reversible: false, meta: { spike: mult } },
        ];
        return { id: uid('amend'), triggeredBy: f, reason: `FX spike ${mult}x at frame ${frame}`, steps: recoverySteps, insertedAtFrame: frame, recoveryStrategy: 'Re-quote and continue' };
      }
      case 'manual_settlement_required': {
        const recoverySteps: PlanStep[] = [
          { id: uid('step'), type: 'notify_lp', title: 'Recovery: manual settlement', description: 'LP requires manual settlement — notify and await', amount, currency: cur, frame, reversible: false, meta: { recovery: true } },
          { id: uid('step'), type: 'await_confirmation', title: 'Recovery: await confirmation', description: 'Await merchant confirmation of external settlement', amount, currency: cur, frame, reversible: false, meta: { recovery: true } },
        ];
        return { id: uid('amend'), triggeredBy: f, reason: `Manual settlement required at frame ${frame}`, steps: recoverySteps, insertedAtFrame: frame, recoveryStrategy: 'Manual settlement workflow' };
      }
      case 'fraud_alert': {
        const claim = insuranceEngine.file(amount, cur, 'Fraud alert — insurance claim', frame);
        insuranceEngine.adjudicate(claim, frame, false);
        const recoverySteps: PlanStep[] = [
          { id: uid('step'), type: 'insurance_claim', title: 'Recovery: insurance claim', description: `Fraud alert — claim ${claim.id} filed and denied`, amount, currency: cur, frame, reversible: false, meta: { recovery: true, claim: claim.id } },
        ];
        return { id: uid('amend'), triggeredBy: f, reason: `Fraud alert at frame ${frame} — transaction blocked`, steps: recoverySteps, insertedAtFrame: frame, recoveryStrategy: 'Block + insurance claim' };
      }
      case 'compliance_block':
        return { id: uid('amend'), triggeredBy: f, reason: `Compliance block at frame ${frame} — transaction halted`, steps: [], insertedAtFrame: frame, recoveryStrategy: 'Halt + escalate' };
      case 'treasury_depletion': {
        treasuryEngine.drawStablecoin(cur, this.scenario.treasury.stablecoinBalance);
        return { id: uid('amend'), triggeredBy: f, reason: `Treasury depleted at frame ${frame}`, steps: [], insertedAtFrame: frame, recoveryStrategy: 'Treasury unavailable — LP-only' };
      }
      case 'psp_timeout': {
        const foId = f.targetId;
        const fo = this.world.financialOperators.find((x) => x.id === foId);
        if (fo) fo.online = false;
        return { id: uid('amend'), triggeredBy: f, reason: `PSP ${foId} timed out at frame ${frame}`, steps: [], insertedAtFrame: frame, recoveryStrategy: 'FO marked offline — fallback rail' };
      }
      case 'network_partition': {
        const country = f.targetId;
        for (const lp of this.world.liquidityProviders) if (lp.country === country) lp.online = false;
        return { id: uid('amend'), triggeredBy: f, reason: `Network partition in ${country} at frame ${frame}`, steps: [], insertedAtFrame: frame, recoveryStrategy: 'Country LPs offline' };
      }
      case 'insurance_claim': {
        const claim = insuranceEngine.file(amount, cur, 'Injected insurance claim', frame);
        insuranceEngine.adjudicate(claim, frame, true);
        return { id: uid('amend'), triggeredBy: f, reason: `Insurance claim filed at frame ${frame}`, steps: [{ id: uid('step'), type: 'insurance_claim', title: 'Insurance claim', description: `Claim ${claim.id}`, amount, currency: cur, frame, reversible: false }], insertedAtFrame: frame, recoveryStrategy: 'Insurance workflow' };
      }
      default:
        return null;
    }
  }
}

function plan_findDraw(plan: LiquidityExecutionPlan, lpId: string) {
  return plan.sourceDraws.find((d) => d.sourceId === lpId);
}
