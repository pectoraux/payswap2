/**
 * Liquidity Forecasting — time-series demand/supply forecasting with shortfall
 * detection.
 *
 * The forecaster tracks historical demand (settlement attempts per corridor)
 * and supply (capacity additions per corridor), then projects forward using a
 * moving average + linear trend.
 *
 * Forecasting is deterministic given the demand/supply history — no random.
 *
 * Shortfall detection: if projected demand > projected supply at any forecast
 * point, the corridor is flagged as having a shortfall (and the
 * `shortfallAlerts()` method returns it).
 */
import {
  corridorKey,
  type Corridor,
  type ForecastPoint,
} from './types';
import { liquidityRegistry } from './registry';

interface DemandSample { ts: number; amount: number; }
interface SupplySample { ts: number; amount: number; }

/** Default forecast horizon (1 hour). */
export const DEFAULT_FORECAST_HORIZON_MS = 60 * 60 * 1000;

/** Default forecast granularity (15 minutes per point). */
export const DEFAULT_FORECAST_BUCKET_MS = 15 * 60 * 1000;

/** Moving-average window (last N samples). */
const MA_WINDOW = 10;

export class LiquidityForecaster {
  private demand: Map<string, DemandSample[]> = new Map();
  private supply: Map<string, SupplySample[]> = new Map();

  private key(c: Corridor): string {
    return corridorKey(c);
  }

  /** Record a demand sample (a settlement attempt) for a corridor. */
  recordDemand(corridor: Corridor, amount: number, ts: number = Date.now()): void {
    if (amount <= 0) return;
    const k = this.key(corridor);
    if (!this.demand.has(k)) this.demand.set(k, []);
    this.demand.get(k)!.push({ ts, amount });
    // Trim to last 1000 samples to bound memory.
    const arr = this.demand.get(k)!;
    if (arr.length > 1000) arr.shift();
  }

  /** Record a supply sample (a capacity addition) for a corridor. */
  recordSupply(corridor: Corridor, amount: number, ts: number = Date.now()): void {
    if (amount <= 0) return;
    const k = this.key(corridor);
    if (!this.supply.has(k)) this.supply.set(k, []);
    this.supply.get(k)!.push({ ts, amount });
    const arr = this.supply.get(k)!;
    if (arr.length > 1000) arr.shift();
  }

  /** Simple moving average over the last N samples. */
  private movingAverage(samples: { amount: number }[], window: number = MA_WINDOW): number {
    if (samples.length === 0) return 0;
    const start = Math.max(0, samples.length - window);
    const slice = samples.slice(start);
    return slice.reduce((s, x) => s + x.amount, 0) / slice.length;
  }

  /**
   * Linear trend slope — least-squares slope over the last N samples.
   * Returns bps-style slope (rate of change per sample).
   */
  private trendSlope(samples: { ts: number; amount: number }[], window: number = MA_WINDOW): number {
    if (samples.length < 2) return 0;
    const start = Math.max(0, samples.length - window);
    const slice = samples.slice(start);
    const n = slice.length;
    if (n < 2) return 0;
    // Use index (0..n-1) as x to avoid ts-scale issues.
    const meanX = (n - 1) / 2;
    const meanY = slice.reduce((s, x) => s + x.amount, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (slice[i].amount - meanY);
      den += (i - meanX) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  /**
   * Forecast demand + supply for a corridor over a horizon.
   *
   * Returns `ForecastPoint[]` — one per `bucket` interval from now to
   * now+horizon. Each point projects:
   *  - projectedDemand = movingAvg(demand) + slope(demand) × bucketIndex
   *  - projectedSupply = currentAvailableCapacity + movingAvg(supply) + slope(supply) × bucketIndex
   *  - shortfall = max(0, projectedDemand − projectedSupply)
   *  - confidence = sample-count-based (more samples → higher confidence)
   *
   * Deterministic given the demand/supply history.
   */
  forecast(
    corridor: Corridor,
    horizonMs: number = DEFAULT_FORECAST_HORIZON_MS,
    bucketMs: number = DEFAULT_FORECAST_BUCKET_MS,
    now: number = Date.now(),
  ): ForecastPoint[] {
    const k = this.key(corridor);
    const demandSamples = this.demand.get(k) ?? [];
    const supplySamples = this.supply.get(k) ?? [];

    const demandMA = this.movingAverage(demandSamples);
    const demandSlope = this.trendSlope(demandSamples);
    const supplyMA = this.movingAverage(supplySamples);
    const supplySlope = this.trendSlope(supplySamples);

    // Current available supply = sum of availableCapacity across active LPs.
    const currentSupply = this.currentSupply(corridor);

    // Confidence: more samples → higher confidence. Capped at 1.
    const sampleCount = Math.max(demandSamples.length, supplySamples.length);
    const confidence = Math.min(1, sampleCount / MA_WINDOW);

    const points: ForecastPoint[] = [];
    const buckets = Math.max(1, Math.floor(horizonMs / bucketMs));
    for (let i = 1; i <= buckets; i++) {
      const ts = now + i * bucketMs;
      const projectedDemand = Math.max(0, demandMA + demandSlope * i);
      const projectedSupply = Math.max(0, currentSupply + supplyMA + supplySlope * i);
      const shortfall = Math.max(0, projectedDemand - projectedSupply);
      points.push({
        ts,
        corridor,
        projectedDemand: Math.round(projectedDemand * 100) / 100,
        projectedSupply: Math.round(projectedSupply * 100) / 100,
        shortfall: Math.round(shortfall * 100) / 100,
        confidence,
      });
    }
    return points;
  }

  /** Current available supply = Σ availableCapacity for active LPs. */
  private currentSupply(corridor: Corridor): number {
    const lps = liquidityRegistry.activeLPs(corridor);
    const k = this.key(corridor);
    return lps.reduce((s, lp) => s + (lp.availableCapacity[k] ?? 0), 0);
  }

  /**
   * Shortfall alerts — corridors with projected shortfalls in the next
   * horizon. Returns the list of corridors where at least one forecast point
   * has shortfall > 0.
   */
  shortfallAlerts(horizonMs: number = DEFAULT_FORECAST_HORIZON_MS, now: number = Date.now()): Corridor[] {
    const corridors = new Set<string>([...this.demand.keys(), ...this.supply.keys()]);
    const alerts: Corridor[] = [];
    for (const k of corridors) {
      const [fromCurrency, toCurrency] = k.split('→');
      const corridor: Corridor = { fromCurrency, toCurrency };
      const points = this.forecast(corridor, horizonMs, DEFAULT_FORECAST_BUCKET_MS, now);
      if (points.some((p) => p.shortfall > 0)) {
        alerts.push(corridor);
      }
    }
    return alerts;
  }

  /**
   * Current utilization % for a corridor — (reserved + consumed) / total
   * capacity. Consumed capacity = capacity − availableCapacity −
   * reservedCapacity (capacity already reduced at consume time).
   *
   * Returns 0 if no LPs serve the corridor.
   */
  getUtilization(corridor: Corridor): number {
    const lps = liquidityRegistry.activeLPs(corridor);
    const k = this.key(corridor);
    let totalCapacity = 0;
    let used = 0;
    for (const lp of lps) {
      const cap = lp.capacity[k] ?? 0;
      const avail = lp.availableCapacity[k] ?? 0;
      const reserved = lp.reservedCapacity[k] ?? 0;
      // consumed = capacity_original − capacity_current
      // but capacity_current already reflects consumes. Used = reserved + (capacity_original − capacity_current − reserved) = capacity_original − capacity_current + reserved − reserved... let me simplify:
      // used = current total capacity that's NOT available = cap − avail (includes reserved).
      // That's actually correct: if cap=1000, reserved=200, consumed=300, then avail=500 and used = cap − avail = 500 = 200 reserved + 300 consumed.
      totalCapacity += cap;
      used += (cap - avail);
    }
    if (totalCapacity === 0) return 0;
    return Math.round((used / totalCapacity) * 10000) / 100; // percent with 2 decimals
  }

  /** Clear all forecast state (test helper). */
  reset(): void {
    this.demand.clear();
    this.supply.clear();
  }
}

/** Singleton forecaster. */
export const liquidityForecaster = new LiquidityForecaster();
