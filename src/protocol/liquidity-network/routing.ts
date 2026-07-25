/**
 * Routing Optimization — find the best route (single-LP or split) for a
 * corridor + amount.
 *
 * Strategy:
 *  1. Get all active LPs for the corridor, sorted by effective cost
 *     (feeBps + spreadBps + reliability penalty) — via pricing.compete().
 *  2. Filter out unhealthy LPs (unless `opts.allowUnhealthy` is set — but the
 *     default is to avoid them, per the "routing avoids unhealthy LPs" trace).
 *  3. Single-LP mode: take the cheapest LP whose available capacity ≥ amount.
 *  4. Split mode: greedy fill — fill from cheapest first until amount is
 *     covered; each LP contributes up to its available capacity. Subject to
 *     `opts.maxLPs`.
 *  5. Compute confidence (weighted by reputation × capacity coverage) and
 *     reserveExhaustionRisk (probability the route can't fill — based on
 *     available capacity vs amount).
 *
 * Invariants:
 *  - Routing NEVER selects a paused/draining LP (registry.activeLPs filters
 *    them out, plus we double-check state === 'active' on each candidate).
 *  - Routing avoids unhealthy LPs unless explicitly overridden.
 *  - Split routes never assign share > available_capacity / amount (so
 *    capacity reservation will succeed).
 */
import { uid } from '@/kernel/support';
import {
  corridorKey,
  DEFAULT_MAX_LPS_PER_ROUTE,
  type Corridor,
  type LPId,
  type RoutingPlan,
} from './types';
import { liquidityRegistry } from './registry';
import { compete } from './pricing';
import { getAvailableCapacity } from './capacity';
import { lpHealthMonitor } from './health';
import { scoreLP } from './scoring';

export interface RoutingOpts {
  maxLPs?: number;
  minConfidence?: number;
  maxCostBps?: number;
  preferSpeed?: boolean;
  /** If true, allow unhealthy LPs in the route (default false). */
  allowUnhealthy?: boolean;
}

interface RouteCandidate {
  lpId: LPId;
  available: number;
  feeBps: number;
  spreadBps: number;
  effectiveCostBps: number;
  settlementMs: number;
  reputation: number;
  healthy: boolean;
  score: number;
}

/**
 * Gather route candidates — active LPs serving the corridor, sorted by
 * effective cost (cheapest first).
 */
function gatherCandidates(corridor: Corridor, amount: number, opts: RoutingOpts): RouteCandidate[] {
  const bids = compete(corridor, amount);
  const candidates: RouteCandidate[] = [];
  for (const bid of bids) {
    const lp = liquidityRegistry.get(bid.lpId);
    if (!lp || lp.state !== 'active') continue; // invariant: routing skips non-active
    const health = lpHealthMonitor.getHealth(bid.lpId);
    if (!opts.allowUnhealthy && !health.healthy) continue; // routing avoids unhealthy
    const available = getAvailableCapacity(bid.lpId, corridor);
    if (available <= 0) continue;
    const score = scoreLP(bid.lpId, corridor, amount);
    candidates.push({
      lpId: bid.lpId,
      available,
      feeBps: bid.quote.feeBps,
      spreadBps: bid.quote.spreadBps,
      effectiveCostBps: bid.effectiveCostBps,
      settlementMs: lp.settlementSpeedMs,
      reputation: lp.reputation,
      healthy: health.healthy,
      score: score?.score ?? 0,
    });
  }
  // Sort by effective cost (cheapest first) — competition result.
  // If `preferSpeed` is set, sort by settlement time instead (fastest first),
  // using effective cost as a tiebreaker.
  if (opts.preferSpeed) {
    candidates.sort((a, b) => a.settlementMs - b.settlementMs || a.effectiveCostBps - b.effectiveCostBps);
  } else {
    candidates.sort((a, b) => a.effectiveCostBps - b.effectiveCostBps);
  }
  return candidates;
}

/**
 * Compute weighted-average settlement time for a route.
 * (Weighted by amount, since larger splits dominate the route's perceived
 * latency.)
 */
function weightedSettlementMs(route: { amount: number; settlementMs: number }[]): number {
  const total = route.reduce((sum, r) => sum + r.amount, 0);
  if (total === 0) return 0;
  return Math.round(route.reduce((sum, r) => sum + r.settlementMs * r.amount, 0) / total);
}

/**
 * Compute confidence — weighted by LP reputation × capacity coverage.
 * Confidence = Σ (amount_i / amount) × reputation_i × score_i × coverageFactor
 */
function computeConfidence(
  amount: number,
  route: { lpId: LPId; amount: number; reputation: number; score: number; coverage: number }[],
): number {
  if (route.length === 0) return 0;
  if (amount === 0) return 0;
  let sum = 0;
  for (const r of route) {
    const share = r.amount / amount;
    sum += share * r.reputation * r.score * (0.5 + 0.5 * r.coverage);
  }
  return Math.max(0, Math.min(1, sum));
}

/**
 * Compute reserve-exhaustion risk — probability the route can't fill.
 * Based on available capacity vs amount. If Σ available ≥ amount, risk is low
 * but non-zero (LPs may have concurrent reservations). If Σ available < amount,
 * risk = 1.
 */
function computeReserveExhaustionRisk(
  amount: number,
  route: { amount: number; available: number }[],
): number {
  const totalAvailable = route.reduce((sum, r) => sum + r.available, 0);
  if (totalAvailable < amount) return 1; // can't fill
  // If we have at least 1.5× the amount available across the route, risk is
  // near zero. Linear in between.
  const coverage = totalAvailable / amount;
  const risk = Math.max(0, Math.min(1, 1 - (coverage - 1) / 0.5));
  return Math.round(risk * 100) / 100;
}

/**
 * Find the best route for a corridor + amount.
 *
 *  1. If a single LP can fill the amount at the lowest effective cost, use it.
 *  2. Otherwise, split across multiple LPs (greedy fill from cheapest first)
 *     until the amount is covered, capped at `opts.maxLPs`.
 *  3. Apply `opts.minConfidence` and `opts.maxCostBps` filters — if the route
 *     doesn't meet the bar, return null.
 *
 * Returns `null` if no route can fill the amount (insufficient total capacity,
 * or all routes fail the min confidence / max cost filters).
 */
export function findBestRoute(corridor: Corridor, amount: number, opts: RoutingOpts = {}): RoutingPlan | null {
  const maxLPs = opts.maxLPs ?? DEFAULT_MAX_LPS_PER_ROUTE;
  const minConfidence = opts.minConfidence ?? 0;
  const maxCostBps = opts.maxCostBps ?? Number.MAX_SAFE_INTEGER;
  const now = Date.now();

  if (amount <= 0) return null;

  const candidates = gatherCandidates(corridor, amount, opts);
  if (candidates.length === 0) return null;

  // Total available across all candidates — if even combined they can't fill,
  // return null.
  const totalAvailable = candidates.reduce((sum, c) => sum + c.available, 0);
  if (totalAvailable < amount) {
    // Return a degenerate plan with reserveExhaustionRisk = 1 so the caller
    // can see why routing failed.
    return null;
  }

  // --- Greedy fill: take from cheapest LPs first, up to their available ---
  const route: {
    lpId: LPId;
    amount: number;
    feeBps: number;
    settlementMs: number;
    reputation: number;
    score: number;
    available: number;
  }[] = [];
  let remaining = amount;
  for (const c of candidates) {
    if (remaining <= 0) break;
    if (route.length >= maxLPs) break;
    const take = Math.min(remaining, c.available);
    if (take <= 0) continue;
    route.push({
      lpId: c.lpId,
      amount: take,
      feeBps: c.feeBps,
      settlementMs: c.settlementMs,
      reputation: c.reputation,
      score: c.score,
      available: c.available,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    // Couldn't fill (maxLPs cap hit, or total available < amount).
    return null;
  }

  // Compute plan aggregates.
  const totalAmount = route.reduce((s, r) => s + r.amount, 0);
  // Total fee = weighted-average feeBps across the route (by amount).
  const totalFeeBps = totalAmount > 0
    ? Math.round(route.reduce((s, r) => s + r.feeBps * r.amount, 0) / totalAmount)
    : 0;
  const estSettlementMs = weightedSettlementMs(route.map((r) => ({ amount: r.amount, settlementMs: r.settlementMs })));
  const confidence = computeConfidence(
    amount,
    route.map((r) => ({
      lpId: r.lpId,
      amount: r.amount,
      reputation: r.reputation,
      score: r.score,
      coverage: r.amount > 0 ? Math.min(1, r.available / r.amount) : 0,
    })),
  );
  const reserveExhaustionRisk = computeReserveExhaustionRisk(
    amount,
    route.map((r) => ({ amount: r.amount, available: r.available })),
  );
  const estimatedCost = (amount * totalFeeBps) / 10_000;

  // Apply filters.
  if (confidence < minConfidence) return null;
  if (totalFeeBps > maxCostBps) return null;

  return {
    id: uid('plan'),
    corridor,
    amount,
    route: route.map((r) => ({
      lpId: r.lpId,
      amount: r.amount,
      share: r.amount / amount,
      feeBps: r.feeBps,
    })),
    totalFeeBps,
    estimatedSettlementMs: estSettlementMs,
    confidence: Math.round(confidence * 1000) / 1000,
    estimatedCost: Math.round(estimatedCost * 100) / 100,
    reserveExhaustionRisk,
  };
}

/**
 * Refine an existing plan — rebalance splits to minimize cost.
 *
 * Greedy re-fill: recompute candidates and re-fill from cheapest first.
 * Useful when LP capacity has changed since the plan was originally computed
 * (e.g. another settlement consumed capacity in the meantime).
 *
 * Returns a NEW plan (the input is not mutated). If the plan can't be
 * re-filled, returns null.
 */
export function optimizePlan(plan: RoutingPlan, opts: RoutingOpts = {}): RoutingPlan | null {
  return findBestRoute(plan.corridor, plan.amount, opts);
}

/**
 * Quick check — can a single LP fill this amount? Used by callers to decide
 * whether split routing is needed.
 */
export function canFillSingleLP(corridor: Corridor, amount: number): boolean {
  const lps = liquidityRegistry.activeLPs(corridor);
  for (const lp of lps) {
    if (getAvailableCapacity(lp.id, corridor) >= amount) return true;
  }
  return false;
}

/** Total available capacity across all active LPs for a corridor. */
export function totalAvailableCapacity(corridor: Corridor): number {
  const lps = liquidityRegistry.activeLPs(corridor);
  let total = 0;
  for (const lp of lps) {
    total += getAvailableCapacity(lp.id, corridor);
  }
  return total;
}

// Re-export corridorKey so callers don't need to import from types directly.
export { corridorKey };
