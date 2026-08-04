/**
 * EKG — Cost-Based Optimizer.
 *
 * Replaces single heuristic scoring with multi-objective optimization.
 * Produces a Pareto frontier: the set of proofs where no proof is strictly
 * dominated by another on all objectives.
 *
 * Objectives:
 *   - MINIMIZE cost (USD)
 *   - MINIMIZE latency (ms)
 *   - MAXIMIZE trust (0–100)
 *   - MINIMIZE carbon (kgCO2e)
 *
 * Given a set of proofs, the optimizer:
 *   1. Computes the Pareto frontier (non-dominated proofs).
 *   2. For each proof, computes which objective it's best at.
 *   3. Returns the frontier + recommendations for each optimization target.
 *
 * Like a SQL optimizer: "minimum cost plan", "minimum latency plan",
 * "maximum trust plan" — all from the same set of candidate proofs.
 */

import type { Proof } from './types';

export type OptimizationObjective = 'MIN_COST' | 'MIN_LATENCY' | 'MAX_TRUST' | 'MIN_CARBON';

export interface ParetoProof {
  proof: Proof;
  dominated: boolean;
  bestAt: OptimizationObjective[];
  paretoRank: number;         // 1 = frontier, 2 = dominated by one, etc.
}

export interface OptimizationResult {
  frontier: ParetoProof[];     // non-dominated proofs
  allProofs: ParetoProof[];    // all proofs with domination info
  recommendations: {
    minCost?: ParetoProof;
    minLatency?: ParetoProof;
    maxTrust?: ParetoProof;
    minCarbon?: ParetoProof;
    balanced?: ParetoProof;    // closest to utopian point
  };
  utopianPoint: { cost: number; latencyMs: number; trust: number; carbon: number };
  totalCandidates: number;
  frontierSize: number;
}

/**
 * Check if proof A dominates proof B.
 * A dominates B if A is at least as good as B on all objectives AND
 * strictly better on at least one.
 */
function dominates(a: Proof, b: Proof): boolean {
  // For minimization objectives: lower is better
  const aCost = a.totalCost;
  const bCost = b.totalCost;
  const aLat = a.totalLatencyMs;
  const bLat = b.totalLatencyMs;
  const aCarbon = a.carbon;
  const bCarbon = b.carbon;
  // For maximization: higher is better
  const aTrust = a.trustScore;
  const bTrust = b.trustScore;

  // A is at least as good on all
  const atLeastAsGood =
    aCost <= bCost && aLat <= bLat && aCarbon <= bCarbon && aTrust >= bTrust;
  // A is strictly better on at least one
  const strictlyBetter =
    aCost < bCost || aLat < bLat || aCarbon < bCarbon || aTrust > bTrust;

  return atLeastAsGood && strictlyBetter;
}

/**
 * Compute the Pareto frontier from a set of proofs.
 * Returns all proofs with domination info + recommendations.
 */
export function optimize(proofs: Proof[]): OptimizationResult {
  if (proofs.length === 0) {
    return {
      frontier: [],
      allProofs: [],
      recommendations: {},
      utopianPoint: { cost: 0, latencyMs: 0, trust: 100, carbon: 0 },
      totalCandidates: 0,
      frontierSize: 0,
    };
  }

  // Compute domination
  const paretoProofs: ParetoProof[] = proofs.map((proof) => ({
    proof,
    dominated: false,
    bestAt: [],
    paretoRank: 0,
  }));

  // Mark dominated proofs
  for (let i = 0; i < paretoProofs.length; i++) {
    for (let j = 0; j < paretoProofs.length; j++) {
      if (i === j) continue;
      if (dominates(paretoProofs[j].proof, paretoProofs[i].proof)) {
        paretoProofs[i].dominated = true;
        break;
      }
    }
  }

  // Compute Pareto rank (simplified: 1 for frontier, 2 for everything else)
  for (const pp of paretoProofs) {
    pp.paretoRank = pp.dominated ? 2 : 1;
  }

  // Find the best proof for each objective
  let minCost = Infinity, minCostIdx = -1;
  let minLat = Infinity, minLatIdx = -1;
  let maxTrust = -Infinity, maxTrustIdx = -1;
  let minCarbon = Infinity, minCarbonIdx = -1;

  for (let i = 0; i < proofs.length; i++) {
    if (proofs[i].totalCost < minCost) { minCost = proofs[i].totalCost; minCostIdx = i; }
    if (proofs[i].totalLatencyMs < minLat) { minLat = proofs[i].totalLatencyMs; minLatIdx = i; }
    if (proofs[i].trustScore > maxTrust) { maxTrust = proofs[i].trustScore; maxTrustIdx = i; }
    if (proofs[i].carbon < minCarbon) { minCarbon = proofs[i].carbon; minCarbonIdx = i; }
  }

  // Mark best-at
  if (minCostIdx >= 0) paretoProofs[minCostIdx].bestAt.push('MIN_COST');
  if (minLatIdx >= 0) paretoProofs[minLatIdx].bestAt.push('MIN_LATENCY');
  if (maxTrustIdx >= 0) paretoProofs[maxTrustIdx].bestAt.push('MAX_TRUST');
  if (minCarbonIdx >= 0) paretoProofs[minCarbonIdx].bestAt.push('MIN_CARBON');

  // Compute utopian point (best value on each objective across all proofs)
  const utopianPoint = {
    cost: minCost,
    latencyMs: minLat,
    trust: maxTrust,
    carbon: minCarbon,
  };

  // Find balanced proof (closest to utopian point, normalized)
  const costRange = Math.max(...proofs.map((p) => p.totalCost)) - utopianPoint.cost || 1;
  const latRange = Math.max(...proofs.map((p) => p.totalLatencyMs)) - utopianPoint.latencyMs || 1;
  const trustRange = utopianPoint.trust - Math.min(...proofs.map((p) => p.trustScore)) || 1;
  const carbonRange = Math.max(...proofs.map((p) => p.carbon)) - utopianPoint.carbon || 1;

  let balancedDist = Infinity;
  let balancedIdx = -1;
  for (let i = 0; i < proofs.length; i++) {
    const dist =
      Math.pow((proofs[i].totalCost - utopianPoint.cost) / costRange, 2) +
      Math.pow((proofs[i].totalLatencyMs - utopianPoint.latencyMs) / latRange, 2) +
      Math.pow((utopianPoint.trust - proofs[i].trustScore) / trustRange, 2) +
      Math.pow((proofs[i].carbon - utopianPoint.carbon) / carbonRange, 2);
    if (dist < balancedDist) { balancedDist = dist; balancedIdx = i; }
  }

  const frontier = paretoProofs.filter((pp) => !pp.dominated);

  return {
    frontier,
    allProofs: paretoProofs,
    recommendations: {
      minCost: minCostIdx >= 0 ? paretoProofs[minCostIdx] : undefined,
      minLatency: minLatIdx >= 0 ? paretoProofs[minLatIdx] : undefined,
      maxTrust: maxTrustIdx >= 0 ? paretoProofs[maxTrustIdx] : undefined,
      minCarbon: minCarbonIdx >= 0 ? paretoProofs[minCarbonIdx] : undefined,
      balanced: balancedIdx >= 0 ? paretoProofs[balancedIdx] : undefined,
    },
    utopianPoint,
    totalCandidates: proofs.length,
    frontierSize: frontier.length,
  };
}
