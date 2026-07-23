/**
 * Treasury Engine — owns fee accrual, FX reserves and treasury positions.
 *
 * Every fee (LP, FX spread, reserve) accrues to the treasury account. The
 * engine exposes the running treasury position so dashboards and the
 * simulator can show the kernel's economics.
 */
import type { CurrencyCode } from './types';
import { round } from './support';

export interface TreasuryPosition {
  currency: CurrencyCode;
  fees: number;
  fxSpread: number;
  reserveFees: number;
  total: number;
}

export class TreasuryEngine {
  private positions: Map<CurrencyCode, TreasuryPosition> = new Map();

  accrual(currency: CurrencyCode, fees: number, fxSpread: number, reserveFees: number): void {
    const pos =
      this.positions.get(currency) ??
      ({ currency, fees: 0, fxSpread: 0, reserveFees: 0, total: 0 } as TreasuryPosition);
    pos.fees = round(pos.fees + fees, 6);
    pos.fxSpread = round(pos.fxSpread + fxSpread, 6);
    pos.reserveFees = round(pos.reserveFees + reserveFees, 6);
    pos.total = round(pos.fees + pos.fxSpread + pos.reserveFees, 6);
    this.positions.set(currency, pos);
  }

  position(currency: CurrencyCode): TreasuryPosition {
    return (
      this.positions.get(currency) ?? {
        currency,
        fees: 0,
        fxSpread: 0,
        reserveFees: 0,
        total: 0,
      }
    );
  }

  all(): TreasuryPosition[] {
    return [...this.positions.values()];
  }

  reset(): void {
    this.positions.clear();
  }
}

export const treasuryEngine = new TreasuryEngine();
