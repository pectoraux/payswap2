/**
 * Reserve Market State + Shadow Price. (Amendment 1 §7C.)
 *
 * Every reserve continuously publishes its market state. The shadow price is
 * the internal opportunity cost of consuming one more unit of a reserve — an
 * optimization signal, NOT customer pricing. Routing minimizes
 *   execution cost + reserve shadow price + capital cost + risk cost.
 *
 * M-RT-1 ships only the types + a no-op interface. M-RT-4 implements the
 * real continuous publisher.
 */

import type { Environment } from '../../types';

/** The continuously-published state of one reserve. */
export interface ReserveMarketState {
  reserveId: string;
  currency: string;
  environment: Environment;
  available: number;
  locked: number;
  /** 0..1 — locked / (available + locked). */
  utilization: number;
  /** Forecast ms until depletion at current drain rate, if known. */
  forecastDepletionMs?: number;
  /** Units/sec refill rate. */
  refillRate: number;
  /** Capital cost in basis points. */
  capitalCostBps: number;
  /** Risk score 0..1. */
  risk: number;
  /** Confidence in the published state 0..1. */
  confidence: number;
  /** The optimization signal — opportunity cost of one more unit, in bps. */
  shadowPriceBps: number;
  /** Runtime Clock time this state was computed. */
  ts: number;
}

/** The reserve market — queryable surface for the published states. */
export interface ReserveMarket {
  /** Current state of one reserve. */
  state(reserveId: string): ReserveMarketState | undefined;
  /** Current state of all reserves (optionally filtered by environment). */
  states(environment?: Environment): ReserveMarketState[];
  /** The shadow price of one reserve (bps). */
  shadowPrice(reserveId: string): number | undefined;
  /** Publish/refresh a reserve's state (called by the Reserve Engine). */
  publish(state: ReserveMarketState): void;
}

/**
 * InMemoryReserveMarket — the M-RT-1 implementation. M-RT-4 wires the real
 * continuous publisher (driven by the Reserve Engine on a schedule + on
 * lock/release events).
 */
export class InMemoryReserveMarket implements ReserveMarket {
  private statesById: Map<string, ReserveMarketState> = new Map();

  state(reserveId: string): ReserveMarketState | undefined {
    return this.statesById.get(reserveId);
  }

  states(environment?: Environment): ReserveMarketState[] {
    const all = [...this.statesById.values()];
    return environment ? all.filter((s) => s.environment === environment) : all;
  }

  shadowPrice(reserveId: string): number | undefined {
    return this.statesById.get(reserveId)?.shadowPriceBps;
  }

  publish(state: ReserveMarketState): void {
    this.statesById.set(state.reserveId, state);
  }
}
