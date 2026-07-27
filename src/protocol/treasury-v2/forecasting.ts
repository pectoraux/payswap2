/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Liquidity Forecasting.
 *
 * Forecasts corridor liquidity (demand for settlement capacity +
 * supply of LP liquidity) over a horizon. Uses a simple moving
 * average + linear trend extrapolation — sufficient for short
 * horizons (hours to a day). Production can swap in an ARIMA /
 * Prophet / LSTM model behind the same interface.
 *
 * Demand = total settlement volume flowing INTO the corridor (the
 *          destination side needs liquidity to pay out).
 * Supply = LP liquidity available in the corridor (the destination
 *          side's reserve).
 *
 * Net = supply - demand. A negative projected net is a shortfall
 * alert — the corridor will run out of liquidity before the horizon
 * ends.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `treasury.shortfall_alert` — when a corridor projects a shortfall.
 *
 * The kernel is FROZEN — this module imports only `nowTs`, `uid`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { nowTs, uid } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type { CorridorId, ForecastPoint, TreasuryAlert } from './types';
import { corridorKey } from './types';

/** A demand (settlement) sample. */
interface DemandSample {
  ts: number;
  amount: number;
}

/** A supply (LP liquidity) sample. */
interface SupplySample {
  ts: number;
  amount: number;
}

/** Per-corridor forecast state. */
interface CorridorForecastState {
  corridor: CorridorId;
  demandSamples: DemandSample[];
  supplySamples: SupplySample[];
  /** Current LP liquidity in the corridor (most recent supply sample). */
  currentSupply: number;
  /** Capacity (max LP liquidity ever committed to this corridor). */
  capacity: number;
}

/** A projected shortfall alert. */
export interface ShortfallAlert {
  id: string;
  corridor: CorridorId;
  projectedShortfallTs: number;
  projectedShortfallAmount: number;
  horizonMs: number;
  ts: number;
}

const MAX_SAMPLES = 1440; // 24h of minute-level samples

/**
 * Liquidity forecaster — owns per-corridor demand/supply sample
 * buffers and produces short-horizon forecasts.
 */
export class LiquidityForecaster {
  private states = new Map<string, CorridorForecastState>();
  /** Window for the moving average (ms). Default 1h. */
  private maWindowMs = 60 * 60 * 1000;
  /** Default forecast horizon (ms). Default 6h. */
  private defaultHorizonMs = 6 * 60 * 60 * 1000;
  /** Forecast interval (ms). Default 15min. */
  private forecastIntervalMs = 15 * 60 * 1000;

  /** Configure the moving-average window. */
  setMovingAverageWindow(ms: number): void {
    this.maWindowMs = Math.max(60_000, ms);
  }

  /** Configure the default forecast horizon. */
  setDefaultHorizon(ms: number): void {
    this.defaultHorizonMs = Math.max(60_000, ms);
  }

  /** Configure the forecast point interval. */
  setForecastInterval(ms: number): void {
    this.forecastIntervalMs = Math.max(60_000, ms);
  }

  /** Initialise / set the current supply (LP liquidity) for a corridor. */
  setSupply(corridor: CorridorId, amount: number, capacity?: number, ts: number = nowTs()): void {
    const key = corridorKey(corridor);
    const state = this.states.get(key) ?? {
      corridor,
      demandSamples: [],
      supplySamples: [],
      currentSupply: amount,
      capacity: capacity ?? amount,
    };
    state.currentSupply = amount;
    if (capacity !== undefined) state.capacity = capacity;
    state.supplySamples.push({ ts, amount });
    if (state.supplySamples.length > MAX_SAMPLES) state.supplySamples.shift();
    this.states.set(key, state);
  }

  /** Record a demand (settlement into the corridor) sample. */
  recordDemand(corridor: CorridorId, amount: number, ts: number = nowTs()): void {
    const key = corridorKey(corridor);
    const state = this.states.get(key) ?? {
      corridor,
      demandSamples: [],
      supplySamples: [],
      currentSupply: 0,
      capacity: 0,
    };
    state.demandSamples.push({ ts, amount });
    if (state.demandSamples.length > MAX_SAMPLES) state.demandSamples.shift();
    this.states.set(key, state);
  }

  /** Record a supply (LP liquidity) sample. Alias for `setSupply`. */
  recordSupply(corridor: CorridorId, amount: number, ts: number = nowTs()): void {
    this.setSupply(corridor, amount, undefined, ts);
  }

  /** Get the forecast state for a corridor (or undefined). */
  get(corridor: CorridorId): CorridorForecastState | undefined {
    return this.states.get(corridorKey(corridor));
  }

  /** All corridors being tracked. */
  corridors(): CorridorId[] {
    return [...this.states.values()].map((s) => s.corridor);
  }

  /**
   * Compute the moving average of demand over the configured window.
   * Returns 0 if no samples.
   */
  private movingAverageDemand(state: CorridorForecastState, now: number): number {
    const cutoff = now - this.maWindowMs;
    const recent = state.demandSamples.filter((s) => s.ts >= cutoff);
    if (recent.length === 0) return 0;
    // Sum of demand over the window, normalised to per-forecast-interval.
    const total = recent.reduce((acc, s) => acc + s.amount, 0);
    const windowSpan = Math.max(1, now - (recent[0]?.ts ?? cutoff));
    const perMs = total / windowSpan;
    return perMs * this.forecastIntervalMs;
  }

  /**
   * Compute the linear trend of demand (slope per forecast interval).
   * Returns 0 if < 2 samples.
   */
  private demandTrend(state: CorridorForecastState, now: number): number {
    const cutoff = now - this.maWindowMs;
    const recent = state.demandSamples.filter((s) => s.ts >= cutoff);
    if (recent.length < 2) return 0;
    // Simple linear regression slope: sum((x - xbar)(y - ybar)) / sum((x - xbar)^2).
    const n = recent.length;
    const xMean = recent.reduce((acc, s) => acc + s.ts, 0) / n;
    const yMean = recent.reduce((acc, s) => acc + s.amount, 0) / n;
    let num = 0;
    let den = 0;
    for (const s of recent) {
      num += (s.ts - xMean) * (s.amount - yMean);
      den += (s.ts - xMean) ** 2;
    }
    if (den === 0) return 0;
    const slopePerMs = num / den;
    return slopePerMs * this.forecastIntervalMs;
  }

  /**
   * Forecast demand + supply + net over the horizon.
   *
   * Produces `ceil(horizonMs / forecastIntervalMs)` forecast points
   * starting at `now`. Each point's demand is the moving average +
   * trend extrapolation; supply is held at the current level (LPs
   * don't add liquidity within the horizon absent a rebalance);
   * net = supply - cumulative demand.
   *
   * Confidence decays linearly from 1.0 at the first point to 0.2
   * at the last point (forecasts become less certain further out).
   */
  forecast(corridor: CorridorId, horizonMs?: number): ForecastPoint[] {
    const key = corridorKey(corridor);
    const state = this.states.get(key);
    const horizon = horizonMs ?? this.defaultHorizonMs;
    if (!state) {
      return [];
    }
    const now = nowTs();
    const points: ForecastPoint[] = [];
    const numPoints = Math.max(1, Math.ceil(horizon / this.forecastIntervalMs));
    const maDemand = this.movingAverageDemand(state, now);
    const trend = this.demandTrend(state, now);
    let cumulativeDemand = 0;
    for (let i = 1; i <= numPoints; i++) {
      const ts = now + i * this.forecastIntervalMs;
      const demand = Math.max(0, maDemand + trend * i);
      cumulativeDemand += demand;
      // Supply is constant unless a rebalance happens — model that
      // by leaving it at currentSupply. LPs adding liquidity within
      // the horizon is treated as a separate event (corridor funding).
      const supply = state.currentSupply;
      const net = supply - cumulativeDemand;
      const confidence = Math.max(0.2, 1.0 - (i - 1) / numPoints * 0.8);
      points.push({ ts, demand, supply, net, confidence });
    }
    return points;
  }

  /**
   * Scan all corridors for projected shortfalls within the default
   * horizon. Returns one alert per corridor whose forecast crosses
   * net < 0. Emits `treasury.shortfall_alert` for each.
   */
  shortfallAlerts(horizonMs?: number): ShortfallAlert[] {
    const alerts: ShortfallAlert[] = [];
    const now = nowTs();
    const horizon = horizonMs ?? this.defaultHorizonMs;
    for (const state of this.states.values()) {
      const points = this.forecast(state.corridor, horizon);
      for (const p of points) {
        if (p.net < 0) {
          const alert: ShortfallAlert = {
            id: uid('shortfall'),
            corridor: state.corridor,
            projectedShortfallTs: p.ts,
            projectedShortfallAmount: Math.abs(p.net),
            horizonMs: horizon,
            ts: now,
          };
          eventEngine.emit('treasury.shortfall_alert', {
            corridor: corridorKey(state.corridor),
            projectedShortfallTs: p.ts,
            projectedShortfallAmount: p.net,
            horizonMs: horizon,
            ts: now,
          });
          alerts.push(alert);
          break; // one alert per corridor (first crossing)
        }
      }
    }
    return alerts;
  }

  /**
   * Current utilisation for a corridor: cumulative demand over the
   * MA window / current supply. 0 if no demand or supply.
   */
  getUtilization(corridor: CorridorId): number {
    const state = this.states.get(corridorKey(corridor));
    if (!state || state.currentSupply <= 0) return 0;
    const now = nowTs();
    const cutoff = now - this.maWindowMs;
    const recent = state.demandSamples.filter((s) => s.ts >= cutoff);
    const total = recent.reduce((acc, s) => acc + s.amount, 0);
    return total / state.currentSupply;
  }

  /** Average utilisation across all corridors. */
  averageUtilization(): number {
    const corridors = [...this.states.keys()];
    if (corridors.length === 0) return 0;
    const total = corridors.reduce((acc, key) => {
      const state = this.states.get(key)!;
      if (state.currentSupply <= 0) return acc;
      const now = nowTs();
      const cutoff = now - this.maWindowMs;
      const recent = state.demandSamples.filter((s) => s.ts >= cutoff);
      const demand = recent.reduce((a, s) => a + s.amount, 0);
      return acc + demand / state.currentSupply;
    }, 0);
    return total / corridors.length;
  }

  /** Reset all forecast state. */
  reset(): void {
    this.states.clear();
  }

  /** Convert a shortfall alert to a treasury alert. */
  static toTreasuryAlert(alert: ShortfallAlert): TreasuryAlert {
    return {
      id: alert.id,
      level: 'warning',
      category: 'forecast',
      message: `Corridor ${corridorKey(alert.corridor)} projects shortfall of ${alert.projectedShortfallAmount.toFixed(2)} at ${new Date(alert.projectedShortfallTs).toISOString()}`,
      ts: alert.ts,
      subject: corridorKey(alert.corridor),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_LIQUIDITY_FORECASTER: LiquidityForecaster | undefined;
}

export const liquidityForecaster: LiquidityForecaster =
  globalThis.__PAYSWAP_LIQUIDITY_FORECASTER ?? new LiquidityForecaster();

if (!globalThis.__PAYSWAP_LIQUIDITY_FORECASTER) {
  globalThis.__PAYSWAP_LIQUIDITY_FORECASTER = liquidityForecaster;
}
