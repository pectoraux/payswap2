/**
 * Reserve Market — pure economic analysis of the Reserve Ledger. (M-RT-4.)
 *
 * DISCIPLINE: the market is a READ MODEL, not a stateful service. It owns NO
 * persistent state. Everything it produces (shadow price, utilization, scarcity,
 * reserve cost, forecast) is a PURE FUNCTION of:
 *   - Reserve Ledger (what exists)
 *   - Runtime Clock (when)
 *   - Configuration / policy (how to price)
 *   - Historical observations (for forecasting)
 *
 * The ledger answers "what exists?" The market answers "what is it worth?"
 * Those never mix.
 *
 * DETERMINISM: given identical inputs, the market always produces identical
 * outputs — making it replayable and testable exactly like the ledger.
 *
 * INVARIANTS (economic, not accounting):
 *   0 ≤ utilization ≤ 1
 *   shadowPrice ≥ 0
 *   reserveCost ≥ 0
 *   scarcity ∈ {LOW, MEDIUM, HIGH, CRITICAL}
 *   confidence ∈ [0, 1]
 */

import type { ReserveBalances } from '../reserve-ledger/types';
import type { ReserveState } from '../reserve-ledger/types';

/** Scarcity level — how tight the reserve is. */
export type Scarcity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** A forecast prediction (a hypothesis, never stored as state). */
export interface Prediction {
  /** The metric being predicted (e.g. 'utilization', 'available'). */
  metric: string;
  /** The predicted value at the forecast horizon. */
  value: number;
  /** Confidence 0..1. */
  confidence: number;
  /** The assumptions the prediction rests on. */
  assumptions: string[];
  /** When the prediction was generated (Runtime Clock). */
  generatedAt: number;
  /** The forecast horizon in ms. */
  horizonMs: number;
}

/** A market forecast — a set of predictions, never stored as state. */
export interface MarketForecast {
  reserveId: string;
  predictions: Prediction[];
  generatedAt: number;
}

/** The market snapshot for one reserve — fully derived, never stored. */
export interface ReserveMarketSnapshot {
  reserveId: string;
  asset: string;
  // From the ledger (what exists):
  available: number;
  locked: number;
  total: number;
  // Derived economics (what it's worth):
  utilization: number;          // 0..1 = locked / total (or 0 if total=0)
  shadowPriceBps: number;       // ≥ 0 — opportunity cost of one more unit (bps)
  reserveCostBps: number;       // ≥ 0 — cost to consume one unit (bps)
  scarcity: Scarcity;           // LOW | MEDIUM | HIGH | CRITICAL
  // Forecast (a hypothesis):
  forecast: Prediction;         // utilization forecast for the next horizon
  // Meta:
  confidence: number;           // 0..1 — confidence in the snapshot
  generatedAt: number;          // Runtime Clock
}

/** The market snapshot for all reserves. */
export interface MarketSnapshot {
  reserves: ReserveMarketSnapshot[];
  generatedAt: number;
}

/** Configuration for the market engine — the pricing policy. */
export interface MarketConfig {
  /** Base shadow price (bps) when utilization is 0. */
  baseShadowPriceBps: number;
  /** Shadow price at 100% utilization (bps). The price scales linearly between base and max. */
  maxShadowPriceBps: number;
  /** Utilization threshold for MEDIUM scarcity. */
  mediumUtilizationThreshold: number;   // e.g. 0.5
  /** Utilization threshold for HIGH scarcity. */
  highUtilizationThreshold: number;     // e.g. 0.75
  /** Utilization threshold for CRITICAL scarcity. */
  criticalUtilizationThreshold: number; // e.g. 0.9
  /** Forecast horizon in ms. */
  forecastHorizonMs: number;            // e.g. 3600000 (1 hour)
  /** Forecast confidence baseline (0..1). */
  forecastConfidence: number;
}

/** Default market config. */
export const DEFAULT_MARKET_CONFIG: MarketConfig = {
  baseShadowPriceBps: 3,       // 0.03% at 0% utilization
  maxShadowPriceBps: 87,       // 0.87% at 100% utilization
  mediumUtilizationThreshold: 0.5,
  highUtilizationThreshold: 0.75,
  criticalUtilizationThreshold: 0.9,
  forecastHorizonMs: 3_600_000, // 1 hour
  forecastConfidence: 0.7,
};

// ─── Economic invariants (pure functions) ───────────────────────────────────

/** Validate that a snapshot satisfies all economic invariants. */
export function validateMarketInvariants(snapshot: ReserveMarketSnapshot): string[] {
  const violations: string[] = [];
  if (snapshot.utilization < 0 || snapshot.utilization > 1) {
    violations.push(`utilization must be in [0, 1], got ${snapshot.utilization}`);
  }
  if (snapshot.shadowPriceBps < 0) {
    violations.push(`shadowPrice must be ≥ 0, got ${snapshot.shadowPriceBps}`);
  }
  if (snapshot.reserveCostBps < 0) {
    violations.push(`reserveCost must be ≥ 0, got ${snapshot.reserveCostBps}`);
  }
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(snapshot.scarcity)) {
    violations.push(`scarcity must be LOW|MEDIUM|HIGH|CRITICAL, got ${snapshot.scarcity}`);
  }
  if (snapshot.confidence < 0 || snapshot.confidence > 1) {
    violations.push(`confidence must be in [0, 1], got ${snapshot.confidence}`);
  }
  return violations;
}

// ─── Pure derivation functions ──────────────────────────────────────────────

/** Derive utilization from balances. Pure. */
export function deriveUtilization(balances: ReserveBalances): number {
  const total = balances.available + balances.locked + balances.pending + balances.consumed + balances.released;
  if (total === 0) return 0;
  return balances.locked / total;
}

/** Derive shadow price from utilization + config. Pure, linear interpolation. */
export function deriveShadowPriceBps(utilization: number, config: MarketConfig): number {
  const { baseShadowPriceBps, maxShadowPriceBps } = config;
  return Math.round(baseShadowPriceBps + (maxShadowPriceBps - baseShadowPriceBps) * utilization);
}

/** Derive scarcity from utilization + config. Pure. */
export function deriveScarcity(utilization: number, config: MarketConfig): Scarcity {
  if (utilization >= config.criticalUtilizationThreshold) return 'CRITICAL';
  if (utilization >= config.highUtilizationThreshold) return 'HIGH';
  if (utilization >= config.mediumUtilizationThreshold) return 'MEDIUM';
  return 'LOW';
}

/** Derive reserve cost from shadow price. Pure (cost = shadow price for now). */
export function deriveReserveCostBps(shadowPriceBps: number): number {
  return shadowPriceBps;
}

/**
 * Derive a forecast prediction. Pure.
 *
 * M-RT-4 uses a simple model: forecast utilization stays roughly constant,
 * confidence is the config baseline. Later milestones (Runtime Memory,
 * Economic Intelligence) feed real historical observations to improve this.
 */
export function deriveForecast(
  reserveId: string,
  currentUtilization: number,
  config: MarketConfig,
  generatedAt: number,
  historicalObservations?: number[],
): Prediction {
  // If we have historical observations, compute a simple linear trend.
  let predictedUtilization = currentUtilization;
  let confidence = config.forecastConfidence;
  const assumptions: string[] = [];

  if (historicalObservations && historicalObservations.length >= 2) {
    // Simple linear trend: slope = average delta over the last N observations.
    const deltas: number[] = [];
    for (let i = 1; i < historicalObservations.length; i++) {
      deltas.push(historicalObservations[i] - historicalObservations[i - 1]);
    }
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const stepsAhead = config.forecastHorizonMs / 3_600_000; // hours
    predictedUtilization = Math.max(0, Math.min(1, currentUtilization + avgDelta * stepsAhead));
    confidence = Math.max(0.5, Math.min(0.95, config.forecastConfidence + deltas.length * 0.01));
    assumptions.push(`Linear trend from ${historicalObservations.length} observations`);
    assumptions.push(`Average delta per step: ${avgDelta.toFixed(4)}`);
  } else {
    assumptions.push('No historical observations; assuming utilization stays constant');
  }

  return {
    metric: 'utilization',
    value: predictedUtilization,
    confidence,
    assumptions,
    generatedAt,
    horizonMs: config.forecastHorizonMs,
  };
}
