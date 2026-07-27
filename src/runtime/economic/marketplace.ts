/**
 * Economic Marketplace — the LP auction mechanism.
 * (M-RT-25, Economic Kernel.)
 *
 * The marketplace sits between the Compiler and the LP Runtime. Instead of
 * the compiler directly choosing routes, it requests offers from the
 * marketplace:
 *
 *   Compiler → Marketplace.requestOffers(from, to, amount)
 *            → Marketplace queries LP Runtime for active offers
 *            → Marketplace ranks offers by (spread, latency, risk, confidence)
 *            → Returns ranked execution candidates
 *
 * The marketplace is PURE: it never executes, never emits events. It only
 * RECOMMENDS the best execution plan from available LP offers.
 */

import type { LPOffer, EconomicLPProfile } from './lp-runtime';
import type { LPRuntimeProjection } from './lp-runtime';

/** A request for liquidity. */
export interface LiquidityRequest {
  from: string;
  to: string;
  amount: number;
  /** Maximum acceptable spread (bps). */
  maxSpreadBps?: number;
  /** Maximum acceptable latency (ms). */
  maxLatencyMs?: number;
}

/** A ranked execution candidate (one LP's offer for the request). */
export interface ExecutionCandidate {
  offer: LPOffer;
  lp: EconomicLPProfile;
  /** Total cost in bps (spread + risk penalty + latency penalty). */
  totalCostBps: number;
  /** Score [0, 1] — lower is better. */
  score: number;
  /** Whether this candidate can handle the full amount. */
  canHandleAmount: boolean;
}

/** The marketplace's response to a liquidity request. */
export interface MarketplaceResponse {
  request: LiquidityRequest;
  candidates: ExecutionCandidate[];
  bestCandidate: ExecutionCandidate | null;
  /** Whether the marketplace found any viable candidates. */
  hasLiquidity: boolean;
}

/** Scoring weights (lower = better). */
const SPREAD_WEIGHT = 0.5;
const LATENCY_WEIGHT = 0.2;
const RISK_WEIGHT = 0.2;
const CONFIDENCE_WEIGHT = 0.1;

// Cost penalties.
const LATENCY_COST_PER_MS = 0.01; // bps per ms
const RISK_COST_MULTIPLIER = 100; // bps per unit of risk

/**
 * Economic Marketplace — the LP auction.
 *
 * Pure: same request + LP state → same response. No side effects.
 */
export class EconomicMarketplace {
  constructor(private lpRuntime: LPRuntimeProjection) {}

  /**
   * Request liquidity from the marketplace.
   *
   * Queries all active LP offers for the corridor, ranks them by
   * (spread + latency + risk + confidence), and returns the best candidate.
   */
  requestOffers(request: LiquidityRequest): MarketplaceResponse {
    const offers = this.lpRuntime.offersForCorridor(request.from, request.to);

    // Filter by constraints.
    let filtered = offers;
    if (request.maxSpreadBps !== undefined) {
      filtered = filtered.filter((o) => o.spreadBps <= request.maxSpreadBps!);
    }
    if (request.maxLatencyMs !== undefined) {
      filtered = filtered.filter((o) => o.latencyMs <= request.maxLatencyMs!);
    }

    // Score each offer.
    const candidates: ExecutionCandidate[] = filtered.map((offer) => {
      const lp = this.lpRuntime.getLP(offer.lpId);
      if (!lp) return null;

      const canHandleAmount = offer.capacity >= request.amount;

      // Cost decomposition: spread + latency penalty + risk penalty.
      const latencyBps = offer.latencyMs * LATENCY_COST_PER_MS;
      const riskBps = offer.riskScore * RISK_COST_MULTIPLIER;
      const totalCostBps = offer.spreadBps + latencyBps + riskBps;

      // Normalized score [0, 1] — lower is better.
      const spreadNorm = Math.min(1, offer.spreadBps / 500); // 500 bps = 5%
      const latencyNorm = Math.min(1, offer.latencyMs / 60_000); // 60s
      const riskNorm = Math.min(1, offer.riskScore);
      const confidenceNorm = Math.min(1, 1 - offer.confidence); // invert: lower confidence = higher score

      const score =
        spreadNorm * SPREAD_WEIGHT +
        latencyNorm * LATENCY_WEIGHT +
        riskNorm * RISK_WEIGHT +
        confidenceNorm * CONFIDENCE_WEIGHT;

      return {
        offer,
        lp,
        totalCostBps,
        score,
        canHandleAmount,
      } as ExecutionCandidate;
    }).filter(Boolean) as ExecutionCandidate[];

    // Sort by (canHandleAmount desc, score asc).
    candidates.sort((a, b) => {
      if (a.canHandleAmount !== b.canHandleAmount) return a.canHandleAmount ? -1 : 1;
      return a.score - b.score;
    });

    const bestCandidate = candidates[0] ?? null;

    return {
      request,
      candidates,
      bestCandidate,
      hasLiquidity: candidates.length > 0,
    };
  }

  /**
   * Multi-hop liquidity search: find a path of offers from `from` to `to`
   * using the LP marketplace.
   *
   * This integrates with the LiquidityComposer (M-RT-16) — the marketplace
   * provides the LP offers, the composer finds the best path.
   */
  requestMultiHop(request: LiquidityRequest, maxHops: number = 3): {
    path: LPOffer[];
    totalCostBps: number;
    feasible: boolean;
  } {
    // Simple BFS/DFS through the LP offer graph.
    const allOffers = this.lpRuntime.listOffers();

    interface PathNode {
      currentCurrency: string;
      offers: LPOffer[];
      totalCost: number;
    }

    const queue: PathNode[] = [{ currentCurrency: request.from, offers: [], totalCost: 0 }];
    const visited = new Set<string>([request.from]);

    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node.offers.length >= maxHops) continue;

      if (node.currentCurrency === request.to && node.offers.length > 0) {
        return { path: node.offers, totalCostBps: node.totalCost, feasible: true };
      }

      for (const offer of allOffers) {
        if (offer.from !== node.currentCurrency) continue;
        if (visited.has(offer.to)) continue;
        if (offer.capacity < request.amount) continue;

        visited.add(offer.to);
        queue.push({
          currentCurrency: offer.to,
          offers: [...node.offers, offer],
          totalCost: node.totalCost + offer.spreadBps,
        });
      }
    }

    return { path: [], totalCostBps: 0, feasible: false };
  }
}
