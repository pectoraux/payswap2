/**
 * CompilerPass — the uniform interface every compiler pass conforms to. (M-RT-8.)
 *
 * Every pass is:
 *   - PURE: same plan + same context → same output. No side effects.
 *   - ENRICHING: it only adds to the plan; never mutates runtime state or events.
 *   - INSPECTABLE: it returns a CompilationPassResult (Decision + timing).
 *   - ADDITIVE: cost components are preserved individually, not collapsed.
 *
 * The compiler becomes a deterministic pipeline of independent transformations:
 *   ExecutionPlan → Pass.execute() → Updated ExecutionPlan + CompilationPassResult
 *
 * This makes it straightforward to: replay individual passes, benchmark pass
 * performance, replace implementations, and insert new optimization passes
 * without changing the compiler's public contract.
 */

import type { ExecutionPlan, CompilationPassResult, CompilationPassName } from './types';
import type { RealCompilerContext } from './real-compiler';

/** The result of executing one pass. */
export interface PassResult {
  /** The enriched plan (pass may add fields). */
  plan: ExecutionPlan;
  /** The pass artifact for the Inspector. */
  result: CompilationPassResult;
  /** If false, the pass rejected the plan (e.g. policy violation). Compilation stops. */
  continue: boolean;
  /** If !continue, why. */
  rejectionReason?: string;
}

/**
 * The uniform compiler pass interface.
 * Every pass conforms to this — the compiler is a pipeline of these.
 */
export interface CompilerPass {
  readonly name: CompilationPassName;
  /** Execute the pass on a plan, returning the enriched plan + artifact. */
  execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): Promise<PassResult> | PassResult;
}

// ─── Pass implementations ───────────────────────────────────────────────────

import type { Decision } from '../decisions/types';
import { decision } from '../decisions/types';
import type { RoutingResult, RouteScoreComponents } from '../engines/routing/types';
import type { ReserveMarketSnapshot } from '../engines/reserve-market-v2/types';
import type { Quote } from '../engines/liquidity-marketplace/types';
import type { CostDecomposition } from '../integration/types';

/** Pass: resolve_identities — validates the intent has resolved subject + desired. */
export class ResolveIdentitiesPass implements CompilerPass {
  readonly name = 'resolve_identities' as const;

  execute(plan: ExecutionPlan, _ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): PassResult {
    const start = _ctx.clock.now();
    const resolved = !!(intent.subject && intent.desired);
    const dec = decision({
      kind: 'other', stage: 'resolve_identities', subject: intent.id,
      choice: resolved ? 'resolved' : 'unresolved',
      score: resolved ? 1 : 0, confidence: resolved ? 1 : 0,
      reasoning: resolved
        ? `Intent ${intent.id} resolved: ${JSON.stringify(intent.subject)} → ${JSON.stringify(intent.desired)}`
        : `Intent ${intent.id} could not be resolved`,
      ts: start,
    });
    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: _ctx.clock.now() - start },
      continue: resolved,
      rejectionReason: resolved ? undefined : 'Intent could not be resolved',
    };
  }
}

/** Pass: policy — checks the intent against policy rules. M-RT-8: basic checks. */
export class PolicyPass implements CompilerPass {
  readonly name = 'policy' as const;

  execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): PassResult {
    const start = ctx.clock.now();
    const amount = intent.desired.amount as number;
    // M-RT-8: basic policy — amount must be positive and within sane limits.
    const passes = amount > 0 && amount < 1_000_000_000;
    const dec = decision({
      kind: 'policy', stage: 'policy', subject: intent.id,
      choice: passes ? 'allow' : 'deny',
      score: passes ? 1 : 0, confidence: 1,
      reasoning: passes
        ? `Policy passed: amount ${amount} is within acceptable range`
        : `Policy denied: amount ${amount} is outside acceptable range`,
      policyRuleIds: passes ? ['basic.amount_check'] : ['basic.amount_check'],
      ts: start,
    });
    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: passes,
      rejectionReason: passes ? undefined : `Policy denied: amount ${amount} out of range`,
    };
  }
}

/** Pass: compliance — checks jurisdiction + environment. M-RT-8: basic checks. */
export class CompliancePass implements CompilerPass {
  readonly name = 'compliance' as const;

  execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): PassResult {
    const start = ctx.clock.now();
    // M-RT-8: basic compliance — sandbox always passes; live requires verified actor.
    const passes = intent.environment === 'sandbox' || !!intent.actor.orgId;
    const dec = decision({
      kind: 'compliance', stage: 'compliance', subject: intent.id,
      choice: passes ? 'compliant' : 'non_compliant',
      score: passes ? 1 : 0, confidence: 1,
      reasoning: passes
        ? `Compliance check passed for environment ${intent.environment}`
        : `Compliance failed: live environment requires verified organization`,
      ts: start,
    });
    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: passes,
      rejectionReason: passes ? undefined : 'Compliance check failed',
    };
  }
}

/** Pass: fraud — basic risk screening. M-RT-8: placeholder risk score. */
export class FraudPass implements CompilerPass {
  readonly name = 'fraud' as const;

  execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): PassResult {
    const start = ctx.clock.now();
    // M-RT-8: basic fraud check — amount < $100k passes; above is flagged for review.
    const amount = intent.desired.amount as number;
    const riskScore = Math.min(1, amount / 500_000);
    const passes = riskScore < 0.8;
    const dec = decision({
      kind: 'fraud', stage: 'fraud', subject: intent.id,
      choice: passes ? 'clear' : 'flagged',
      score: 1 - riskScore, confidence: 0.9,
      reasoning: passes
        ? `Fraud check passed: risk score ${riskScore.toFixed(2)} (amount ${amount})`
        : `Fraud check flagged: risk score ${riskScore.toFixed(2)} exceeds threshold`,
      riskScore,
      ts: start,
    });
    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: passes,
      rejectionReason: passes ? undefined : `Fraud risk ${riskScore.toFixed(2)} too high`,
    };
  }
}

/** Pass: reserve_allocation — identifies which reserves to use. M-RT-8: reads Reserve Market. */
export class ReserveAllocationPass implements CompilerPass {
  readonly name = 'reserve_allocation' as const;

  async execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): Promise<PassResult> {
    const start = ctx.clock.now();
    const to = intent.desired.to as string ?? intent.desired.currency as string;
    const amount = intent.desired.amount as number;

    // Read the Reserve Market to find a matching reserve.
    let reserveSnapshot: ReserveMarketSnapshot | null = null;
    try {
      const allSnapshots = await ctx.reserveMarket.getMarketSnapshotAll(ctx.environment);
      reserveSnapshot = allSnapshots.reserves.find((r) => r.asset === to) ?? null;
    } catch { /* no reserves → no allocation */ }

    const hasReserve = reserveSnapshot !== null && reserveSnapshot.available >= amount;
    const dec = decision({
      kind: 'reserve_move', stage: 'reserve_allocation', subject: intent.id,
      choice: hasReserve ? `reserve ${reserveSnapshot!.reserveId}` : 'no reserve available',
      score: hasReserve ? 1 : 0, confidence: hasReserve ? 0.9 : 0,
      reasoning: hasReserve
        ? `Reserve ${reserveSnapshot!.reserveId} selected: available=${reserveSnapshot!.available}, utilization=${(reserveSnapshot!.utilization * 100).toFixed(1)}%, shadowPrice=${reserveSnapshot!.shadowPriceBps}bps`
        : `No reserve available for ${to} with sufficient capacity`,
      costBps: reserveSnapshot?.shadowPriceBps,
      riskScore: reserveSnapshot?.scarcity === 'CRITICAL' ? 0.8 : 0.2,
      ts: start,
    });

    // Enrich the plan with reserve allocation info.
    if (hasReserve) {
      plan.reserveAllocations = [{
        reserveId: reserveSnapshot!.reserveId,
        amount,
        currency: to,
        shadowPriceBps: reserveSnapshot!.shadowPriceBps,
      }];
    }

    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: hasReserve,
      rejectionReason: hasReserve ? undefined : `No reserve available for ${to}`,
    };
  }
}

/** Pass: reserve_aware_routing — uses Route Scoring to pick the best route. M-RT-8: full scoring. */
export class ReserveAwareRoutingPass implements CompilerPass {
  readonly name = 'reserve_aware_routing' as const;

  async execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): Promise<PassResult> {
    const start = ctx.clock.now();
    const from = intent.desired.from as string ?? intent.desired.currency as string;
    const to = intent.desired.to as string ?? intent.desired.currency as string;
    const amount = intent.desired.amount as number;

    const routing: RoutingResult = await ctx.routeScoringEngine.rank(
      { from, to, amount, now: start }, ctx.environment,
    );

    if (!routing.winner) {
      const dec = decision({
        kind: 'route', stage: 'reserve_aware_routing', subject: intent.id,
        choice: 'no route', score: 0, confidence: 0,
        reasoning: `No route available for ${from}→${to}: ${routing.rejected.length} candidates all rejected`,
        ts: start,
      });
      return {
        plan,
        result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
        continue: false,
        rejectionReason: `No route available for ${from}→${to}`,
      };
    }

    const w = routing.winner;
    const components = w.components;

    // Build the cost decomposition (additive — all components preserved).
    const costDecomposition: CostDecomposition = {
      executionCostBps: components.executionCostBps,
      capitalCostBps: components.reserveCostBps,  // M-RT-8: capital = reserve cost
      reserveCostBps: components.reserveCostBps,
      liquidityCostBps: components.liquidityCostBps,
      riskCostBps: Math.round(components.risk * 100),  // risk → bps
      settlementDelayCostBps: components.settlementCostBps,
      fxCostBps: components.fxCostBps,
      totalBps: components.executionCostBps + components.reserveCostBps + components.liquidityCostBps +
                components.fxCostBps + components.settlementCostBps + Math.round(components.risk * 100),
    };

    const dec = decision({
      kind: 'route', stage: 'reserve_aware_routing', subject: intent.id,
      choice: `route via ${w.route.hops[0].ownerId}`,
      score: 1 - (w.totalScore / 1000), confidence: components.confidence,
      alternatives: routing.ranked.slice(1, 4).map((s) => ({
        option: `via ${s.route.hops[0].ownerId}`,
        score: 1 - (s.totalScore / 1000),
        rejectedBecause: `Higher total score (${s.totalScore.toFixed(2)} vs ${w.totalScore.toFixed(2)})`,
      })),
      tradeoffs: [
        { dimension: 'executionCost', delta: components.executionCostBps },
        { dimension: 'reserveCost', delta: components.reserveCostBps },
        { dimension: 'liquidityCost', delta: components.liquidityCostBps },
        { dimension: 'fxCost', delta: components.fxCostBps },
        { dimension: 'latency', delta: components.latencyMs },
        { dimension: 'risk', delta: components.risk },
      ],
      reasoning: `Selected route via ${w.route.hops[0].ownerId}: ${components.executionCostBps}bps fee, ${components.reserveCostBps}bps reserve, ${components.latencyMs}ms, risk=${components.risk}. Cost decomposition: ${JSON.stringify(costDecomposition)}`,
      costBps: costDecomposition.totalBps,
      riskScore: components.risk,
      ts: start,
    });

    // Enrich the plan with LP allocation + settlement legs.
    const hop = w.route.hops[0];
    plan.lpAllocations = [{
      lpId: hop.ownerId,
      capabilityId: hop.capabilityId,
      amount,
      feeBps: components.executionCostBps,
    }];
    plan.settlementLegs = [{
      legId: `leg_${intent.id}_0`,
      from: w.route.from,
      to: w.route.to,
      amount,
      currency: w.route.to,
      connectorId: hop.ownerId,
    }];
    plan.estimatedCostBps = costDecomposition.totalBps;
    plan.estimatedRisk = components.risk;
    plan.rationale = `Route via ${hop.ownerId}: ${components.executionCostBps}bps fee, ${components.latencyMs}ms, risk=${components.risk}`;

    // Store the routing result on the plan for the Inspector.
    (plan as ExecutionPlan & { routing?: RoutingResult }).routing = routing;

    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: true,
    };
  }
}

/** Pass: liquidity_optimization — verifies the marketplace has a valid offer. M-RT-8: reads order book. */
export class LiquidityOptimizationPass implements CompilerPass {
  readonly name = 'liquidity_optimization' as const;

  async execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): Promise<PassResult> {
    const start = ctx.clock.now();
    const from = intent.desired.from as string ?? intent.desired.currency as string;
    const to = intent.desired.to as string ?? intent.desired.currency as string;
    const amount = intent.desired.amount as number;

    // Verify the winning LP has a valid offer.
    const lpId = plan.lpAllocations[0]?.lpId;
    let hasOffer = false;
    let quote: Quote | null = null;

    if (lpId) {
      const quotes = await ctx.liquidityMarketplace.quote(
        { from, to, amount, now: start }, ctx.environment,
      );
      quote = quotes.find((q) => q.lpId === lpId && q.status === 'valid') ?? null;
      hasOffer = quote !== null;
    }

    const dec = decision({
      kind: 'lp_select', stage: 'liquidity_optimization', subject: intent.id,
      choice: hasOffer ? `offer from ${lpId}` : 'no valid offer',
      score: hasOffer ? 1 : 0, confidence: hasOffer ? 0.9 : 0,
      reasoning: hasOffer
        ? `Liquidity offer verified: ${quote!.feeBps}bps fee, ${quote!.latencyMs}ms latency`
        : `No valid liquidity offer from ${lpId} for ${from}→${to}`,
      costBps: quote?.feeBps,
      riskScore: quote?.riskScore,
      ts: start,
    });

    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: hasOffer,
      rejectionReason: hasOffer ? undefined : `No valid liquidity offer from ${lpId}`,
    };
  }
}

/** Pass: fx_optimization — handles FX if crossing currencies. M-RT-8: basic. */
export class FxOptimizationPass implements CompilerPass {
  readonly name = 'fx_optimization' as const;

  execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): PassResult {
    const start = ctx.clock.now();
    const from = intent.desired.from as string ?? intent.desired.currency as string;
    const to = intent.desired.to as string ?? intent.desired.currency as string;
    const crossesCurrencies = from !== to;

    if (crossesCurrencies) {
      plan.fxHops = [{ from, to, rate: 1, costBps: 5 }]; // M-RT-8: flat 5bps FX
    }

    const dec = decision({
      kind: 'fx', stage: 'fx_optimization', subject: intent.id,
      choice: crossesCurrencies ? `FX ${from}→${to} at 5bps` : 'no FX needed',
      score: 1, confidence: 0.8,
      reasoning: crossesCurrencies
        ? `FX hop ${from}→${to}: 5bps cost (M-RT-8 flat rate)`
        : `No FX needed: ${from} === ${to}`,
      costBps: crossesCurrencies ? 5 : 0,
      ts: start,
    });

    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: true,
    };
  }
}

/** Pass: settlement_planning — finalizes the settlement legs + timing. */
export class SettlementPlanningPass implements CompilerPass {
  readonly name = 'settlement_planning' as const;

  execute(plan: ExecutionPlan, ctx: RealCompilerContext, intent: import('../intent/types').TypedIntent): PassResult {
    const start = ctx.clock.now();

    // Finalize execution timing from the plan's settlement legs.
    const latencyMs = plan.lpAllocations[0]?.feeBps ? 44000 : 5000; // M-RT-8: from offer
    plan.executionTiming = {
      startAt: start,
      settleBy: start + latencyMs,
      isImmediate: true,
    };

    // Capital allocation.
    const amount = intent.desired.amount as number;
    plan.capitalAllocation = {
      totalCapitalDeployed: amount,
      breakdown: plan.lpAllocations.map((a) => ({ source: a.lpId, amount: a.amount })),
    };

    // Alternatives from routing.
    const routing = (plan as ExecutionPlan & { routing?: RoutingResult }).routing;
    if (routing) {
      plan.alternativesConsidered = routing.ranked.slice(1, 4).map((s) => ({
        description: `Route via ${s.route.hops[0].ownerId}`,
        estimatedCostBps: s.components.executionCostBps,
        estimatedRisk: s.components.risk,
        rejectedBecause: `Higher total score (${s.totalScore.toFixed(2)} vs ${routing.winner?.totalScore.toFixed(2)})`,
      }));
    }

    const dec = decision({
      kind: 'settlement_plan', stage: 'settlement_planning', subject: intent.id,
      choice: plan.settlementLegs.length > 0 ? 'settlement plan finalized' : 'no settlement legs',
      score: 1, confidence: 0.9,
      reasoning: `Settlement plan finalized: ${plan.settlementLegs.length} legs, ${plan.lpAllocations.length} LP allocations, estimated cost ${plan.estimatedCostBps}bps, settle by ${new Date(plan.executionTiming.settleBy).toISOString()}`,
      costBps: plan.estimatedCostBps,
      riskScore: plan.estimatedRisk,
      ts: start,
    });

    return {
      plan,
      result: { pass: this.name, decision: dec, durationMs: ctx.clock.now() - start },
      continue: true,
    };
  }
}

/** The canonical pass pipeline (in execution order). */
export const FULL_PASS_PIPELINE: CompilerPass[] = [
  new ResolveIdentitiesPass(),
  new PolicyPass(),
  new CompliancePass(),
  new FraudPass(),
  new ReserveAllocationPass(),
  new ReserveAwareRoutingPass(),
  new LiquidityOptimizationPass(),
  new FxOptimizationPass(),
  new SettlementPlanningPass(),
];
