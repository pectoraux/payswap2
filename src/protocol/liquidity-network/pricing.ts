/**
 * Corridor Pricing Engine — dynamic, deterministic pricing per LP per corridor.
 *
 * Pricing is deterministic given LP state — no random — but reflects dynamic
 * inputs: base spread, amount-tier surcharge (larger amounts = wider spread
 * for risk), volatility surcharge (from recent settlement failures), and a
 * corridor-specific premium.
 *
 * Pricing is the competition mechanism: `compete(corridor, amount)` asks all
 * active LPs for the corridor for a quote and sorts by total cost.
 */
import { createEvidence } from '@/kernel/evidence';
import {
  corridorKey,
  DEFAULT_QUOTE_TTL_MS,
  type CapacityQuote,
  type Corridor,
  type LPId,
} from './types';
import { getAvailableCapacity } from './capacity';
import { liquidityRegistry } from './registry';
import { lpHealthMonitor } from './health';

/** Per-corridor base spreads (bps). Default 30 bps if not listed. */
const CORRIDOR_BASE_SPREAD_BPS: Record<string, number> = {
  'GHS→KES': 30,
  'KES→GHS': 30,
  'NGN→GHS': 50,
  'GHS→NGN': 50,
  'UGX→KES': 40,
  'TZS→KES': 45,
  'USD→KES': 15,
  'KES→USD': 18,
};

/** Per-corridor premiums (bps) added on top of the base spread. */
const CORRIDOR_PREMIUM_BPS: Record<string, number> = {
  'NGN→GHS': 10,
  'GHS→NGN': 10,
};

/** Amount-tier thresholds (in `fromCurrency` units). Crossing a threshold adds
 *  the listed surcharge (bps) to the spread — larger amounts = more risk. */
const AMOUNT_TIER_SURCHARGE_BPS: Array<{ threshold: number; surcharge: number }> = [
  { threshold: 100_000, surcharge: 5 },
  { threshold: 500_000, surcharge: 10 },
  { threshold: 1_000_000, surcharge: 20 },
  { threshold: 5_000_000, surcharge: 40 },
];

/** Maximum volatility surcharge (bps) — caps how much recent failures can
 *  widen the spread. */
const MAX_VOLATILITY_SURCHARGE_BPS = 80;

/** Maximum total spread cap (bps) — prevents runaway widening. */
const MAX_TOTAL_SPREAD_BPS = 250;

export interface PriceQuote {
  lpId: LPId;
  corridor: Corridor;
  feeBps: number;
  spreadBps: number;
  totalFeeBps: number;       // feeBps + spreadBps
  totalFee: number;          // amount * totalFeeBps / 10_000
  netRate: number;           // amount − totalFee
  expiryTs: number;
  amount: number;
}

/** Internal helper: base spread for a corridor. */
function baseSpread(corridor: Corridor): number {
  return CORRIDOR_BASE_SPREAD_BPS[corridorKey(corridor)] ?? 30;
}

/** Internal helper: corridor premium. */
function corridorPremium(corridor: Corridor): number {
  return CORRIDOR_PREMIUM_BPS[corridorKey(corridor)] ?? 0;
}

/** Internal helper: amount-tier surcharge. */
function amountTierSurcharge(amount: number): number {
  let surcharge = 0;
  for (const tier of AMOUNT_TIER_SURCHARGE_BPS) {
    if (amount >= tier.threshold) surcharge += tier.surcharge;
  }
  return surcharge;
}

/**
 * Volatility surcharge — widens the spread based on the LP's recent failure
 * rate. Derived from the LP's windowed success rate in the health monitor:
 * if success rate is 1.0, no surcharge; if it's <1.0, surcharge grows up to
 * MAX_VOLATILITY_SURCHARGE_BPS.
 *
 * This is the "from recent settlement failures" input to dynamic spreads.
 */
function volatilitySurcharge(lpId: LPId): number {
  const health = lpHealthMonitor.getHealth(lpId);
  if (!health) return 0;
  const failureRate = 1 - health.successRateWindowed;
  return Math.min(MAX_VOLATILITY_SURCHARGE_BPS, Math.round(failureRate * MAX_VOLATILITY_SURCHARGE_BPS));
}

/**
 * Compute the effective spread for an LP on a corridor for a given amount.
 *
 * spread = base + corridorPremium + amountTierSurcharge + volatilitySurcharge
 *  capped at MAX_TOTAL_SPREAD_BPS.
 */
export function computeSpread(lpId: LPId, corridor: Corridor, amount: number): number {
  const base = baseSpread(corridor);
  const premium = corridorPremium(corridor);
  const tier = amountTierSurcharge(amount);
  const vol = volatilitySurcharge(lpId);
  const spread = base + premium + tier + vol;
  return Math.min(MAX_TOTAL_SPREAD_BPS, spread);
}

/**
 * Quote a price for an LP on a corridor for a given amount.
 *
 * Returns `null` if the LP is not active or does not serve the corridor.
 *
 * Pricing is deterministic given LP state (LP feeBps, LP corridor, amount,
 * LP's recent failure rate). No random.
 */
export function quotePrice(
  lpId: LPId,
  corridor: Corridor,
  amount: number,
  ttlMs: number = DEFAULT_QUOTE_TTL_MS,
  now: number = Date.now(),
): PriceQuote | null {
  const lp = liquidityRegistry.get(lpId);
  if (!lp || lp.state !== 'active') return null;
  const serves = lp.corridors.some((c) => corridorKey(c) === corridorKey(corridor));
  if (!serves) return null;

  const feeBps = lp.feeBps;
  const spreadBps = computeSpread(lpId, corridor, amount);
  const totalFeeBps = feeBps + spreadBps;
  const totalFee = (amount * totalFeeBps) / 10_000;
  const netRate = amount - totalFee;
  const expiryTs = now + ttlMs;

  return { lpId, corridor, feeBps, spreadBps, totalFeeBps, totalFee, netRate, expiryTs, amount };
}

/**
 * Get a capacity quote for an LP — combines pricing with available capacity.
 *
 * The quote carries an `evidenceId` — the network creates an `attestation`
 * Evidence backing the quoted capacity so the kernel can audit "why did the
 * solver route through this LP? Because of Evidence #X (lp_attestation,
 * attestedAmount=Y, confidence=Z)".
 */
export function quoteCapacity(
  lpId: LPId,
  corridor: Corridor,
  amount: number,
  ttlMs: number = DEFAULT_QUOTE_TTL_MS,
  now: number = Date.now(),
): CapacityQuote | null {
  const lp = liquidityRegistry.get(lpId);
  if (!lp || lp.state !== 'active') return null;
  const price = quotePrice(lpId, corridor, amount, ttlMs, now);
  if (!price) return null;

  const key = corridorKey(corridor);
  const maxAmount = lp.capacity[key] ?? 0;
  const availableAmount = getAvailableCapacity(lpId, corridor);

  // Build a backing evidence record (capacity is attested by the LP).
  const evidence = createEvidence({
    type: 'capability_proof',
    source: 'lp_attestation',
    verificationLevel: 'attested',
    entityId: lpId,
    attestedAmount: availableAmount,
    currency: corridor.fromCurrency,
    reputation: lp.reputation,
    jurisdiction: lp.country,
    attester: lpId,
    ttlMs,
    payload: { corridor, maxAmount, availableAmount, feeBps: price.feeBps, spreadBps: price.spreadBps },
  });

  return {
    lpId,
    corridor,
    maxAmount,
    availableAmount,
    feeBps: price.feeBps,
    spreadBps: price.spreadBps,
    estimatedSettlementMs: lp.settlementSpeedMs,
    expiryTs: price.expiryTs,
    evidenceId: evidence.id,
  };
}

export interface MarketSpread {
  corridor: Corridor;
  minBps: number;
  medianBps: number;
  maxBps: number;
  lpCount: number;
}

/**
 * Aggregate spread across all active LPs for a corridor. Returns the min,
 * median and max of the LPs' `feeBps + spreadBps` for a given amount.
 *
 * Returns `{ lpCount: 0, ... }` if no LPs serve the corridor.
 */
export function getMarketSpread(corridor: Corridor, amount: number = 1_000, now: number = Date.now()): MarketSpread {
  const lps = liquidityRegistry.activeLPs(corridor);
  const spreads: number[] = [];
  for (const lp of lps) {
    const q = quotePrice(lp.id, corridor, amount, DEFAULT_QUOTE_TTL_MS, now);
    if (q) spreads.push(q.totalFeeBps);
  }
  if (spreads.length === 0) {
    return { corridor, minBps: 0, medianBps: 0, maxBps: 0, lpCount: 0 };
  }
  spreads.sort((a, b) => a - b);
  const min = spreads[0];
  const max = spreads[spreads.length - 1];
  const median = spreads.length % 2 === 1
    ? spreads[Math.floor(spreads.length / 2)]
    : (spreads[spreads.length / 2 - 1] + spreads[spreads.length / 2]) / 2;
  return {
    corridor,
    minBps: min,
    medianBps: median,
    maxBps: max,
    lpCount: spreads.length,
  };
}

/**
 * Competition — ask all active LPs for the corridor for a quote, return them
 * sorted by total cost (cheapest first). This is the routing layer's
 * competition mechanism: each LP "bids" via quotePrice and the cheapest wins.
 *
 * Optionally capped at `maxAmount` — LPs whose available capacity is below the
 * amount are still included but flagged with `availableAmount < amount` so the
 * routing layer can split.
 */
export interface CompeteBid {
  lpId: LPId;
  quote: CapacityQuote;
  totalFee: number;        // amount-at-bid × totalFeeBps / 10_000 (but for comparison we use full amount × totalFeeBps)
  effectiveCostBps: number; // totalFeeBps adjusted for reliability penalty (cheaper AND reliable wins)
}

export function compete(corridor: Corridor, amount: number, now: number = Date.now()): CompeteBid[] {
  const lps = liquidityRegistry.activeLPs(corridor);
  const bids: CompeteBid[] = [];
  for (const lp of lps) {
    const quote = quoteCapacity(lp.id, corridor, amount, DEFAULT_QUOTE_TTL_MS, now);
    if (!quote) continue;
    const totalFee = (amount * quote.feeBps + (amount * quote.spreadBps)) / 10_000;
    // Reliability penalty: an LP with lower success rate pays a small premium
    // in effective cost so cheaper-but-unreliable doesn't always win.
    const health = lpHealthMonitor.getHealth(lp.id);
    const successRate = health?.successRateWindowed ?? lp.historicalSuccessRate;
    const reliabilityPenaltyBps = Math.round((1 - successRate) * 20); // up to 20 bps
    const effectiveCostBps = quote.feeBps + quote.spreadBps + reliabilityPenaltyBps;
    bids.push({ lpId: lp.id, quote, totalFee, effectiveCostBps });
  }
  bids.sort((a, b) => a.effectiveCostBps - b.effectiveCostBps);
  return bids;
}
