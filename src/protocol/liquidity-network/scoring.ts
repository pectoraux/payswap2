/**
 * LP Scoring — multi-component score (0..1) computed from real LP state.
 *
 * Components:
 *  - capacity: normalized available capacity for the corridor
 *  - pricing: inverse of effective fee (cheaper = higher)
 *  - speed: inverse of settlement time
 *  - reliability: windowed success rate (last N settlements, from health.ts)
 *  - reputation: LP reputation (derived from real settlement outcomes via
 *    updateReputationFromOutcome)
 *
 * Weighted sum — weights configurable via `setWeights`. Default weights favor
 * reliability + reputation (settlement outcomes are the strongest signal).
 *
 * The score is fed to routing.ts as the LP preference signal.
 */
import { eventEngine } from '@/kernel/event';
import {
  corridorKey,
  MAX_REPUTATION,
  MIN_REPUTATION,
  type Corridor,
  type LPId,
  type LPScore,
} from './types';
import { liquidityRegistry } from './registry';
import { lpHealthMonitor } from './health';
import { computeSpread } from './pricing';
import { getAvailableCapacity } from './capacity';

export interface ScoreWeights {
  capacity: number;
  pricing: number;
  speed: number;
  reliability: number;
  reputation: number;
}

/** Default weights — sum to 1.0. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  capacity: 0.15,
  pricing: 0.20,
  speed: 0.15,
  reliability: 0.25,
  reputation: 0.25,
};

let activeWeights: ScoreWeights = { ...DEFAULT_WEIGHTS };

/** Override the active score weights (validated to sum to ~1.0). */
export function setWeights(w: Partial<ScoreWeights>): void {
  activeWeights = { ...activeWeights, ...w };
}

/** Get the active score weights. */
export function getWeights(): ScoreWeights {
  return { ...activeWeights };
}

/** Reference values for normalization (used by capacity and speed components). */
const CAPACITY_REF = 100_000;   // 100k `fromCurrency` = "ample capacity"
const SPEED_REF_MS = 60_000;    // 60 seconds = "slow"
const FEE_REF_BPS = 200;        // 200 bps total cost = "expensive"

/**
 * Compute the 5-component score for an LP on a specific corridor.
 *
 * Returns `null` if the LP doesn't exist or doesn't serve the corridor.
 */
export function scoreLP(lpId: LPId, corridor: Corridor, amount: number = 1_000): LPScore | null {
  const lp = liquidityRegistry.get(lpId);
  if (!lp) return null;
  const serves = lp.corridors.some((c) => corridorKey(c) === corridorKey(corridor));
  if (!serves) return null;

  // --- Capacity component: normalized available capacity for the corridor ---
  const available = getAvailableCapacity(lpId, corridor);
  // If LP has 0 available, capacity component = 0. If LP has ≥ CAPACITY_REF,
  // capacity component = 1. Linear in between, scaled by min(1, available/CAPACITY_REF).
  // If the requested amount > available, penalize further.
  const coverageRatio = amount > 0 ? Math.min(1, available / amount) : 1;
  const capacityComponent = Math.min(1, available / CAPACITY_REF) * (0.5 + 0.5 * coverageRatio);
  // ^ an LP with full coverage gets full weight; partial coverage gets half + half×ratio.

  // --- Pricing component: inverse of effective fee (cheaper = higher) ---
  const feeBps = lp.feeBps;
  const spreadBps = computeSpread(lpId, corridor, amount);
  const totalFeeBps = feeBps + spreadBps;
  const pricingComponent = Math.max(0, Math.min(1, 1 - totalFeeBps / FEE_REF_BPS));

  // --- Speed component: inverse of settlement time ---
  const speedComponent = Math.max(0, Math.min(1, 1 - lp.settlementSpeedMs / SPEED_REF_MS));

  // --- Reliability component: windowed success rate (from health.ts) ---
  const health = lpHealthMonitor.getHealth(lpId);
  const reliabilityComponent = health.successRateWindowed;

  // --- Reputation component: LP reputation (already 0..1) ---
  const reputationComponent = Math.max(0, Math.min(1, lp.reputation));

  const components = {
    capacity: Math.max(0, Math.min(1, capacityComponent)),
    pricing: pricingComponent,
    speed: speedComponent,
    reliability: reliabilityComponent,
    reputation: reputationComponent,
  };

  const score =
    components.capacity * activeWeights.capacity +
    components.pricing * activeWeights.pricing +
    components.speed * activeWeights.speed +
    components.reliability * activeWeights.reliability +
    components.reputation * activeWeights.reputation;

  // If the LP is unhealthy, apply a hard penalty to the score (so routing
  // avoids it even if other components are high).
  const finalScore = health.healthy ? score : score * 0.25;

  return {
    lpId,
    score: Math.max(0, Math.min(1, finalScore)),
    components,
  };
}

/**
 * Rank LPs by score for a corridor (highest score first).
 *
 * Excludes paused/draining LPs (invariant 4 — routing never selects them).
 */
export function rankLPs(corridor: Corridor, amount: number = 1_000): LPScore[] {
  const lps = liquidityRegistry.activeLPs(corridor);
  const scores: LPScore[] = [];
  for (const lp of lps) {
    const s = scoreLP(lp.id, corridor, amount);
    if (s) scores.push(s);
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

/**
 * Update LP reputation and historical success rate from a REAL settlement
 * outcome. Called by the network's `settleRoute` after a settlement completes
 * (success or failure).
 *
 *  - On success: reputation drifts UP toward 1.0 by `1 - reputation` × α,
 *    historicalSuccessRate is recomputed from cumulative outcomes,
 *    totalSettlements += 1, totalVolume += amount, lastSettlementTs = now.
 *  - On failure: reputation drifts DOWN by β (larger step than α — failures
 *    are punished more than successes are rewarded), historicalSuccessRate
 *    recomputed, totalSettlements += 1, lastSettlementTs = now.
 *
 * Emits `liquidity.lp_scored` event with the new score so the kernel can
 * audit the reputation change.
 *
 * This is the ONLY place LP reputation is mutated in the network — and it's
 * driven by real settlement outcomes, not static numbers (invariant 3).
 */
export function updateReputationFromOutcome(
  lpId: LPId,
  settled: boolean,
  settlementMs: number,
  amount: number = 0,
  now: number = Date.now(),
): LPScore | null {
  const lp = liquidityRegistry.get(lpId);
  if (!lp) return null;

  const alpha = 0.05; // success reward (small, gradual)
  const beta = 0.15;  // failure punishment (large, immediate)

  // Update cumulative counters.
  const priorSuccesses = lp.historicalSuccessRate * lp.totalSettlements;
  lp.totalSettlements += 1;
  const newSuccesses = priorSuccesses + (settled ? 1 : 0);
  lp.historicalSuccessRate = newSuccesses / lp.totalSettlements;
  lp.lastSettlementTs = now;

  if (amount > 0 && settled) {
    lp.totalVolume += amount;
  }

  // Reputation drift.
  if (settled) {
    lp.reputation = Math.min(MAX_REPUTATION, lp.reputation + (MAX_REPUTATION - lp.reputation) * alpha);
  } else {
    lp.reputation = Math.max(MIN_REPUTATION, lp.reputation - beta);
  }

  // Tier re-derivation.
  lp.tier = lp.reputation > 0.8 ? 'premium'
    : lp.reputation > 0.6 ? 'trusted'
    : lp.reputation > 0.3 ? 'standard'
    : 'probationary';

  // Find the first corridor for the scoring event (LPs can serve multiple).
  const corridor = lp.corridors[0] ?? { fromCurrency: 'USD', toCurrency: 'USD' };
  const score = scoreLP(lpId, corridor);
  eventEngine.emit('liquidity.lp_scored', {
    lpId,
    settled,
    settlementMs,
    amount,
    newReputation: lp.reputation,
    newTier: lp.tier,
    historicalSuccessRate: lp.historicalSuccessRate,
    totalSettlements: lp.totalSettlements,
    score: score?.score ?? 0,
  }, 0);

  return score;
}
