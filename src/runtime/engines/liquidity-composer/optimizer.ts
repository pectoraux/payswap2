/**
 * Optimizer — scores paths using the cost decomposition + scoring weights.
 * (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * The optimizer REUSES the existing cost decomposition (fxBps + feeBps +
 * reserveOppCostBps + latencyBps + riskBps) rather than inventing a second
 * cost model. Each path gets a normalized score [0, 1] — lower is better.
 *
 * The optimizer is PURE: same paths + weights → same scores.
 */

import type {
  LiquidityPath,
  CostDecomposition,
  ScoringWeights,
} from './types';

/** Default cost of latency: 0.01 bps per ms (10 bps per second). */
const DEFAULT_LATENCY_COST_PER_MS = 0.01;

/** Default risk cost: 100 bps per unit of risk. */
const DEFAULT_RISK_COST_MULTIPLIER = 100;

/**
 * Decompose a path's cost into its components.
 *
 * Reuses the existing decomposition: fxBps + feeBps + reserveOppCostBps +
 * latencyBps + riskBps = totalBps.
 */
export function decomposeCost(
  path: LiquidityPath,
  latencyCostPerMs: number = DEFAULT_LATENCY_COST_PER_MS,
  riskCostMultiplier: number = DEFAULT_RISK_COST_MULTIPLIER,
): CostDecomposition {
  let fxBps = 0;
  let feeBps = 0;
  let reserveOppCostBps = 0;

  // FX compounds; fees + reserve costs sum.
  let fxMultiplier = 1;
  for (const edge of path.edges) {
    fxMultiplier *= 1 + edge.fxBps / 10_000;
    feeBps += edge.feeBps;
    reserveOppCostBps += edge.reserveOppCostBps;
  }
  fxBps = (fxMultiplier - 1) * 10_000;

  // Latency penalty: convert ms to bps.
  const latencyBps = path.totalLatencyMs * latencyCostPerMs;

  // Risk penalty: riskScore × multiplier.
  const riskBps = path.compoundedRisk * riskCostMultiplier;

  const totalBps = fxBps + feeBps + reserveOppCostBps + latencyBps + riskBps;

  return { fxBps, feeBps, reserveOppCostBps, latencyBps, riskBps, totalBps };
}

/**
 * Score a path: normalized [0, 1], lower is better.
 *
 * Weighted sum of:
 *   - cost (totalBps, normalized)
 *   - latency (totalLatencyMs, normalized)
 *   - risk (compoundedRisk, normalized)
 *   - reliability (failureProb, normalized — lower failure = higher reliability)
 */
export function scorePath(
  path: LiquidityPath,
  weights: ScoringWeights,
  decomposition: CostDecomposition,
): number {
  // Normalize each dimension to [0, 1] using soft caps.
  // (These caps are tuned for typical payment corridors; the optimizer
  // produces relative rankings, so the exact cap values don't matter much.)
  const costNorm = Math.min(1, decomposition.totalBps / 500); // 500 bps = 5%
  const latencyNorm = Math.min(1, path.totalLatencyMs / 60_000); // 60s
  const riskNorm = Math.min(1, path.compoundedRisk); // already [0, 1]
  const failureNorm = Math.min(1, path.failureProb); // already [0, 1]

  // Weighted sum (lower = better).
  return (
    costNorm * weights.costWeight +
    latencyNorm * weights.latencyWeight +
    riskNorm * weights.riskWeight +
    failureNorm * weights.reliabilityWeight
  );
}

/**
 * Rank paths by score (best first).
 *
 * Deterministic: ties broken by path ID (lexicographic).
 */
export function rankPaths(
  paths: LiquidityPath[],
  weights: ScoringWeights,
  latencyCostPerMs: number = DEFAULT_LATENCY_COST_PER_MS,
  riskCostMultiplier: number = DEFAULT_RISK_COST_MULTIPLIER,
): { path: LiquidityPath; score: number; decomposition: CostDecomposition }[] {
  const scored = paths.map((path) => {
    const decomposition = decomposeCost(path, latencyCostPerMs, riskCostMultiplier);
    const score = scorePath(path, weights, decomposition);
    return { path, score, decomposition };
  });

  // Sort by (score, path.id) for deterministic ordering.
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.path.id.localeCompare(b.path.id);
  });

  return scored;
}
