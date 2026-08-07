/**
 * Settlement Waterfall — the ONLY routing rule.
 *
 * Two layers, five tiers, deterministic priority:
 *
 *   LOCAL (same country + currency):
 *     1. PaySwap FIAT reserves
 *     2. LP FIAT bandwidth
 *     5. Marketplace auction
 *
 *   CROSS-BORDER (different country or currency):
 *     3. PaySwap crypto reserves (twin token if FIAT reserve exists, stablecoin if not)
 *     4. LP crypto bandwidth
 *     5. Marketplace auction
 *
 * Scoring never chooses a TIER — it only breaks ties INSIDE a tier.
 */

// ── Types ──

export type SettlementTier = 1 | 2 | 3 | 4 | 5;

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

export function isLocal(params: {
  originCountry: string;
  destinationCountry: string;
  sourceCurrency: string;
  destinationCurrency: string;
}): boolean {
  return params.originCountry === params.destinationCountry
    && params.sourceCurrency === params.destinationCurrency;
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
  const local = isLocal({
    originCountry: input.originCountry,
    destinationCountry: input.destinationCountry,
    sourceCurrency: input.sourceCurrency,
    destinationCurrency: input.destinationCurrency,
  });

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
    if (input.senderReserve.hasFiatReserve && input.senderReserve.fiatReserveAmount >= input.amount) {
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
    if (input.lpFiatAvailable >= input.amount) {
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
  const cryptoAssetKind = destHasFiat ? 'twin token (t' + input.destinationCurrency + ')' : 'stablecoin (USDC)';

  if (cryptoAvailable >= destAmount) {
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
  if (input.lpCryptoAvailable >= destAmount) {
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
  if (params.hasFiatReserve && params.fiatReserveAmount >= params.amount) {
    return { tier: 1, source: 'payswap_fiat', served: true, skipped };
  }
  if (params.hasFiatReserve) {
    skipped.push({ tier: 1, reason: `Insufficient FIAT: need ${params.amount}, have ${params.fiatReserveAmount}` });
  } else {
    skipped.push({ tier: 1, reason: `No FIAT reserve in ${params.country}` });
  }

  if (params.lpFiatAvailable >= params.amount) {
    return { tier: 2, source: 'lp_fiat', served: true, skipped };
  }
  skipped.push({ tier: 2, reason: `Insufficient LP FIAT: need ${params.amount}, have ${params.lpFiatAvailable}` });

  // Try crypto tiers (3, 4)
  if (params.payswapCryptoAvailable >= params.amount) {
    return { tier: 3, source: 'payswap_crypto', served: true, skipped };
  }
  skipped.push({ tier: 3, reason: `Insufficient crypto: need ${params.amount}, have ${params.payswapCryptoAvailable}` });

  if (params.lpCryptoAvailable >= params.amount) {
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

/**
 * Full per-leg resolution: resolve both legs, derive strategy,
 * and return a combined result with the full skip trail.
 */
export function resolvePayment(params: {
  originCountry: string;
  destinationCountry: string;
  sourceCurrency: string;
  destinationCurrency: string;
  amount: number;
  senderHasFiatReserve: boolean;
  senderFiatReserveAmount: number;
  receiverHasFiatReserve: boolean;
  receiverFiatReserveAmount: number;
  senderLpFiatAvailable: number;
  receiverLpFiatAvailable: number;
  payswapStablecoinAvailable: number;
  payswapTwinTokenAvailable: number;
  lpCryptoAvailable: number;
}): {
  strategy: string;
  sendLeg: LegResolution;
  receiveLeg: LegResolution;
  isLocal: boolean;
  allSkipped: SkipReason[];
} {
  const local = isLocal({
    originCountry: params.originCountry,
    destinationCountry: params.destinationCountry,
    sourceCurrency: params.sourceCurrency,
    destinationCurrency: params.destinationCurrency,
  });

  const sendLeg = resolveLeg({
    country: params.originCountry,
    currency: params.sourceCurrency,
    amount: params.amount,
    hasFiatReserve: params.senderHasFiatReserve,
    fiatReserveAmount: params.senderFiatReserveAmount,
    lpFiatAvailable: params.senderLpFiatAvailable,
    payswapCryptoAvailable: params.payswapStablecoinAvailable,
    lpCryptoAvailable: params.lpCryptoAvailable,
  });

  const receiveLeg = resolveLeg({
    country: params.destinationCountry,
    currency: params.destinationCurrency,
    amount: params.amount,
    hasFiatReserve: params.receiverHasFiatReserve,
    fiatReserveAmount: params.receiverFiatReserveAmount,
    lpFiatAvailable: params.receiverLpFiatAvailable,
    payswapCryptoAvailable: params.payswapTwinTokenAvailable,
    lpCryptoAvailable: params.lpCryptoAvailable,
  });

  const strategy = deriveStrategy(sendLeg, receiveLeg, local);
  const allSkipped = [...sendLeg.skipped, ...receiveLeg.skipped];

  return { strategy, sendLeg, receiveLeg, isLocal: local, allSkipped };
}
