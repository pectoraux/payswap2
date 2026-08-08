/**
 * PaySwap Protocol — Settlement Waterfall (the SINGLE tier-selection rule).
 *
 * This module is the ONE place in the codebase that decides which settlement
 * tier a payment is routed through. Both the LiquidityPolicyEngine
 * (`selectStrategy`) and the runtime PaymentCommandHandler (in
 * `runtime/dispatcher/handlers.ts`) import + call `resolvePayment` — there
 * is no parallel implementation.
 *
 * Why this file exists:
 *   Before this module existed, tier selection was hand-coded in
 *   `policy-engine.ts::selectStrategy()` AND re-implemented (with subtly
 *   different rules) inside `handlers.ts`. That split was the load-bearing
 *   defect behind the "silent routing change" risk: a money-type refactor
 *   could alter one path without updating the other. The single-rule
 *   invariant test (`tests/single-rule-invariant.test.ts`) asserts this
 *   module is the only tier selector; the routing-golden test
 *   (`tests/routing.golden.test.ts`) pins the exact tier chosen for each
 *   canonical input shape.
 *
 * Tier model:
 *   1  LOCAL_RAIL          — same country + same currency, sender+receiver
 *                            both have fiat, amount within balance.
 *   2  RESERVE_TO_RESERVE  — cross-currency, both countries have fiat
 *                            reserves (or LP fiat bridges the receiver).
 *   3  MARKET_TO_RESERVE   — sender has no reserve + no LP fiat, receiver
 *                            has fiat (sell sender-side via market, settle
 *                            into receiver reserve).
 *   4  MARKET_TO_MARKET    — neither side has fiat; LP stablecoin/crypto
 *                            bridge provides liquidity. Falls back to
 *                            tier 5 if no LP can cover.
 *   5  MANUAL_SETTLEMENT   — no reserve, no bandwidth, no LP crypto.
 *                            The payment is queued for manual review
 *                            (the only honest answer when there's nothing
 *                            to settle with).
 *
 * The function is pure: same input → same output, every time.
 */
import { isLocal } from '@/protocol/chains/stellar/assets';
import type {
  SettlementStrategy,
  PolicyEngineInput,
  ReserveState,
  BandwidthPosition,
} from './policy-engine';

/** A 1..5 settlement tier (1 = cheapest/most-local, 5 = manual fallback). */
export type SettlementTier = 1 | 2 | 3 | 4 | 5;

/** The canonical tier-selection input — same shape as `PolicyEngineInput`. */
export type ResolvePaymentInput = PolicyEngineInput;

/** The canonical tier-selection result. */
export interface ResolvePaymentResult {
  /** 1..5 tier. */
  tier: SettlementTier;
  /** The matching `SettlementStrategy` label, or `MANUAL_SETTLEMENT` for tier 5. */
  strategy: SettlementStrategy | 'MANUAL_SETTLEMENT';
  /** Why this tier was selected — human-readable, deterministic. */
  reason: string;
  /** Whether the sender has any fiat reserve at all. */
  senderHasFiat: boolean;
  /** Whether the receiver has any fiat reserve at all. */
  receiverHasFiat: boolean;
  /** Whether the LP side can supply fiat on either end. */
  lpHasFiat: boolean;
  /** Whether the LP side can supply crypto/stablecoin. */
  lpHasCrypto: boolean;
}

/** Sentinel for the manual-settlement fallback (not part of the legacy 5-strategy enum). */
export const MANUAL_SETTLEMENT_STRATEGY = 'MANUAL_SETTLEMENT' as const;

/**
 * Does any LP in the list have `fiat` bandwidth covering `amount` in `currency`?
 * Pure helper — no mutation, no side effects.
 */
function lpHasFiatBandwidth(
  bandwidth: BandwidthPosition[],
  currency: string,
  amount: number,
): boolean {
  if (!bandwidth || bandwidth.length === 0) return false;
  return bandwidth.some(
    (b) =>
      b.assetType === 'fiat' &&
      b.currency === currency &&
      b.status === 'active' &&
      b.available >= amount,
  );
}

/**
 * Does any LP in the list have non-fiat (stablecoin or twin_token) bandwidth
 * covering `amount` in `currency`? Crypto/stablecoin bridges a market-to-market
 * gap when neither side has fiat reserves.
 */
function lpHasCryptoBandwidth(
  bandwidth: BandwidthPosition[],
  currency: string,
  amount: number,
): boolean {
  if (!bandwidth || bandwidth.length === 0) return false;
  return bandwidth.some(
    (b) =>
      (b.assetType === 'stablecoin' || b.assetType === 'twin_token') &&
      b.currency === currency &&
      b.status === 'active' &&
      b.available >= amount,
  );
}

/**
 * Does the reserve state have enough available fiat to cover `amount`?
 * `hasFiatReserve` is a coarse flag; this also enforces the magnitude.
 */
function reserveCovers(reserve: ReserveState, amount: number): boolean {
  return (
    !!reserve &&
    reserve.hasFiatReserve === true &&
    (reserve.fiatReserveAmount ?? 0) >= amount
  );
}

/**
 * Resolve the settlement tier for a payment intent. Pure + deterministic.
 *
 * Decision matrix (evaluated top-down — first match wins):
 *
 *   TIER 1 (LOCAL_RAIL):
 *     isLocal(from, to, fcy, tcy)                  // same country+currency
 *     AND reserveCovers(senderReserve, amount)     // sender has fiat
 *     AND reserveCovers(receiverReserve, amount)   // receiver has fiat
 *
 *   TIER 2 (RESERVE_TO_RESERVE):
 *     NOT isLocal                                  // cross-currency
 *     AND (
 *       (reserveCovers(sender, amt) AND reserveCovers(receiver, amt))
 *       OR                                         // both have reserves
 *       (reserveCovers(sender, amt) AND lpHasFiat(receiverBW, tcy, amt))
 *       OR                                         // LP fiat bridges receiver
 *       (lpHasFiat(senderBW, fcy, amt) AND reserveCovers(receiver, amt))
 *     )
 *
 *   TIER 3 (MARKET_TO_RESERVE):
 *     NOT (tier 1 or 2)
 *     AND reserveCovers(receiverReserve, amount)   // receiver has fiat
 *     AND NOT reserveCovers(senderReserve, amount) // sender doesn't
 *     AND NOT lpHasFiat(senderBW, fcy, amount)     // no LP fiat on sender side
 *
 *   TIER 4 (MARKET_TO_MARKET):
 *     NOT (tier 1, 2, or 3)
 *     AND lpHasCrypto(senderBW | receiverBW, ...)  // LP can bridge via crypto
 *
 *   TIER 5 (MANUAL_SETTLEMENT):
 *     None of the above. No reserve, no bandwidth, no LP crypto.
 */
export function resolvePayment(input: ResolvePaymentInput): ResolvePaymentResult {
  const amount = Math.max(0, input.amount ?? 0);
  const senderHasFiat = reserveCovers(input.senderReserve, amount);
  const receiverHasFiat = reserveCovers(input.receiverReserve, amount);
  const lpHasFiat =
    lpHasFiatBandwidth(input.senderBandwidth, input.fromCurrency, amount) ||
    lpHasFiatBandwidth(input.receiverBandwidth, input.toCurrency, amount);
  const lpHasCrypto =
    lpHasCryptoBandwidth(input.senderBandwidth, input.fromCurrency, amount) ||
    lpHasCryptoBandwidth(input.receiverBandwidth, input.toCurrency, amount);

  const local = isLocal(
    input.fromCountry,
    input.toCountry,
    input.fromCurrency,
    input.toCurrency,
  );

  // ── Tier 1: LOCAL_RAIL ─────────────────────────────────────────────
  if (local && senderHasFiat && receiverHasFiat) {
    return {
      tier: 1,
      strategy: 'LOCAL_RAIL',
      reason: 'LOCAL_RAIL: same country+currency, both reserves have fiat',
      senderHasFiat,
      receiverHasFiat,
      lpHasFiat,
      lpHasCrypto,
    };
  }

  // ── Tier 2: RESERVE_TO_RESERVE ────────────────────────────────────
  // Cross-currency (or local-but-one-side-short) where both ends are
  // coverable via reserves ± LP fiat bridge.
  if (!local) {
    const bothReservesCover = senderHasFiat && receiverHasFiat;
    const senderReserveLpReceiverFiat =
      senderHasFiat &&
      lpHasFiatBandwidth(input.receiverBandwidth, input.toCurrency, amount);
    const lpSenderFiatReceiverReserve =
      receiverHasFiat &&
      lpHasFiatBandwidth(input.senderBandwidth, input.fromCurrency, amount);

    if (bothReservesCover || senderReserveLpReceiverFiat || lpSenderFiatReceiverReserve) {
      return {
        tier: 2,
        strategy: 'RESERVE_TO_RESERVE',
        reason: bothReservesCover
          ? 'RESERVE_TO_RESERVE: both reserves have fiat'
          : 'RESERVE_TO_RESERVE: LP fiat bridges the short side',
        senderHasFiat,
        receiverHasFiat,
        lpHasFiat,
        lpHasCrypto,
      };
    }
  }

  // ── Tier 3: MARKET_TO_RESERVE ─────────────────────────────────────
  // Sender has no fiat (and no LP fiat on sender side) but receiver does.
  // Sell sender-side via market, settle into receiver reserve.
  if (
    !senderHasFiat &&
    !lpHasFiatBandwidth(input.senderBandwidth, input.fromCurrency, amount) &&
    receiverHasFiat
  ) {
    return {
      tier: 3,
      strategy: 'MARKET_TO_RESERVE',
      reason: 'MARKET_TO_RESERVE: sender has no fiat/LP, receiver has reserve',
      senderHasFiat,
      receiverHasFiat,
      lpHasFiat,
      lpHasCrypto,
    };
  }

  // ── Tier 4: MARKET_TO_MARKET ──────────────────────────────────────
  // Neither side has fiat reserves, but LP can bridge via stablecoin /
  // twin-token crypto bandwidth.
  if (lpHasCrypto) {
    return {
      tier: 4,
      strategy: 'MARKET_TO_MARKET',
      reason: 'MARKET_TO_MARKET: LP crypto/stablecoin bridges the gap',
      senderHasFiat,
      receiverHasFiat,
      lpHasFiat,
      lpHasCrypto,
    };
  }

  // ── Tier 5: MANUAL_SETTLEMENT ─────────────────────────────────────
  // No reserve, no LP fiat, no LP crypto. The payment cannot be settled
  // automatically — queue it for manual review.
  return {
    tier: 5,
    strategy: MANUAL_SETTLEMENT_STRATEGY,
    reason: 'MANUAL_SETTLEMENT: no reserves, no bandwidth, no LP crypto',
    senderHasFiat,
    receiverHasFiat,
    lpHasFiat,
    lpHasCrypto,
  };
}

/**
 * Convenience: map a SettlementStrategy to its tier number. Returns 5 for
 * the manual-settlement fallback (and for any unknown strategy). Pure.
 */
export function strategyToTier(strategy: SettlementStrategy | 'MANUAL_SETTLEMENT'): SettlementTier {
  switch (strategy) {
    case 'LOCAL_RAIL': return 1;
    case 'RESERVE_TO_RESERVE': return 2;
    case 'MARKET_TO_RESERVE': return 3;
    case 'MARKET_TO_MARKET': return 4;
    default: return 5;
  }
}
