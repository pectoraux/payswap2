/**
 * Reserve Engine — manages per-country PaySwap reserves as infrastructure.
 *
 * Reserves expose available + locked liquidity, a forecast, replenishment
 * schedule and AI confidence. A minimum threshold protects solvency. The
 * planner decides whether to consume reserves or preserve them based on the
 * reserve policy; all mutations mirror as ledger entries via the executor.
 */
import type { Reserve, CurrencyCode, WorldState } from './types';
import { eventEngine } from './event';

export interface ReserveMutation {
  country: string;
  currency: CurrencyCode;
  delta: number;
  reason: string;
  frame: number;
}

export class ReserveEngine {
  constructor(private world: WorldState) {}

  find(country: string): Reserve | undefined {
    return this.world.reserves.find((r) => r.country === country);
  }

  ensure(country: string, currency: CurrencyCode, available: number, minThreshold: number): Reserve {
    let r = this.find(country);
    if (!r) {
      r = { id: `reserve:${country}`, country, currency, available, locked: 0, minThreshold, forecast: 0, replenishmentSchedule: 'daily', aiConfidence: 0.9 };
      this.world.reserves.push(r);
    }
    return r;
  }

  canDebit(reserve: Reserve, amount: number): boolean {
    return reserve.available - amount >= reserve.minThreshold;
  }

  mutate(m: ReserveMutation): Reserve {
    const reserve = this.ensure(m.country, m.currency, 0, 0);
    reserve.available = Math.round((reserve.available + m.delta) * 1e6) / 1e6;
    eventEngine.emit('reserve.mutated', { country: m.country, delta: m.delta, balanceAfter: reserve.available, reason: m.reason, frame: m.frame }, m.frame);
    return reserve;
  }

  healthy(reserve: Reserve): boolean {
    return reserve.available >= reserve.minThreshold;
  }
}
