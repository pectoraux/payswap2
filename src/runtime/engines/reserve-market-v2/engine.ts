/**
 * ReserveMarketEngine — pure economic analysis of the Reserve Ledger. (M-RT-4.)
 *
 * THE ENGINE OWNS NO PERSISTENT STATE. It is a pure function of:
 *   Reserve Ledger state + Runtime Clock + Configuration + (optional) History
 *
 * Everything it produces (shadow price, utilization, scarcity, reserve cost,
 * forecast) is derived on every call. There is no "market table" — the market
 * is a read model, not a source of truth.
 *
 * DETERMINISM: identical inputs → identical outputs. This makes it replayable
 * and testable exactly like the ledger.
 *
 * The four-stage pattern:
 *   1. Source of truth: Reserve Ledger events
 *   2. Projection: ReserveLedgerProjection (balances)
 *   3. Pure analysis: THIS ENGINE (market snapshot)
 *   4. Consumers: Compiler (reserve_aware_routing pass), Treasury, Inspector
 */

import type { RuntimeClock } from '../../clock';
import type { Environment } from '../../types';
import type { ReserveState } from '../reserve-ledger/types';
import type { ReserveLedgerService } from '../reserve-ledger/service';
import type {
  MarketConfig,
  MarketSnapshot,
  ReserveMarketSnapshot,
  Prediction,
} from './types';
import {
  DEFAULT_MARKET_CONFIG,
  deriveUtilization,
  deriveShadowPriceBps,
  deriveScarcity,
  deriveReserveCostBps,
  deriveForecast,
  validateMarketInvariants,
} from './types';

/** Optional historical observations for forecasting (per reserve). */
export interface MarketHistoryProvider {
  /** Returns historical utilization observations for a reserve (0..1 each). */
  getUtilizationHistory(reserveId: string, environment: Environment): number[];
}

/**
 * ReserveMarketEngine — a pure function from ledger state to market snapshot.
 *
 * No persistent state. No writes. No side effects. Deterministic.
 */
export class ReserveMarketEngine {
  constructor(
    private reserveLedger: ReserveLedgerService,
    private clock: RuntimeClock,
    private config: MarketConfig = DEFAULT_MARKET_CONFIG,
    private historyProvider?: MarketHistoryProvider,
  ) {}

  /** Get the market snapshot for one reserve. Pure (derived from ledger). */
  async getMarketSnapshot(reserveId: string, environment: Environment): Promise<ReserveMarketSnapshot | null> {
    const state = await this.reserveLedger.getState(reserveId, environment);
    if (!state) return null;

    return this.deriveSnapshot(state, environment);
  }

  /** Get the market snapshot for all reserves. Pure. */
  async getMarketSnapshotAll(environment: Environment): Promise<MarketSnapshot> {
    const states = await this.reserveLedger.listReserves(environment);
    const snapshots: ReserveMarketSnapshot[] = [];

    for (const state of states) {
      const snapshot = this.deriveSnapshot(state, environment);
      if (snapshot) snapshots.push(snapshot);
    }

    return {
      reserves: snapshots,
      generatedAt: this.clock.now(),
    };
  }

  /** Get a forecast for one reserve. Pure (a hypothesis, never stored). */
  async getForecast(reserveId: string, environment: Environment): Promise<Prediction | null> {
    const state = await this.reserveLedger.getState(reserveId, environment);
    if (!state) return null;

    const utilization = deriveUtilization(state.balances);
    const history = this.historyProvider?.getUtilizationHistory(reserveId, environment);

    return deriveForecast(reserveId, utilization, this.config, this.clock.now(), history);
  }

  /** The config (for the Inspector / debugging). */
  getConfig(): MarketConfig {
    return this.config;
  }

  // ── private ──────────────────────────────────────────────────────────

  private deriveSnapshot(state: ReserveState, environment: Environment): ReserveMarketSnapshot {
    const utilization = deriveUtilization(state.balances);
    const shadowPriceBps = deriveShadowPriceBps(utilization, this.config);
    const scarcity = deriveScarcity(utilization, this.config);
    const reserveCostBps = deriveReserveCostBps(shadowPriceBps);
    const history = this.historyProvider?.getUtilizationHistory(state.reserve.id, environment);
    const forecast = deriveForecast(
      state.reserve.id,
      utilization,
      this.config,
      this.clock.now(),
      history,
    );

    const snapshot: ReserveMarketSnapshot = {
      reserveId: state.reserve.id,
      asset: state.reserve.asset,
      available: state.balances.available,
      locked: state.balances.locked,
      total: state.balances.available + state.balances.locked + state.balances.pending + state.balances.consumed + state.balances.released,
      utilization,
      shadowPriceBps,
      reserveCostBps,
      scarcity,
      forecast,
      confidence: forecast.confidence,
      generatedAt: this.clock.now(),
    };

    // Enforce economic invariants (fail-fast — the snapshot must be valid).
    const violations = validateMarketInvariants(snapshot);
    if (violations.length > 0) {
      throw new Error(`Market invariant violations for reserve ${state.reserve.id}: ${violations.join('; ')}`);
    }

    return snapshot;
  }
}
