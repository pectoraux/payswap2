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
}

export function selectSettlementSource(input: WaterfallInput): WaterfallResult {
  const local = isLocal({
    originCountry: input.originCountry,
    destinationCountry: input.destinationCountry,
    sourceCurrency: input.sourceCurrency,
    destinationCurrency: input.destinationCurrency,
  });

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

  if (cryptoAvailable >= input.amount) {
    return {
      tier: 3, tierName: TIER_NAMES[3], source: cryptoSource,
      amount: input.amount, available: cryptoAvailable,
      used: input.amount, sufficient: true, skipped,
      explanation: `Cross-border payment settled via PaySwap ${cryptoAssetKind} → ${input.destinationCountry}`,
      feeBps: fees(3).bps, payswapSharePct: fees(3).payswapPct, lpSharePct: fees(3).lpPct,
    };
  }
  skipped.push({ tier: 3, reason: `Insufficient ${cryptoAssetKind}: need ${input.amount}, have ${cryptoAvailable}` });

  // Tier 4: LP crypto bandwidth
  if (input.lpCryptoAvailable >= input.amount) {
    return {
      tier: 4, tierName: TIER_NAMES[4], source: 'lp_crypto',
      amount: input.amount, available: input.lpCryptoAvailable,
      used: input.amount, sufficient: true, skipped,
      explanation: `Cross-border payment settled via LP crypto bandwidth`,
      feeBps: fees(4).bps, payswapSharePct: fees(4).payswapPct, lpSharePct: fees(4).lpPct,
    };
  }
  skipped.push({ tier: 4, reason: `Insufficient LP crypto: need ${input.amount}, have ${input.lpCryptoAvailable}` });

  // Tier 5: Marketplace auction
  return {
    tier: 5, tierName: TIER_NAMES[5], source: 'marketplace',
    amount: input.amount, available: 0, used: 0, sufficient: false, skipped,
    explanation: `Cross-border payment requires marketplace auction — all crypto tiers insufficient`,
    feeBps: fees(5).bps, payswapSharePct: fees(5).payswapPct, lpSharePct: fees(5).lpPct,
  };
}

// ── Twin token naming convention ──

export function twinTokenSymbol(currency: string): string {
  return 't' + currency.toUpperCase();
}

// Examples: tGHS for GHS, tNGN for NGN, tKES for KES, tXOF for XOF
