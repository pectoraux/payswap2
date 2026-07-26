/**
 * Pricing Engine — computes the blended cost of a liquidity movement.
 *
 * Aggregates LP/source fees, FX spread and reserve/treasury fees into a single
 * cost figure expressed both as a percentage of the principal and as an
 * absolute amount in the merchant's currency. Used by the Liquidity Planner to
 * compare candidate plans.
 */
import type { CurrencyCode, LiquiditySourceDraw } from './types';

export interface PriceInput {
  principal: number; // in merchant currency
  lpUsage: LiquiditySourceDraw[];
  fxSpreadCost: number; // in merchant currency
  reserveFeeBps: number;
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
    const reserveFee = Math.round(input.principal * (input.reserveFeeBps / 1e4) * 1e6) / 1e6;
    const totalFees = Math.round((lpFees + input.fxSpreadCost + reserveFee) * 1e6) / 1e6;
    const costPercent = input.principal > 0 ? Math.round((totalFees / input.principal) * 1e4) / 1e2 : 0;
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
