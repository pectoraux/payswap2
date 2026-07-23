/**
 * Reserve Engine — manages per-country PaySwap reserves.
 *
 * Each country has a reserve denominated in its local currency. The reserve
 * holds the float that funds outgoing payments and absorbs incoming payments.
 * A minimum threshold protects solvency: drawing below it raises risk and may
 * trigger liquidity sourcing. All reserve mutations are mirrored as ledger
 * entries by the Settlement Engine.
 */
import type { ReserveConfig, CurrencyCode, WorldState } from './types';
import { eventEngine } from './event';

export interface ReserveMutation {
  country: string;
  currency: CurrencyCode;
  delta: number; // +credit / -debit
  reason: string;
  frame: number;
}

export class ReserveEngine {
  constructor(private world: WorldState) {}

  find(country: string): ReserveConfig | undefined {
    return this.world.reserves.find((r) => r.country === country);
  }

  ensure(country: string, currency: CurrencyCode, balance: number, minThreshold: number): ReserveConfig {
    let r = this.find(country);
    if (!r) {
      r = { country, currency, balance, minThreshold };
      this.world.reserves.push(r);
    }
    return r;
  }

  /** Returns true if a debit of `amount` would keep the reserve above threshold. */
  canDebit(reserve: ReserveConfig, amount: number): boolean {
    return reserve.balance - amount >= reserve.minThreshold;
  }

  mutate(m: ReserveMutation): ReserveConfig {
    const reserve = this.ensure(m.country, m.currency, 0, 0);
    reserve.balance = Math.round((reserve.balance + m.delta) * 1e6) / 1e6;
    eventEngine.emit(
      'reserve.mutated',
      {
        country: m.country,
        currency: m.currency,
        delta: m.delta,
        balanceAfter: reserve.balance,
        reason: m.reason,
        frame: m.frame,
      },
      m.frame,
    );
    return reserve;
  }

  /** Utilization of the reserve relative to its threshold headroom. */
  utilization(reserve: ReserveConfig): number {
    const headroom = reserve.balance - reserve.minThreshold;
    if (headroom <= 0) return 100;
    return 0; // utilization is computed against draw-downs by the simulator
  }

  healthy(reserve: ReserveConfig): boolean {
    return reserve.balance >= reserve.minThreshold;
  }
}
