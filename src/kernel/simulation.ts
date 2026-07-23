/**
 * Simulation Engine — runs a scenario against the *production* kernel and
 * produces a deterministic, replayable result.
 *
 * It does not use a parallel "sandbox" implementation. The same Routing,
 * Settlement, Ledger, Twin-Token, FX, Pricing and Risk engines that serve
 * production traffic execute the scenario against a private copy of world
 * state. The output is a 9-frame replay plus full ledger, events, audit and
 * AI reasoning — enough to inspect, debug and verify any future feature
 * before it ever touches real money.
 */
import type {
  SimulationScenario,
  SimulationResult,
  SimulationMetrics,
  ReplayFrame,
  WorldState,
  WorldStateResult,
  ReserveConfig,
  LiquidityProviderConfig,
  EngineHealth,
} from './types';
import { RoutingEngine } from './routing';
import { SettlementEngine } from './settlement';
import { fxEngine } from './fx';
import { pricingEngine } from './pricing';
import { riskEngine } from './risk';
import { complianceEngine } from './compliance';
import { fraudEngine } from './fraud';
import { treasuryEngine } from './treasury';
import { aiAgentEngine } from './ai-agent';
import { policyEngine } from './policy';
import { auditEngine } from './audit';
import { eventEngine } from './event';
import { permissionEngine } from './permission';
import { extensionRuntime } from './extension';
import { workflowEngine } from './workflow';
import { KERNEL_VERSION, uid, round, formatDuration } from './support';
import { ENGINES } from './registry';

export interface SimulationOptions {
  actorId?: string;
}

export class SimulationEngine {
  run(scenario: SimulationScenario, opts: SimulationOptions = {}): SimulationResult {
    const actorId = opts.actorId ?? 'simulator';
    const runId = uid('run');

    // Authorize the simulator actor.
    permissionEngine.authorize(actorId, 'kernel:simulate');
    auditEngine.record(actorId, 'simulation.start', `Run ${runId} for ${scenario.amount} ${scenario.currency}`);

    // Reset transient engine state so each run is isolated & deterministic.
    eventEngine.reset();
    auditEngine.reset();
    treasuryEngine.reset();

    // Private copy of world state for this run.
    const world: WorldState = {
      accounts: new Map(),
      reserves: scenario.reserves.map((r) => ({ ...r })),
      liquidityProviders: scenario.liquidityProviders.map((lp) => ({ ...lp })),
    };

    // --- Pre-flight: compliance + fraud ---------------------------------
    const compliance = complianceEngine.verify(scenario);
    auditEngine.record(actorId, 'compliance.verify', `passed=${compliance.passed}`);
    const fraud = fraudEngine.assess(scenario);
    auditEngine.record(actorId, 'fraud.assess', `score=${fraud.score} recommendation=${fraud.recommendation}`);

    // Extension hook: beforeRoute
    extensionRuntime.fire('beforeRoute', { scenario, runId });

    // --- Routing (the exact production engine) --------------------------
    const routing = new RoutingEngine(world).route(scenario);
    extensionRuntime.fire('afterRoute', { scenario, routing });

    // --- Settlement (frames 1-5) ----------------------------------------
    const txId = uid('tx');
    const settlement = new SettlementEngine(world);
    const out = settlement.exec(txId, scenario, routing);
    extensionRuntime.fire('afterSettle', { scenario, routing, out });

    // --- Pricing + Risk -------------------------------------------------
    const pricing = pricingEngine.price({
      principal: scenario.amount,
      lpUsage: routing.lpUsage,
      fxSpreadCost: routing.fxQuote.spreadCost,
      reserveFeeBps: 4,
      currency: scenario.merchant.currency,
    });

    const reservesAfter = world.reserves.map((r) => ({ ...r }));
    const risk = riskEngine.assess({
      reserves: reservesAfter,
      lpUsage: routing.lpUsage,
      amount: scenario.amount,
      pathLength: routing.hops.length,
      fxSpreadBps: routing.fxQuote.spreadBps,
      preference: scenario.preference,
    });

    // --- Metrics --------------------------------------------------------
    const usedLpSpeed = routing.lpUsage.reduce((s, u) => {
      const lp = scenario.liquidityProviders.find((x) => x.id === u.lpId);
      return s + (lp?.speedMs ?? 0);
    }, 0);
    const settlementMs = 15000 + usedLpSpeed + routing.hops.length * 6000;
    const totalInitialLpCapacity = scenario.liquidityProviders
      .filter((lp) => lp.country === scenario.buyer.country)
      .reduce((s, lp) => s + lp.capacity, 0);
    const totalDrawn = routing.lpUsage.reduce((s, u) => s + u.drawn, 0);
    const dstReserveBefore = scenario.reserves.find(
      (r) => r.country === scenario.merchant.country,
    );
    const metrics: SimulationMetrics = {
      settlementTimeMs: settlementMs,
      settlementTimeLabel: formatDuration(settlementMs),
      costPercent: pricing.costPercent,
      costAmount: pricing.costAmount,
      riskScore: risk.score,
      riskLabel: risk.label,
      confidence: risk.confidence,
      fxRate: routing.fxQuote.effectiveRate,
      fxSpreadBps: routing.fxQuote.spreadBps,
      totalFees: pricing.totalFees,
      reserveUtilization: dstReserveBefore
        ? round((scenario.amount / dstReserveBefore.balance) * 100, 1)
        : 0,
      liquidityUtilization: totalInitialLpCapacity
        ? round((totalDrawn / totalInitialLpCapacity) * 100, 1)
        : 0,
    };

    // --- Treasury accrual ----------------------------------------------
    treasuryEngine.accrual(
      scenario.merchant.currency,
      pricing.lpFees,
      pricing.fxSpreadCost,
      pricing.reserveFee,
    );
    auditEngine.record(
      actorId,
      'treasury.accrual',
      `+${round(pricing.totalFees, 2)} ${scenario.merchant.currency} to treasury`,
    );

    // --- Policy ---------------------------------------------------------
    const policy = policyEngine.evaluate(scenario, routing, pricing, risk.score, reservesAfter);
    auditEngine.record(actorId, 'policy.evaluate', `passed=${policy.passed}`);

    // --- AI reasoning ---------------------------------------------------
    const aiBase = aiAgentEngine.reason({
      scenario,
      routing,
      pricing,
      risk,
      settlementMs,
    });
    auditEngine.record(actorId, 'ai.reason', `strategy=${aiBase.strategy}`);

    // --- Workflow record ------------------------------------------------
    const wf = workflowEngine.begin(runId, 'Cross-border settlement', [
      { id: 'debit', name: 'Debit Buyer' },
      { id: 'credit-reserve', name: 'Credit Reserve' },
      { id: 'mint', name: 'Mint Twin Token' },
      { id: 'burn', name: 'Burn Twin Token' },
      { id: 'payout', name: 'Credit Merchant' },
    ]);
    workflowEngine.finish(wf, 5);

    // --- Build the 9 replay frames -------------------------------------
    const twinMinted = out.twinTokens[0];
    const replay = this.buildReplay(scenario, out, aiBase.decisions, metrics);

    // --- World state result --------------------------------------------
    const worldState: WorldStateResult = {
      reserves: scenario.reserves.map((before) => {
        const after = world.reserves.find((r) => r.country === before.country)!;
        return {
          country: before.country,
          currency: before.currency,
          balanceBefore: before.balance,
          balanceAfter: after.balance,
          minThreshold: before.minThreshold,
          delta: round(after.balance - before.balance, 6),
          healthy: after.balance >= after.minThreshold,
        };
      }),
      liquidityProviders: scenario.liquidityProviders
        .filter((lp) => lp.country === scenario.buyer.country)
        .map((before) => {
          const after = world.liquidityProviders.find((x) => x.id === before.id)!;
          return {
            lpId: before.id,
            country: before.country,
            currency: before.currency,
            capacity: before.capacity,
            used: round(before.capacity - after.capacity, 6),
            remaining: after.capacity,
            rate: before.rate,
          };
        }),
    };

    auditEngine.record(actorId, 'simulation.complete', `run ${runId} settled`);

    return {
      runId,
      createdAt: Date.now(),
      kernelVersion: KERNEL_VERSION,
      scenario,
      plan: {
        hops: routing.hops,
        totalHops: routing.hops.length,
        lpUsage: routing.lpUsage,
        twinTokenSymbol: twinMinted?.symbol ?? '—',
      },
      metrics,
      reasoning: {
        ...aiBase,
        narrative: aiAgentEngine.buildFallbackNarrative(aiBase, {
          scenario,
          routing,
          pricing,
          risk,
          settlementMs,
        }),
        llmPowered: false,
      },
      replay,
      ledger: out.ledger,
      events: out.events,
      twinTokens: out.twinTokens,
      worldState,
      audit: auditEngine.trace(runId, actorId),
      engines: ENGINES,
    };
  }

  private buildReplay(
    scenario: SimulationScenario,
    out: ReturnType<SettlementEngine['exec']>,
    decisions: SimulationResult['reasoning']['decisions'],
    metrics: SimulationMetrics,
  ): ReplayFrame[] {
    const twin = out.twinTokens[0];
    const ledgerByFrame = (f: number) => out.ledger.filter((e) => e.frame === f);
    const eventsByFrame = (f: number) => out.events.filter((e) => e.frame === f);
    const totalDebit = out.ledger.reduce((s, e) => s + e.debit, 0);
    const totalCredit = out.ledger.reduce((s, e) => s + e.credit, 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 1e-6;

    return [
      {
        index: 1,
        key: 'debit-buyer',
        title: 'Debit Buyer',
        description: `Debit ${scenario.buyer.label} in ${scenario.buyer.currency} via ${scenario.buyer.method}.`,
        type: 'debit',
        ledgerEntries: ledgerByFrame(1),
        events: eventsByFrame(1),
        summary: `Buyer debited; funds enter the kernel.`,
      },
      {
        index: 2,
        key: 'credit-reserve',
        title: 'Credit Reserve',
        description: `Credit the source reserve (${scenario.buyer.country}) with buyer funds.`,
        type: 'credit',
        ledgerEntries: ledgerByFrame(2),
        events: eventsByFrame(2),
        summary: `Source reserve now holds the buyer's deposit as a liability.`,
      },
      {
        index: 3,
        key: 'mint-twin',
        title: 'Mint Twin Token',
        description: 'Mint a twin token representing the cross-border obligation.',
        type: 'mint',
        twinToken: twin
          ? { ...twin, status: 'minted', burnedAtFrame: null }
          : undefined,
        events: eventsByFrame(3),
        summary: twin ? `${twin.symbol} minted for ${round(twin.amount, 2)} ${twin.currency}` : 'No twin token',
      },
      {
        index: 4,
        key: 'burn-twin',
        title: 'Burn Twin Token',
        description: 'Draw LP bridge liquidity and burn the twin token — obligation backed.',
        type: 'burn',
        twinToken: twin,
        ledgerEntries: ledgerByFrame(4),
        events: eventsByFrame(4),
        summary: `Bridge liquidity sourced; twin token burned.`,
      },
      {
        index: 5,
        key: 'credit-merchant',
        title: 'Credit Merchant',
        description: `Pay the merchant from the destination reserve (${scenario.merchant.country}).`,
        type: 'credit',
        ledgerEntries: ledgerByFrame(5),
        events: eventsByFrame(5),
        summary: `Merchant credited ${round(scenario.amount, 2)} ${scenario.merchant.currency}.`,
      },
      {
        index: 6,
        key: 'ledger-entries',
        title: 'Ledger Entries',
        description: 'Complete double-entry ledger for the transaction.',
        type: 'ledger',
        ledgerEntries: out.ledger,
        summary: `${out.ledger.length} entries • debits ${round(totalDebit, 2)} = credits ${round(totalCredit, 2)} • ${balanced ? 'balanced ✓' : 'UNBALANCED ✗'}`,
      },
      {
        index: 7,
        key: 'events',
        title: 'Events',
        description: 'Full event stream emitted by the kernel during settlement.',
        type: 'events',
        events: out.events,
        summary: `${out.events.length} events emitted across ${5} frames.`,
      },
      {
        index: 8,
        key: 'ai-decisions',
        title: 'AI Decisions',
        description: 'Agent reasoning over routing, risk and cost.',
        type: 'ai',
        decisions,
        summary: `${decisions.length} decisions recorded.`,
      },
      {
        index: 9,
        key: 'settlement-complete',
        title: 'Settlement Complete',
        description: 'Final settlement state and metrics.',
        type: 'settlement',
        summary: `Settled in ${metrics.settlementTimeLabel} • cost ${metrics.costPercent}% • risk ${metrics.riskScore.toFixed(2)} (${metrics.riskLabel}) • confidence ${metrics.confidence}%`,
      },
    ];
  }
}

export const simulationEngine = new SimulationEngine();
