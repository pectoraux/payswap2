/**
 * Liquidity Marketplace — market intent only. (M-RT-5.)
 *
 * SCOPE: the marketplace answers:
 *   - Which liquidity offers currently exist?
 *   - Which are compatible with this capability?
 *   - Which satisfy these constraints?
 *   - Which would clear if requested?
 *
 * It does NOT:
 *   - execute allocations
 *   - modify reserves
 *   - perform routing
 *   - invoke the compiler
 *
 * DEPENDENCY DIRECTION (one-way, no cycles):
 *   Capability Graph + Reserve Ledger + Reserve Market
 *       ↓ (reads only)
 *   Liquidity Marketplace
 *       ↓ (reads only)
 *   Compiler (the FIRST component that reasons across ALL domains)
 *
 * The marketplace CONSUMES reserve economics (shadow price, utilization) but
 * does NOT calculate them — that's the Reserve Market's job. The compiler is
 * the first component that combines everything.
 *
 * PROJECTION DISCIPLINE: the order book is rebuilt entirely from offer events
 * (offer.published, offer.withdrawn, offer.expired). Same pattern as the
 * Capability Graph and Reserve Ledger.
 *
 * DETERMINISM: given identical offer events + identical clearing context, the
 * marketplace always produces identical quotes + clearing results.
 */

import type { Rail } from '../liquidity-market/types';

// ─── Offers ─────────────────────────────────────────────────────────────────

/** An LP's liquidity offer — a promise to provide liquidity on a route. */
export interface LiquidityOffer {
  id: string;
  lpId: string;
  /** The capability this offer references (from the Capability Graph). */
  capabilityId: string;
  from: string;              // asset (e.g. 'KES')
  to: string;                // asset (e.g. 'TwinGHS')
  rail: Rail;
  /** Maximum amount this offer can serve. */
  maxAmount: number;
  /** Minimum amount (offers below this are ignored). */
  minAmount: number;
  /** Utilization-tiered pricing curve. */
  pricingCurve: PricingCurveTier[];
  /** Settlement latency in ms. */
  latencyMs: number;
  /** Risk score 0..1 (lower = safer). */
  riskScore: number;
  /** Offer expiry (Runtime Clock ms). Offers past this are ignored. */
  expiresAt: number;
  /** Published at (Runtime Clock ms). */
  publishedAt: number;
  active: boolean;
}

/** A utilization-tiered pricing curve tier. */
export interface PricingCurveTier {
  /** [low, high] utilization bounds (0..1). */
  utilizationRange: [number, number];
  /** Fee in basis points for this tier. */
  feeBps: number;
}

// ─── Quotes ─────────────────────────────────────────────────────────────────

/** A request for a quote. */
export interface QuoteRequest {
  from: string;
  to: string;
  amount: number;
  /** Optional: prefer specific rail. */
  rail?: Rail;
  /** The Runtime Clock time (for expiry checking). */
  now: number;
}

/** A quote from one LP for a specific request. */
export interface Quote {
  offerId: string;
  lpId: string;
  from: string;
  to: string;
  amount: number;
  /** The fee in bps, derived from the offer's pricing curve at the LP's current utilization. */
  feeBps: number;
  /** The total fee amount. */
  feeAmount: number;
  latencyMs: number;
  riskScore: number;
  /** Why this offer was selected (or rejected). */
  status: 'valid' | 'expired' | 'insufficient_capacity' | 'below_minimum' | 'rail_mismatch';
}

// ─── Clearing ───────────────────────────────────────────────────────────────

/** A request to clear (match) offers for a payment. */
export interface ClearingRequest {
  from: string;
  to: string;
  amount: number;
  rail?: Rail;
  now: number;
}

/** A clearing result — which offers would clear, ranked. */
export interface ClearingResult {
  request: ClearingRequest;
  /** Valid quotes, sorted by (feeBps, latencyMs, riskScore) — deterministic ordering. */
  quotes: Quote[];
  /** The winning quote (lowest fee, then lowest latency, then lowest risk). */
  winner: Quote | null;
  /** Rejected offers + reasons. */
  rejected: Quote[];
  /** Whether the request can be fully satisfied. */
  canClear: boolean;
  generatedAt: number;
}

// ─── Order Book (the projection) ────────────────────────────────────────────

/**
 * The order book — a projection rebuilt entirely from offer events.
 * Same pattern as the Capability Graph and Reserve Ledger.
 */
export interface OrderBook {
  /** All active, non-expired offers. */
  offers: LiquidityOffer[];
  /** Offers matching a route (from→to). */
  forRoute(from: string, to: string): LiquidityOffer[];
  /** Offers from one LP. */
  forLP(lpId: string): LiquidityOffer[];
}

/** The Domain Events the marketplace emits. */
export type MarketplaceEventType =
  | 'offer.published'
  | 'offer.withdrawn'
  | 'offer.expired';

/** An uncommitted marketplace event. */
export interface MarketplaceUncommittedEvent {
  type: MarketplaceEventType;
  streamId: string;           // `${environment}:offer:${offerId}`
  streamType: 'offer';
  kind: 'domain';
  payload: Record<string, unknown>;
}

// ─── Invariants ─────────────────────────────────────────────────────────────

/** Validate an offer. Returns violations (empty = valid). */
export function validateOffer(offer: LiquidityOffer): string[] {
  const violations: string[] = [];
  if (offer.maxAmount <= 0) violations.push('maxAmount must be > 0');
  if (offer.minAmount < 0) violations.push('minAmount must be ≥ 0');
  if (offer.minAmount > offer.maxAmount) violations.push('minAmount must be ≤ maxAmount');
  if (offer.pricingCurve.length === 0) violations.push('pricingCurve must have ≥ 1 tier');
  if (offer.riskScore < 0 || offer.riskScore > 1) violations.push('riskScore must be in [0, 1]');
  if (offer.latencyMs < 0) violations.push('latencyMs must be ≥ 0');
  for (const tier of offer.pricingCurve) {
    if (tier.feeBps < 0) violations.push('pricingCurve tier feeBps must be ≥ 0');
    if (tier.utilizationRange[0] < 0 || tier.utilizationRange[1] > 1.01) {
      violations.push('pricingCurve tier utilization must be in [0, 1]');
    }
  }
  return violations;
}

/** Check if an offer is expired at a given time. */
export function isExpired(offer: LiquidityOffer, now: number): boolean {
  return offer.expiresAt > 0 && now >= offer.expiresAt;
}

/** Check if an offer can serve a given amount. */
export function canServeAmount(offer: LiquidityOffer, amount: number): boolean {
  return amount >= offer.minAmount && amount <= offer.maxAmount;
}

/**
 * Quote a fee for a given amount + utilization. Pure, deterministic.
 * Picks the pricing-curve tier matching the utilization.
 */
export function quoteFee(offer: LiquidityOffer, utilization: number): number {
  for (const tier of offer.pricingCurve) {
    if (utilization >= tier.utilizationRange[0] && utilization < tier.utilizationRange[1]) {
      return tier.feeBps;
    }
  }
  // Default to the last tier (highest utilization = highest fee).
  return offer.pricingCurve[offer.pricingCurve.length - 1]?.feeBps ?? 0;
}
