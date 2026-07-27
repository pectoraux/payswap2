/**
 * LiquidityComposer — the orchestrator that ties together graph building,
 * pathfinding, cost optimization, and split routing. (M-RT-16.)
 *
 * This is the SINGLE entry point the Financial Compiler calls:
 *   composer.compose(request, graph) → ComposedExecutionPlan
 *
 * The composer is PURE: same request + graph → same plan. It never mutates
 * state, never emits events, never executes. It only RECOMMENDS a plan.
 *
 * Pipeline:
 *   1. findPaths(graph, from, to, maxHops) → candidate paths
 *   2. rankPaths(candidates, weights) → scored paths
 *   3. optimizeSplit(ranked, amount) → split plan (single or multi-path)
 *   4. flatten into ExecutionLeg[] (sequential within path, parallel across splits)
 *   5. return ComposedExecutionPlan with candidates + alternatives + legs
 *
 * The Financial Compiler's API is UNCHANGED — the composer is additive.
 */

import type {
  CompositionRequest,
  ComposedExecutionPlan,
  ExecutionLeg,
  LiquidityGraph,
  LiquidityPath,
  SplitPlan,
  CostDecomposition,
  ScoringWeights,
  ComposerOptions,
} from './types';
import { DEFAULT_SCORING_WEIGHTS } from './types';
import { findPaths } from './pathfinder';
import { rankPaths } from './optimizer';
import { optimizeSplit } from './splitter';

/** Default composer options. */
const DEFAULT_OPTIONS: Required<ComposerOptions> = {
  defaultMaxHops: 4,
  defaultAllowSplit: true,
  latencyCostPerMs: 0.01,
  riskCostMultiplier: 100,
  minSplitBenefitBps: 5,
};

/**
 * LiquidityComposer — the orchestrator.
 *
 * Stateless: instantiate once, call `compose()` as many times as needed.
 */
export class LiquidityComposer {
  private readonly options: Required<ComposerOptions>;

  constructor(options: ComposerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Compose an execution plan for a request.
   *
   * Pure: same request + graph → same plan. Deterministic.
   */
  compose(request: CompositionRequest, graph: LiquidityGraph): ComposedExecutionPlan {
    const maxHops = request.maxHops ?? this.options.defaultMaxHops;
    const allowSplit = request.allowSplit ?? this.options.defaultAllowSplit;
    const weights = request.weights ?? DEFAULT_SCORING_WEIGHTS;

    // Step 1: find all candidate paths.
    const candidates = findPaths(graph, request.from, request.to, maxHops);

    // Step 2: rank paths by score.
    const ranked = rankPaths(candidates, weights, this.options.latencyCostPerMs, this.options.riskCostMultiplier);

    // Step 3: optimize the split plan.
    const plan: SplitPlan = allowSplit
      ? optimizeSplit(candidates, request, weights, this.options)
      : this.singlePathOnly(candidates, request, weights);

    // Step 4: flatten into execution legs.
    const legs = this.flattenLegs(plan);

    // Step 5: compute the aggregate cost decomposition.
    const cost = this.aggregateCost(plan, weights);

    // Alternatives: all candidates not in the chosen plan.
    const chosenPathIds = new Set(plan.allocations.map((a) => a.path.id));
    const alternatives = candidates.filter((p) => !chosenPathIds.has(p.id));

    // Determine if multi-hop (any allocation has hops > 1).
    const isMultiHop = plan.allocations.some((a) => a.path.hops > 1);
    const maxHopsInPlan = plan.allocations.length > 0
      ? Math.max(...plan.allocations.map((a) => a.path.hops))
      : 0;

    return {
      request,
      plan,
      legs,
      cost,
      candidates,
      alternatives,
      maxHops: maxHopsInPlan,
      isMultiHop,
      isSplit: plan.isSplit,
    };
  }

  /** When split is disabled, use only the best single path. */
  private singlePathOnly(
    candidates: LiquidityPath[],
    request: CompositionRequest,
    weights: ScoringWeights,
  ): SplitPlan {
    if (candidates.length === 0) {
      return {
        request,
        allocations: [],
        totalCostBps: 0,
        totalFailureProb: 1,
        rationale: 'No candidate paths found',
        isSplit: false,
      };
    }
    const ranked = rankPaths(candidates, weights, this.options.latencyCostPerMs, this.options.riskCostMultiplier);
    const best = ranked[0];
    return {
      request,
      allocations: [{ path: best.path, amount: request.amount, percentage: 100 }],
      totalCostBps: best.decomposition.totalBps,
      totalFailureProb: best.path.failureProb,
      rationale: `Single-path plan (split disabled) via ${best.path.edges.map((e) => e.lpId ?? e.id).join(' → ')}`,
      isSplit: false,
    };
  }

  /**
   * Flatten a SplitPlan into ExecutionLeg[].
   *
   * Each allocation's path becomes `path.hops` sequential legs.
   * Allocations in a split plan get a `splitGroup` ID so the executor knows
   * they run in parallel.
   */
  private flattenLegs(plan: SplitPlan): ExecutionLeg[] {
    const legs: ExecutionLeg[] = [];

    plan.allocations.forEach((alloc, allocIndex) => {
      // Each allocation in a split gets a splitGroup ID.
      const splitGroup = plan.isSplit ? `split_${allocIndex}` : undefined;

      alloc.path.edges.forEach((edge, hopIndex) => {
        legs.push({
          hopIndex,
          from: edge.from,
          to: edge.to,
          lpId: edge.lpId,
          amount: alloc.amount,
          costBps: edge.fxBps + edge.feeBps + edge.reserveOppCostBps,
          latencyMs: edge.latencyMs,
          splitGroup,
          percentage: alloc.percentage,
        });
      });
    });

    return legs;
  }

  /** Compute the aggregate cost decomposition across all allocations. */
  private aggregateCost(plan: SplitPlan, weights: ScoringWeights): CostDecomposition {
    if (plan.allocations.length === 0) {
      return { fxBps: 0, feeBps: 0, reserveOppCostBps: 0, latencyBps: 0, riskBps: 0, totalBps: 0 };
    }

    // Weighted average across allocations.
    let fxBps = 0, feeBps = 0, reserveOppCostBps = 0, latencyBps = 0, riskBps = 0, totalBps = 0;
    let totalAmount = 0;

    for (const alloc of plan.allocations) {
      const amount = alloc.amount;
      totalAmount += amount;

      // Compute the path's decomposition.
      let pathFxMultiplier = 1;
      let pathFee = 0, pathReserve = 0, pathLatency = 0;
      for (const edge of alloc.path.edges) {
        pathFxMultiplier *= 1 + edge.fxBps / 10_000;
        pathFee += edge.feeBps;
        pathReserve += edge.reserveOppCostBps;
        pathLatency += edge.latencyMs;
      }
      const pathFx = (pathFxMultiplier - 1) * 10_000;
      const pathLatencyBps = pathLatency * this.options.latencyCostPerMs;
      const pathRiskBps = alloc.path.compoundedRisk * this.options.riskCostMultiplier;
      const pathTotal = pathFx + pathFee + pathReserve + pathLatencyBps + pathRiskBps;

      fxBps += pathFx * amount;
      feeBps += pathFee * amount;
      reserveOppCostBps += pathReserve * amount;
      latencyBps += pathLatencyBps * amount;
      riskBps += pathRiskBps * amount;
      totalBps += pathTotal * amount;
    }

    return {
      fxBps: fxBps / totalAmount,
      feeBps: feeBps / totalAmount,
      reserveOppCostBps: reserveOppCostBps / totalAmount,
      latencyBps: latencyBps / totalAmount,
      riskBps: riskBps / totalAmount,
      totalBps: totalBps / totalAmount,
    };
  }
}
