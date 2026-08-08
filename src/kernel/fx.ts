/**
 * FX Engine — currency conversion with transparent spreads.
 *
 * Cross-border payments move between currencies. The FX Engine quotes a
 * mid-market rate and applies a small spread (in basis points) that accrues
 * to the treasury. Rates are deterministic per run so simulations are
 * reproducible; in production these would be sourced from a live feed.
 *
 * F2 FIX: `quote()` and `rate()` now return `null` for unknown currencies
 * (previously returned `NaN` silently — the try/catch in handlers.ts was
 * dead code and `fx.rate_missing` was never emitted). Callers MUST handle
 * the `null` case — a missing rate is a real condition, not an exception.
 */
import type { CurrencyCode } from './types';

// Mid-market reference rates, indexed against USD.
const USD_RATES: Record<CurrencyCode, number> = {
  USD: 1,
  KES: 129.4,
  GHS: 12.1,
  NGN: 835.0,
  ZAR: 18.6,
  UGX: 3780,
  TZS: 2535,
  // XOF is a CurrencyCode but not in the rate table — quote() returns null.
};

const SPREAD_BPS = 18; // 0.18% spread accrues to treasury

export interface FxQuote {
  from: CurrencyCode;
  to: CurrencyCode;
  amount: number;
  midRate: number;
  spreadBps: number;
  effectiveRate: number;
  converted: number;
  spreadCost: number;
}

export class FxEngine {
  /** Check whether a rate is available for a currency pair. */
  hasRate(from: string, to: string): boolean {
    if (from === to) return true;
    return from in USD_RATES && to in USD_RATES;
  }

  /**
   * Get the mid-market rate for a pair. Returns `null` if either currency
   * is unknown. Callers MUST handle null — do NOT fall back to 1.
   */
  rate(from: string, to: string): number | null {
    if (from === to) return 1;
    const fromUsd = (USD_RATES as Record<string, number>)[from];
    const toUsd = (USD_RATES as Record<string, number>)[to];
    if (fromUsd === undefined || toUsd === undefined) return null;
    return toUsd / fromUsd;
  }

  /**
   * Quote a conversion. Returns `null` if the rate is unavailable.
   * Spread is applied on the cost side (buyer pays more).
   * Callers MUST handle null — do NOT fall back to rate: 1.
   */
  quote(amount: number, from: string, to: string): FxQuote | null {
    const midRate = this.rate(from, to);
    if (midRate === null) return null;
    const effectiveRate = midRate * (1 - SPREAD_BPS / 1e4);
    const converted = Math.round(amount * effectiveRate * 1e6) / 1e6;
    const midConverted = amount * midRate;
    const spreadCost = Math.round((midConverted - converted) * 1e6) / 1e6;
    return {
      from: from as CurrencyCode,
      to: to as CurrencyCode,
      amount,
      midRate,
      spreadBps: SPREAD_BPS,
      effectiveRate,
      converted,
      spreadCost,
    };
  }
}

export const fxEngine = new FxEngine();
