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

// ───────────────────────────────────────────────────────────────────────────
// Origin/main additions: settlement-waterfall primitives (selectSettlementSource, resolveLeg, etc.)
// Kept verbatim from origin/main; SettlementTier + resolvePayment already declared above.

export type ReserveTier = 'FIAT' | 'CRYPTO';
export type ReserveOwnership = 'PAYSWAP' | 'LP';
export type ReserveAssetKind = 'FIAT' | 'STABLECOIN' | 'TWIN_TOKEN';

export interface ReserveState {
  country: string;
  currency: string;
  tier: ReserveTier;
  ownership: ReserveOwnership;
  assetKind: ReserveAssetKind;
  available: number;
  hasFiatReserve: boolean;
  fiatReserveAmount: number;
  stablecoinReserveAmount: number;
}

export interface WaterfallResult {
  tier: SettlementTier;
  tierName: string;
  source: string;
  amount: number;
  available: number;
  used: number;
  sufficient: boolean;
  skipped: SkipReason[];
  explanation: string;
  feeBps: number;
  payswapSharePct: number;
  lpSharePct: number;
}

export interface SkipReason {
  tier: SettlementTier;
  reason: string;
}

// ── Fee model by tier ──

export const TIER_FEES: Record<SettlementTier, { bps: number; payswapPct: number; lpPct: number }> = {
  1: { bps: 80, payswapPct: 100, lpPct: 0 },    // PaySwap FIAT
  2: { bps: 100, payswapPct: 60, lpPct: 40 },   // LP FIAT
  3: { bps: 120, payswapPct: 100, lpPct: 0 },   // PaySwap crypto
  4: { bps: 150, payswapPct: 20, lpPct: 80 },   // LP crypto
  5: { bps: 200, payswapPct: 10, lpPct: 90 },   // Auction
};

export const TIER_NAMES: Record<SettlementTier, string> = {
  1: 'PaySwap FIAT reserves',
  2: 'LP FIAT bandwidth',
  3: 'PaySwap crypto reserves',
  4: 'LP crypto bandwidth',
  5: 'Marketplace auction',
};

// ── isLocal() ──
// NOTE: `isLocal` is imported from `@/protocol/chains/stellar/assets` (HEAD).
// It takes 4 positional args: isLocal(fromCountry, toCountry, fromCurrency, toCurrency).
// Origin/main's local object-param signature was removed to avoid a duplicate identifier.

// ── MON-3d: exact integer comparison helper ──
//
// The waterfall's tier selection depends on `available >= amount` comparisons.
// With floating-point, `0.1 + 0.2 !== 0.3` — a payment could go to the wrong
// tier by a cent. This helper rounds both sides to integer cents (1e-2) and
// compares exactly. The routing decision is now deterministic.
//
// MON-3d: exact integer comparison helper.
//
// The waterfall's tier selection depends on `available >= amount` comparisons.
// With floating-point, `0.1 + 0.2 !== 0.3` — a payment could go to the wrong
// tier by a cent. This helper rounds both sides to integer cents (1e-2) and
// compares exactly. The routing decision is now deterministic.

function sufficientCents(available: number, needed: number): boolean {
  return Math.round(available * 100) >= Math.round(needed * 100);
}

// ── The waterfall ──

export interface WaterfallInput {
  amount: number;
  originCountry: string;
  destinationCountry: string;
  sourceCurrency: string;
  destinationCurrency: string;
  // Reserve states (from the event store / runtime)
  senderReserve: ReserveState;
  receiverReserve: ReserveState;
  // LP bandwidth (from BandwidthEngine)
  lpFiatAvailable: number;      // total LP FIAT bandwidth in destination country
  lpCryptoAvailable: number;    // total LP crypto bandwidth
  // PaySwap crypto reserves
  payswapStablecoinAvailable: number;  // USDC in treasury
  payswapTwinTokenAvailable: number;   // twin tokens minted for this currency
  // F2: FX quote for cross-currency transfers (null for same-currency)
  fxQuote?: FxQuote | null;
}

export interface FxQuote {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  sourceAmount: number;
  destinationAmount: number;
  spreadBps: number;
  expiresAt: number;
  provider: string;
}

export function selectSettlementSource(input: WaterfallInput): WaterfallResult {
  const local = isLocal(
    input.originCountry,
    input.destinationCountry,
    input.sourceCurrency,
    input.destinationCurrency,
  );

  // F1/F2: If cross-currency, compute the destination amount from the FX quote
  const needsFx = input.sourceCurrency !== input.destinationCurrency;
  const destAmount = needsFx && input.fxQuote
    ? input.fxQuote.destinationAmount
    : input.amount;

  const skipped: SkipReason[] = [];
  const fees = (tier: SettlementTier) => TIER_FEES[tier];

  if (local) {
    // ── LOCAL: try tiers 1, 2, 5 ──

    // Tier 1: PaySwap FIAT reserves
    if (input.senderReserve.hasFiatReserve && sufficientCents(input.senderReserve.fiatReserveAmount, input.amount)) {
      return {
        tier: 1, tierName: TIER_NAMES[1], source: 'payswap_fiat',
        amount: input.amount, available: input.senderReserve.fiatReserveAmount,
        used: input.amount, sufficient: true, skipped,
        explanation: `Local payment settled from PaySwap FIAT reserve in ${input.originCountry}`,
        feeBps: fees(1).bps, payswapSharePct: fees(1).payswapPct, lpSharePct: fees(1).lpPct,
      };
    }
    skipped.push({ tier: 1, reason: input.senderReserve.hasFiatReserve
      ? `Insufficient FIAT: need ${input.amount}, have ${input.senderReserve.fiatReserveAmount}`
      : `No FIAT reserve in ${input.originCountry}` });

    // Tier 2: LP FIAT bandwidth
    if (sufficientCents(input.lpFiatAvailable, input.amount)) {
      return {
        tier: 2, tierName: TIER_NAMES[2], source: 'lp_fiat',
        amount: input.amount, available: input.lpFiatAvailable,
        used: input.amount, sufficient: true, skipped,
        explanation: `Local payment settled via LP FIAT bandwidth in ${input.destinationCountry}`,
        feeBps: fees(2).bps, payswapSharePct: fees(2).payswapPct, lpSharePct: fees(2).lpPct,
      };
    }
    skipped.push({ tier: 2, reason: `Insufficient LP FIAT: need ${input.amount}, have ${input.lpFiatAvailable}` });

    // Tier 5: Marketplace auction (local can't use crypto tiers)
    return {
      tier: 5, tierName: TIER_NAMES[5], source: 'marketplace',
      amount: input.amount, available: 0, used: 0, sufficient: false, skipped,
      explanation: `Local payment requires marketplace auction — FIAT reserves and LP FIAT insufficient`,
      feeBps: fees(5).bps, payswapSharePct: fees(5).payswapPct, lpSharePct: fees(5).lpPct,
    };
  }

  // ── CROSS-BORDER: try tiers 3, 4, 5 ──

  // Tier 3: PaySwap crypto reserves
  // Use twin token if destination has FIAT reserve, stablecoin if not
  const destHasFiat = input.receiverReserve.hasFiatReserve;
  const cryptoAvailable = destHasFiat
    ? input.payswapTwinTokenAvailable
    : input.payswapStablecoinAvailable;
  const cryptoSource = destHasFiat ? 'payswap_twin_token' : 'payswap_stablecoin';
  const cryptoAssetKind = destHasFiat ? 'twin token (TWIN' + input.destinationCurrency + ')' : 'stablecoin (USDC)';

  if (sufficientCents(cryptoAvailable, destAmount)) {
    return {
      tier: 3, tierName: TIER_NAMES[3], source: cryptoSource,
      amount: destAmount, available: cryptoAvailable,
      used: destAmount, sufficient: true, skipped,
      explanation: `Cross-border payment settled via PaySwap ${cryptoAssetKind} → ${input.destinationCountry}${needsFx ? ` (FX: ${input.sourceCurrency}→${input.destinationCurrency} @ ${input.fxQuote?.rate ?? 1})` : ''}`,
      feeBps: fees(3).bps, payswapSharePct: fees(3).payswapPct, lpSharePct: fees(3).lpPct,
    };
  }
  skipped.push({ tier: 3, reason: `Insufficient ${cryptoAssetKind}: need ${destAmount}, have ${cryptoAvailable}` });

  // Tier 4: LP crypto bandwidth
  if (sufficientCents(input.lpCryptoAvailable, destAmount)) {
    return {
      tier: 4, tierName: TIER_NAMES[4], source: 'lp_crypto',
      amount: destAmount, available: input.lpCryptoAvailable,
      used: destAmount, sufficient: true, skipped,
      explanation: `Cross-border payment settled via LP crypto bandwidth`,
      feeBps: fees(4).bps, payswapSharePct: fees(4).payswapPct, lpSharePct: fees(4).lpPct,
    };
  }
  skipped.push({ tier: 4, reason: `Insufficient LP crypto: need ${destAmount}, have ${input.lpCryptoAvailable}` });

  // Tier 5: Marketplace auction
  return {
    tier: 5, tierName: TIER_NAMES[5], source: 'marketplace',
    amount: destAmount, available: 0, used: 0, sufficient: false, skipped,
    explanation: `Cross-border payment requires marketplace auction — all crypto tiers insufficient`,
    feeBps: fees(5).bps, payswapSharePct: fees(5).payswapPct, lpSharePct: fees(5).lpPct,
  };
}

// ── Twin token naming convention (Stellar on-chain code everywhere) ──
//
// There is ONE twin token name: the Stellar asset code `TWIN<CCY>`
// (e.g. TWINGHS, TWINNGN, TWINKES, TWINXOF). It is used in UI,
// dashboards, events, and on-chain. There is no separate "display
// symbol" — the Stellar code IS the display symbol. Having two names
// (tGHS for display, TWINGHS for chain) created ambiguity about which
// one is canonical. Now there is one.

/**
 * Canonical twin token name for a currency: the Stellar asset code.
 * `TWIN<CCY>` (e.g. TWINGHS, TWINNGN, TWINKES, TWINXOF).
 *
 * Used everywhere: UI, dashboards, event payloads, on-chain. There is
 * no separate "display symbol" — this IS the display symbol.
 *
 * Must match src/protocol/chains/stellar/assets.ts:twinTokenCode().
 */
export function twinTokenCode(currency: string): string {
  return 'TWIN' + currency.toUpperCase();
}

/**
 * @deprecated Use `twinTokenCode()` directly. Kept as a thin alias so
 * existing call sites compile while we migrate. The two functions now
 * return the same value — there is only one twin token name.
 */
export function twinTokenSymbol(currency: string): string {
  return twinTokenCode(currency);
}

// ── S3: Per-leg waterfall resolution ──────────────────────────────────

export interface LegResolution {
  /** Which tier served this leg (1-5). */
  tier: SettlementTier;
  /** What source provided the liquidity. */
  source: string;
  /** Whether this leg was served or needs fallback. */
  served: boolean;
  /** Tiers skipped and why. */
  skipped: SkipReason[];
}

/**
 * Resolve a single leg of a payment through the waterfall.
 * Each leg asks: "whose liquidity pays for this side?"
 *
 * - RESERVE leg: try tier 1 (PaySwap FIAT), then tier 2 (LP FIAT)
 * - MARKET leg: try tier 3 (PaySwap crypto), then tier 4 (LP crypto)
 *
 * The strategy name is derived from the pair of leg results:
 *   (RESERVE, RESERVE) → RESERVE_TO_RESERVE
 *   (RESERVE, MARKET)  → RESERVE_TO_MARKET
 *   (MARKET, RESERVE)  → MARKET_TO_RESERVE
 *   (MARKET, MARKET)   → MARKET_TO_MARKET
 *   (RESERVE, same)    → LOCAL_RAIL
 */
export function resolveLeg(params: {
  country: string;
  currency: string;
  amount: number;
  hasFiatReserve: boolean;
  fiatReserveAmount: number;
  lpFiatAvailable: number;
  payswapCryptoAvailable: number;
  lpCryptoAvailable: number;
}): LegResolution {
  const skipped: SkipReason[] = [];

  // Try FIAT tiers first (1, 2)
  if (params.hasFiatReserve && sufficientCents(params.fiatReserveAmount, params.amount)) {
    return { tier: 1, source: 'payswap_fiat', served: true, skipped };
  }
  if (params.hasFiatReserve) {
    skipped.push({ tier: 1, reason: `Insufficient FIAT: need ${params.amount}, have ${params.fiatReserveAmount}` });
  } else {
    skipped.push({ tier: 1, reason: `No FIAT reserve in ${params.country}` });
  }

  if (sufficientCents(params.lpFiatAvailable, params.amount)) {
    return { tier: 2, source: 'lp_fiat', served: true, skipped };
  }
  skipped.push({ tier: 2, reason: `Insufficient LP FIAT: need ${params.amount}, have ${params.lpFiatAvailable}` });

  // Try crypto tiers (3, 4)
  if (sufficientCents(params.payswapCryptoAvailable, params.amount)) {
    return { tier: 3, source: 'payswap_crypto', served: true, skipped };
  }
  skipped.push({ tier: 3, reason: `Insufficient crypto: need ${params.amount}, have ${params.payswapCryptoAvailable}` });

  if (sufficientCents(params.lpCryptoAvailable, params.amount)) {
    return { tier: 4, source: 'lp_crypto', served: true, skipped };
  }
  skipped.push({ tier: 4, reason: `Insufficient LP crypto: need ${params.amount}, have ${params.lpCryptoAvailable}` });

  // Tier 5: marketplace auction (last resort)
  return { tier: 5, source: 'marketplace', served: false, skipped };
}

/**
 * Derive the strategy name from a pair of leg resolutions.
 *
 * Tiers 1-2 = RESERVE, tiers 3-5 = MARKET.
 * The strategy name is the pair: <sendLeg>_TO_<receiveLeg>.
 */
export function deriveStrategy(
  sendLeg: LegResolution,
  receiveLeg: LegResolution,
  isLocalPayment: boolean,
): string {
  if (isLocalPayment) return 'LOCAL_RAIL';

  const sendIsReserve = sendLeg.tier <= 2;
  const receiveIsReserve = receiveLeg.tier <= 2;

  if (sendIsReserve && receiveIsReserve) return 'RESERVE_TO_RESERVE';
  if (sendIsReserve && !receiveIsReserve) return 'RESERVE_TO_MARKET';
  if (!sendIsReserve && receiveIsReserve) return 'MARKET_TO_RESERVE';
  return 'MARKET_TO_MARKET';
}
