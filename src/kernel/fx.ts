/**
 * FX Engine — currency conversion with transparent spreads.
 *
 * Cross-border payments move between currencies. The FX Engine quotes a
 * mid-market rate and applies a small spread (in basis points) that accrues
 * to the treasury. Rates are deterministic per run so simulations are
 * reproducible; in production these would be sourced from a live feed.
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
  rate(from: CurrencyCode, to: CurrencyCode): number {
    if (from === to) return 1;
    const fromUsd = USD_RATES[from];
    const toUsd = USD_RATES[to];
    return toUsd / fromUsd;
  }

  /** Quote a conversion. Spread is applied on the cost side (buyer pays more). */
  quote(amount: number, from: CurrencyCode, to: CurrencyCode): FxQuote {
    const midRate = this.rate(from, to);
    const effectiveRate = midRate * (1 - SPREAD_BPS / 1e4);
    const converted = Math.round(amount * effectiveRate * 1e6) / 1e6;
    const midConverted = amount * midRate;
    const spreadCost = Math.round((midConverted - converted) * 1e6) / 1e6;
    return {
      from,
      to,
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
