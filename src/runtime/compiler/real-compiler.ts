/**
 * The real Financial Compiler — M-RT-7 (Minimal).
 *
 * SCOPE: intentionally narrow — an integration milestone, not an optimization one.
 *   Pass 1: Resolve identities + normalize participants
 *   Pass 2: Settlement planning using existing route/routing information
 *   Output: Minimal ExecutionPlan
 *   NOT YET: reserve optimization, liquidity allocation, FX optimization,
 *            recommendation generation, economic optimization
 *
 * PROPERTIES (non-negotiable):
 *   - PURE: same intent + same input snapshots → same ExecutionPlan. No side effects.
 *   - READ-ONLY: reads projections (Capability Graph, Route Graph, Reserve Market,
 *     Liquidity Marketplace, Route Scoring Engine) but mutates NONE of them.
 *   - INSPECTABLE: every compiler pass leaves an explicit CompilationPassResult
 *     artifact (Decision + duration), even if some passes are placeholders.
 *   - EMITS NOTHING: returns the plan (or a compile result) — no events, no side
 *     effects until later milestones introduce controlled execution.
 *
 * Later milestones add passes (policy, compliance, fraud, reserve_allocation,
 * reserve_aware_routing, liquidity_optimization, fx_optimization) without
 * changing the compiler's public contract.
 */

import type { TypedIntent } from '../intent/types';
import type { RuntimeClock } from '../clock';
import type { Environment } from '../types';
import type { Decision } from '../decisions/types';
import { decision } from '../decisions/types';
import type {
  ExecutionPlan,
  ExecutionPlanAlternative,
  CompilationPassResult,
  CompilationPassName,
  ReserveAllocation,
  LPAllocation,
  FXHop,
  SettlementLeg,
  CollateralPlan,
  CapitalAllocation,
  ExecutionTiming,
} from './types';
import type { RouteScoringEngine } from '../engines/routing/engine';
import type { RoutingResult } from '../engines/routing/types';
import type { ReserveMarketEngine } from '../engines/reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../engines/liquidity-marketplace/service';
import type { CapabilityGraph } from '../graphs/capability/types';

/** The result of compilation — either a plan or an explicit failure. */
export interface CompileResult {
  plan: ExecutionPlan | null;
  routing: RoutingResult | null;
  success: boolean;
  error?: string;
}

/** Everything the real compiler reads. All lower-layer projections. */
export interface RealCompilerContext {
  clock: RuntimeClock;
  environment: Environment;
  capabilityGraph: CapabilityGraph;
  routeScoringEngine: RouteScoringEngine;
  reserveMarket: ReserveMarketEngine;
  liquidityMarketplace: LiquidityMarketplaceService;
}

/**
 * FinancialCompiler (Minimal) — the real implementation replacing NoOpFinancialCompiler.
 *
 * M-RT-7: resolve_identities + settlement_planning only.
 * Later milestones add the other 6 passes as pluggable steps.
 */
export class FinancialCompiler {
  /**
   * Compile a TypedIntent into an ExecutionPlan.
   * Pure, deterministic, no side effects.
   */
  async compile(intent: TypedIntent, ctx: RealCompilerContext): Promise<CompileResult> {
    const passes: CompilationPassResult[] = [];
    const compiledAt = ctx.clock.now();

    // ── Pass 1: resolve_identities ────────────────────────────────────
    const resolveResult = this.passResolveIdentities(intent, ctx, compiledAt);
    passes.push(resolveResult);

    // ── Placeholder passes (record as "not yet implemented") ──────────
    // These exist so the Inspector shows the full pass order even in M-RT-7.
    // Later milestones replace them with real logic.
    for (const passName of ['policy', 'compliance', 'fraud'] as const) {
      passes.push(this.placeholderPass(passName, intent, compiledAt));
    }

    // ── Pass 2: settlement_planning ───────────────────────────────────
    // This is the real work of M-RT-7: use the Route Scoring Engine to find
    // the best route and build a settlement plan from it.
    const settlementResult = await this.passSettlementPlanning(intent, ctx, compiledAt);
    passes.push(settlementResult.result);

    if (!settlementResult.success) {
      return {
        plan: null,
        routing: settlementResult.routing,
        success: false,
        error: settlementResult.error,
      };
    }

    // ── Build the Execution Plan from the settlement result ──────────
    const routing = settlementResult.routing!;
    const winner = routing.winner!;

    // Extract the winning route's hop details.
    const hop = winner.route.hops[0]; // M-RT-7: direct routes only (1 hop)

    // Build LP allocation from the winning route.
    const lpAllocations: LPAllocation[] = [{
      lpId: hop.ownerId,
      capabilityId: hop.capabilityId,
      amount: intent.desired.amount as number,
      feeBps: winner.components.executionCostBps,
    }];

    // Build settlement legs from the route.
    const settlementLegs: SettlementLeg[] = [{
      legId: `leg_${intent.id}_0`,
      from: winner.route.from,
      to: winner.route.to,
      amount: intent.desired.amount as number,
      currency: winner.route.to,
      connectorId: hop.ownerId, // M-RT-7: the LP is the connector
    }];

    // Build reserve allocations from the score's reserve cost.
    const reserveAllocations: ReserveAllocation[] = [];
    if (winner.components.reserveCostBps > 0) {
      reserveAllocations.push({
        reserveId: `reserve_for_${winner.route.to}`,
        amount: intent.desired.amount as number,
        currency: winner.route.to,
        shadowPriceBps: winner.components.reserveCostBps,
      });
    }

    // Build the plan.
    const plan: ExecutionPlan = {
      id: `plan_${intent.id}`,
      intentId: intent.id,
      reserveAllocations,
      lpAllocations,
      fxHops: winner.components.fxCostBps > 0
        ? [{ from: winner.route.from, to: winner.route.to, rate: 1, costBps: winner.components.fxCostBps }]
        : [],
      settlementLegs,
      collateral: { reserveId: '', amount: 0, currency: '' }, // M-RT-8 fills this
      capitalAllocation: {
        totalCapitalDeployed: intent.desired.amount as number,
        breakdown: [{ source: hop.ownerId, amount: intent.desired.amount as number }],
      },
      executionTiming: {
        startAt: compiledAt,
        settleBy: compiledAt + winner.components.latencyMs,
        isImmediate: true,
      },
      passes,
      rationale: winner.route.isDirect
        ? `Direct route via ${hop.ownerId} (${winner.components.executionCostBps}bps fee, ${winner.components.latencyMs}ms latency, ${winner.components.risk} risk)`
        : `Multi-hop route via ${hop.ownerId}`,
      alternativesConsidered: routing.ranked.slice(1, 4).map((s) => ({
        description: `Route via ${s.route.hops[0].ownerId}`,
        estimatedCostBps: s.components.executionCostBps,
        estimatedRisk: s.components.risk,
        rejectedBecause: `Higher total score (${s.totalScore.toFixed(2)} vs ${winner.totalScore.toFixed(2)})`,
      })),
      estimatedCostBps: winner.components.executionCostBps +
        winner.components.reserveCostBps +
        winner.components.liquidityCostBps +
        winner.components.fxCostBps +
        winner.components.settlementCostBps,
      estimatedRisk: winner.components.risk,
      expectedProfitability: 0, // M-RT-8 fills this
      compiledAt,
    };

    return {
      plan,
      routing,
      success: true,
    };
  }

  // ── Pass implementations ──────────────────────────────────────────

  /** Pass 1: resolve identities + normalize participants. */
  private passResolveIdentities(intent: TypedIntent, ctx: RealCompilerContext, compiledAt: number): CompilationPassResult {
    const start = ctx.clock.now();
    // M-RT-7: identity resolution is minimal — the TypedIntent already has
    // resolved subject/desired from the Intent Engine. We just validate.
    const resolved = intent.subject && intent.desired;

    const dec: Decision = decision({
      kind: 'other',
      stage: 'resolve_identities',
      subject: intent.id,
      choice: resolved ? 'resolved' : 'unresolved',
      score: resolved ? 1 : 0,
      confidence: resolved ? 1 : 0,
      reasoning: resolved
        ? `Intent ${intent.id} resolved: ${JSON.stringify(intent.subject)} → ${JSON.stringify(intent.desired)}`
        : `Intent ${intent.id} could not be resolved`,
      ts: compiledAt,
    });

    return {
      pass: 'resolve_identities',
      decision: dec,
      durationMs: ctx.clock.now() - start,
    };
  }

  /** Pass 2: settlement planning — the real work of M-RT-7. */
  private async passSettlementPlanning(
    intent: TypedIntent,
    ctx: RealCompilerContext,
    compiledAt: number,
  ): Promise<{ result: CompilationPassResult; success: boolean; routing: RoutingResult | null; error?: string }> {
    const start = ctx.clock.now();

    const from = intent.desired.from as string ?? intent.desired.currency as string;
    const to = intent.desired.to as string ?? intent.desired.currency as string;
    const amount = intent.desired.amount as number;

    if (!from || !to || !amount) {
      const dec = decision({
        kind: 'settlement_plan', stage: 'settlement_planning', subject: intent.id,
        choice: 'failed', score: 0, confidence: 0,
        reasoning: `Missing from/to/amount in intent: from=${from}, to=${to}, amount=${amount}`,
        ts: compiledAt,
      });
      return {
        result: { pass: 'settlement_planning', decision: dec, durationMs: ctx.clock.now() - start },
        success: false, routing: null, error: 'Missing from/to/amount',
      };
    }

    // Use the Route Scoring Engine to find the best route.
    const routing = await ctx.routeScoringEngine.rank(
      { from, to, amount, now: compiledAt },
      ctx.environment,
    );

    const dec: Decision = decision({
      kind: 'settlement_plan',
      stage: 'settlement_planning',
      subject: intent.id,
      choice: routing.winner
        ? `route via ${routing.winner.route.hops[0].ownerId}`
        : 'no route available',
      score: routing.winner ? 1 - (routing.winner.totalScore / 1000) : 0,
      confidence: routing.winner?.components.confidence ?? 0,
      alternatives: routing.ranked.slice(1, 4).map((s) => ({
        option: `via ${s.route.hops[0].ownerId}`,
        score: 1 - (s.totalScore / 1000),
        rejectedBecause: `Higher total score (${s.totalScore.toFixed(2)})`,
      })),
      tradeoffs: routing.winner ? [
        { dimension: 'executionCost', delta: routing.winner.components.executionCostBps },
        { dimension: 'reserveCost', delta: routing.winner.components.reserveCostBps },
        { dimension: 'latency', delta: routing.winner.components.latencyMs },
        { dimension: 'risk', delta: routing.winner.components.risk },
      ] : [],
      reasoning: routing.winner
        ? `Selected route via ${routing.winner.route.hops[0].ownerId}: ${routing.winner.components.executionCostBps}bps fee, ${routing.winner.components.latencyMs}ms, ${routing.ranked.length} candidates ranked, ${routing.rejected.length} rejected`
        : `No route available for ${from}→${to} (amount ${amount}): ${routing.rejected.length} candidates all rejected`,
      costBps: routing.winner?.components.executionCostBps,
      riskScore: routing.winner?.components.risk,
      ts: compiledAt,
    });

    return {
      result: { pass: 'settlement_planning', decision: dec, durationMs: ctx.clock.now() - start },
      success: routing.winner !== null,
      routing,
      error: routing.winner ? undefined : 'No route available',
    };
  }

  /** A placeholder pass — records "not yet implemented" for Inspector visibility. */
  private placeholderPass(
    passName: 'policy' | 'compliance' | 'fraud',
    intent: TypedIntent,
    compiledAt: number,
  ): CompilationPassResult {
    const dec: Decision = decision({
      kind: 'other',
      stage: passName,
      subject: intent.id,
      choice: 'skipped (not yet implemented)',
      score: 1,
      confidence: 1,
      reasoning: `M-RT-7: ${passName} pass is a placeholder. Real logic in M-RT-8.`,
      ts: compiledAt,
    });

    return { pass: passName, decision: dec, durationMs: 0 };
  }
}
