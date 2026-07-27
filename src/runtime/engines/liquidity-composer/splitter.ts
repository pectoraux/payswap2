/**
 * Splitter — decides whether to split execution across multiple paths.
 * (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * The splitter is a GREEDY optimizer: sort paths by score, fill the
 * cheapest path first up to its capacity, then the next, etc. It only
 * splits when:
 *   - The single-path winner can't handle the full amount (capacity constraint)
 *   - OR splitting reduces total cost by > minSplitBenefitBps
 *   - OR splitting reduces failure probability by > 10% (resilience)
 *
 * The splitter is PURE: same paths + request → same split plan.
 */

import type {
  LiquidityPath,
  SplitPlan,
  PathAllocation,
  CompositionRequest,
  CostDecomposition,
  ScoringWeights,
} from './types';
import { rankPaths } from './optimizer';

/** Default minimum benefit (bps) required to justify splitting. */
const DEFAULT_MIN_SPLIT_BENEFIT_BPS = 5;

/**
 * Optimize a split plan: decide how to allocate `amount` across `paths`.
 *
 * Greedy algorithm:
 *   1. Rank paths by score (best first).
 *   2. If the best path can handle the full amount AND no split benefit
 *      exists, use single-path (the common case).
 *   3. Otherwise, fill paths in score order up to their capacity.
 *
 * Returns a SplitPlan with allocations sorted by amount descending.
 */
export function optimizeSplit(
  paths: LiquidityPath[],
  request: CompositionRequest,
  weights: ScoringWeights,
  options: {
    latencyCostPerMs?: number;
    riskCostMultiplier?: number;
    minSplitBenefitBps?: number;
  } = {},
): SplitPlan {
  const minSplitBenefitBps = options.minSplitBenefitBps ?? DEFAULT_MIN_SPLIT_BENEFIT_BPS;
  const ranked = rankPaths(paths, request.weights ?? weights, options.latencyCostPerMs, options.riskCostMultiplier);

  if (ranked.length === 0) {
    return {
      request,
      allocations: [],
      totalCostBps: 0,
      totalFailureProb: 1,
      rationale: 'No candidate paths found',
      isSplit: false,
    };
  }

  const best = ranked[0];
  const remaining = ranked.slice(1);

  // ── Case 1: best path can handle the full amount ────────────────────────
  if (best.path.minCapacity >= request.amount) {
    // Check if splitting would reduce cost or failure prob.
    const splitBenefit = computeSplitBenefit(best, ranked, request.amount, minSplitBenefitBps);

    if (!splitBenefit.shouldSplit) {
      // Single-path plan — the common case.
      return buildSinglePathPlan(request, best.path, best.decomposition);
    }
    // Fall through to split logic.
  }

  // ── Case 2: split across paths (capacity-constrained or beneficial) ──────
  return buildSplitPlan(request, ranked, minSplitBenefitBps);
}

/**
 * Compute the benefit of splitting across the top paths vs. single-path.
 *
 * Returns { shouldSplit, benefitBps, rationale }.
 */
function computeSplitBenefit(
  best: { path: LiquidityPath; score: number; decomposition: CostDecomposition },
  ranked: { path: LiquidityPath; score: number; decomposition: CostDecomposition }[],
  amount: number,
  minSplitBenefitBps: number,
): { shouldSplit: boolean; benefitBps: number; rationale: string } {
  // Need at least 2 paths to split.
  if (ranked.length < 2) {
    return { shouldSplit: false, benefitBps: 0, rationale: 'Only one path available' };
  }

  const second = ranked[1];

  // Simulate a 50/50 split between best + second.
  const splitAmount = amount / 2;
  if (second.path.minCapacity < splitAmount) {
    return { shouldSplit: false, benefitBps: 0, rationale: 'Second path lacks capacity for split' };
  }

  // Split cost: weighted average of the two paths' costs.
  const singleCost = best.decomposition.totalBps;
  const splitCost = (best.decomposition.totalBps + second.decomposition.totalBps) / 2;
  const costBenefitBps = singleCost - splitCost;

  // Split failure prob: 1 - (1 - f1)(1 - f2) for parallel execution.
  // (If both paths execute in parallel, the split succeeds if EITHER succeeds —
  // but only if we can tolerate partial fills. For simplicity, we model split
  // failure as the probability that ALL allocations fail simultaneously.)
  const singleFailure = best.path.failureProb;
  const splitFailure = best.path.failureProb * second.path.failureProb;
  const resilienceBenefit = singleFailure - splitFailure; // > 0 means split is more resilient

  // Split if cost benefit OR resilience benefit is significant.
  const shouldSplit = costBenefitBps >= minSplitBenefitBps || resilienceBenefit >= 0.1;

  let rationale: string;
  if (costBenefitBps >= minSplitBenefitBps) {
    rationale = `Split reduces cost by ${costBenefitBps.toFixed(1)} bps (single=${singleCost.toFixed(1)}, split=${splitCost.toFixed(1)})`;
  } else if (resilienceBenefit >= 0.1) {
    rationale = `Split reduces failure probability by ${(resilienceBenefit * 100).toFixed(1)}% (single=${(singleFailure * 100).toFixed(1)}%, split=${(splitFailure * 100).toFixed(1)}%)`;
  } else {
    rationale = 'No split benefit';
  }

  return { shouldSplit, benefitBps: costBenefitBps, rationale };
}

/** Build a single-path split plan (the common case). */
function buildSinglePathPlan(
  request: CompositionRequest,
  path: LiquidityPath,
  decomposition: CostDecomposition,
): SplitPlan {
  return {
    request,
    allocations: [{
      path,
      amount: request.amount,
      percentage: 100,
    }],
    totalCostBps: decomposition.totalBps,
    totalFailureProb: path.failureProb,
    rationale: `Single-path plan via ${path.edges.map((e) => e.lpId ?? e.id).join(' → ')}`,
    isSplit: false,
  };
}

/**
 * Build a split plan: allocate `amount` across paths in score order.
 *
 * Greedy: fill the best path up to its capacity, then the next, etc.
 * If the best path can't handle the full amount, this is forced splitting
 * (capacity-constrained). If it can, this is optional splitting (beneficial).
 */
function buildSplitPlan(
  request: CompositionRequest,
  ranked: { path: LiquidityPath; score: number; decomposition: CostDecomposition }[],
  minSplitBenefitBps: number,
): SplitPlan {
  const allocations: PathAllocation[] = [];
  let remaining = request.amount;
  let weightedCostSum = 0;
  let totalAmountAllocated = 0;

  for (const { path, decomposition } of ranked) {
    if (remaining <= 0) break;
    // Allocate up to the path's capacity.
    const allocAmount = Math.min(remaining, path.minCapacity);
    if (allocAmount <= 0) continue;

    const percentage = (allocAmount / request.amount) * 100;
    allocations.push({ path, amount: allocAmount, percentage });
    weightedCostSum += decomposition.totalBps * allocAmount;
    totalAmountAllocated += allocAmount;
    remaining -= allocAmount;
  }

  if (allocations.length === 0) {
    return {
      request,
      allocations: [],
      totalCostBps: 0,
      totalFailureProb: 1,
      rationale: 'No path has sufficient capacity',
      isSplit: false,
    };
  }

  // Weighted average cost across allocations.
  const totalCostBps = totalAmountAllocated > 0 ? weightedCostSum / totalAmountAllocated : 0;

  // Parallel failure prob: all allocations fail simultaneously.
  // (For partial-fill tolerance, this models "complete failure" — when all
  // paths fail. Partial failures are handled by the execution pipeline.)
  let combinedFailureProb = 1;
  for (const alloc of allocations) {
    combinedFailureProb *= alloc.path.failureProb;
  }

  // Sort allocations by amount descending (deterministic).
  allocations.sort((a, b) => b.amount - a.amount);

  const isSplit = allocations.length > 1;
  let rationale: string;
  if (allocations.length === 1) {
    rationale = `Single-path plan via ${allocations[0].path.edges.map((e) => e.lpId ?? e.id).join(' → ')}`;
  } else if (remaining > 0) {
    rationale = `Forced split across ${allocations.length} paths (capacity-constrained; ${remaining.toFixed(0)} unallocated)`;
  } else {
    rationale = `Beneficial split across ${allocations.length} paths (cost/resilience benefit ≥ ${minSplitBenefitBps} bps)`;
  }

  return {
    request,
    allocations,
    totalCostBps,
    totalFailureProb: combinedFailureProb,
    rationale,
    isSplit,
  };
}
