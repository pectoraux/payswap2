/**
 * Treasury Engine — fee accrual, stablecoin/emergency positions, and AI guidance.
 *
 * Every fee (LP, FX spread, reserve) accrues to the treasury. The engine also
 * tracks stablecoin and emergency balances so the Treasury AI can recommend
 * replenishment and liquidity shifts.
 */
import type { CurrencyCode, TreasuryPosition } from './types';
import { round } from './support';

export class TreasuryEngine {
  private positions: Map<CurrencyCode, TreasuryPosition> = new Map();

  init(currency: CurrencyCode, stablecoin: number, emergency: number, fiat: number): void {
    this.positions.set(currency, { currency, stablecoinBalance: stablecoin, emergencyBalance: emergency, fiatBalance: fiat });
  }

  accrual(currency: CurrencyCode, fees: number, fxSpread: number, reserveFees: number): void {
    const pos = this.positions.get(currency) ?? { currency, stablecoinBalance: 0, emergencyBalance: 0, fiatBalance: 0 };
    pos.fiatBalance = round(pos.fiatBalance + fees + fxSpread + reserveFees, 6);
    this.positions.set(currency, pos);
  }

  drawStablecoin(currency: CurrencyCode, amount: number): void {
    const pos = this.positions.get(currency);
    if (pos) pos.stablecoinBalance = round(pos.stablecoinBalance - amount, 6);
  }

  position(currency: CurrencyCode): TreasuryPosition {
    return this.positions.get(currency) ?? { currency, stablecoinBalance: 0, emergencyBalance: 0, fiatBalance: 0 };
  }

  all(): TreasuryPosition[] {
    return [...this.positions.values()];
  }

  reset(): void {
    this.positions.clear();
  }
}

export const treasuryEngine = new TreasuryEngine();
