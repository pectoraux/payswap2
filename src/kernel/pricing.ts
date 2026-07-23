/**
 * Pricing Engine — computes the blended cost of a routed payment.
 *
 * Aggregates LP fees, FX spread and any reserve/treasury fees into a single
 * cost figure expressed both as a percentage of the principal and as an
 * absolute amount in the merchant's currency. Used by the Routing Engine to
 * compare candidate paths and by the simulator to display total cost.
 */
import type { CurrencyCode } from './types';
import type { LpUsage } from './types';

export interface PriceInput {
  principal: number; // in merchant currency
  lpUsage: LpUsage[];
  fxSpreadCost: number; // in merchant currency
  reserveFeeBps: number; // e.g. 4 bps
  currency: CurrencyCode;
}

export interface PriceResult {
  lpFees: number;
  fxSpreadCost: number;
  reserveFee: number;
  totalFees: number;
  costPercent: number;
  costAmount: number;
}

export class PricingEngine {
  price(input: PriceInput): PriceResult {
    const lpFees = input.lpUsage.reduce((s, u) => s + u.fee, 0);
    const reserveFee =
      Math.round(input.principal * (input.reserveFeeBps / 1e4) * 1e6) / 1e6;
    const totalFees = Math.round((lpFees + input.fxSpreadCost + reserveFee) * 1e6) / 1e6;
    const costPercent = Math.round((totalFees / input.principal) * 1e4) / 1e2;
    return {
      lpFees: Math.round(lpFees * 1e6) / 1e6,
      fxSpreadCost: input.fxSpreadCost,
      reserveFee,
      totalFees,
      costPercent,
      costAmount: totalFees,
    };
  }
}

export const pricingEngine = new PricingEngine();
