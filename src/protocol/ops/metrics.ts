/**
 * PaySwap Protocol — Operational Readiness — Prometheus-style Metrics Registry.
 *
 * Implements the Prometheus metric model (counter / gauge / histogram) with
 * label cardinality, a `MetricsRegistry` that owns all metrics, and an
 * `expose()` method that emits the standard Prometheus text exposition
 * format. The API surface mirrors `prom-client` so swapping to the real
 * package later is mechanical:
 *
 *   import { Counter, Registry } from 'prom-client';
 *   const c = new Counter({ name: 'foo_total', help: '...', labelNames: ['bar'] });
 *   c.inc({ bar: 'baz' });
 *
 * Maps directly to:
 *
 *   import { metricsRegistry } from '@/protocol/ops/metrics';
 *   const c = metricsRegistry.registerCounter('foo_total', '...', ['bar']);
 *   c.inc({ bar: 'baz' });
 *
 * Buckets are cumulative (Prometheus convention): a sample with value v
 * increments every bucket whose `le` >= v. `+Inf` is implicit and equals
 * the total observation count.
 *
 * Pre-registered metrics: see `registerStandardMetrics()` at the bottom.
 */
import { eventEngine } from '@/kernel/event';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MetricType = 'counter' | 'gauge' | 'histogram';

/** Label values passed to inc/set/observe — a plain string→string map. */
export type LabelValues = Record<string, string | number>;

/** A single bucket of a histogram (cumulative count of observations ≤ le). */
export interface HistogramBucket {
  le: number;
  count: number;
}

/** The observed state of a histogram for a given label set. */
export interface HistogramValue {
  count: number;
  sum: number;
  buckets: HistogramBucket[];
}

/** A metric data record — the storage shape (no methods). */
export interface Metric {
  name: string;
  type: MetricType;
  help: string;
  labels: string[];
  values: Map<string, number | HistogramValue>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the canonical Prometheus label-key for a label-value map.
 * Labels are sorted alphabetically by name and rendered as
 * `name1="val1",name2="val2"`. An empty (or no-label) metric returns ''.
 */
export function labelKey(names: string[], values?: LabelValues): string {
  if (!values) return '';
  const present = names.filter((n) => values[n] !== undefined && values[n] !== null);
  if (present.length === 0) return '';
  return [...present]
    .sort()
    .map((n) => `${n}="${String(values[n])}"`)
    .join(',');
}

/** Parse a label-key string back into a label-value map. */
export function parseLabelKey(key: string): LabelValues {
  const out: LabelValues = {};
  if (!key) return out;
  // Split on commas that are NOT inside quotes.
  const parts = key.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const p of parts) {
    const m = p.match(/^([^=]+)="(.*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Sum a counter's values, optionally filtered by a label predicate.
 * Generic helper used by the alerts + SLO modules.
 */
export function counterSum(
  registry: MetricsRegistry,
  metricName: string,
  labelFilter?: (labels: Record<string, string | number>) => boolean,
): number {
  const m = registry.getCounter(metricName);
  if (!m) return 0;
  let sum = 0;
  for (const [key, v] of m.values.entries()) {
    if (typeof v !== 'number') continue;
    if (labelFilter) {
      const labels = parseLabelKey(key);
      if (!labelFilter(labels)) continue;
    }
    sum += v;
  }
  return sum;
}

/**
 * Compute a percentile from a histogram value via linear interpolation
 * between bucket boundaries (the standard Prometheus `histogram_quantile`
 * algorithm). Returns 0 if no observations.
 */
export function histogramPercentile(hv: HistogramValue, p: number): number {
  if (hv.count === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const target = Math.ceil(hv.count * clamped);
  let prevCount = 0;
  let prevLe = 0;
  for (const b of hv.buckets) {
    if (b.count >= target) {
      const bucketCount = b.count - prevCount;
      if (bucketCount === 0) return b.le;
      const fraction = (target - prevCount) / bucketCount;
      return prevLe + (b.le - prevLe) * fraction;
    }
    prevCount = b.count;
    prevLe = b.le;
  }
  // Target is above every bucket — return the largest bucket boundary.
  return hv.buckets.length > 0 ? hv.buckets[hv.buckets.length - 1].le : 0;
}

// ─── Counter ──────────────────────────────────────────────────────────────────

/** A monotonically-increasing counter. */
export class Counter implements Metric {
  readonly type: MetricType = 'counter';
  values: Map<string, number> = new Map();

  constructor(
    public name: string,
    public help: string,
    public labels: string[] = [],
  ) {}

  /** Increment by `value` (default 1). Negative values are ignored. */
  inc(labels?: LabelValues, value = 1): void {
    if (value < 0) return; // counters must be monotonically non-decreasing
    const key = labelKey(this.labels, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  /** Current value for the given label set (0 if not set). */
  get(labels?: LabelValues): number {
    return this.values.get(labelKey(this.labels, labels)) ?? 0;
  }

  /** Reset all label values to 0. */
  reset(): void {
    this.values.clear();
  }
}

// ─── Gauge ───────────────────────────────────────────────────────────────────

/** A gauge — value can go up or down. */
export class Gauge implements Metric {
  readonly type: MetricType = 'gauge';
  values: Map<string, number> = new Map();

  constructor(
    public name: string,
    public help: string,
    public labels: string[] = [],
  ) {}

  /** Set the gauge to an absolute value. */
  set(labels: LabelValues | undefined, value: number): void;
  set(value: number): void;
  set(arg1: LabelValues | number | undefined, arg2?: number): void {
    if (typeof arg1 === 'number') {
      this.values.set('', arg1);
    } else {
      this.values.set(labelKey(this.labels, arg1), arg2 ?? 0);
    }
  }

  /** Increment by `value` (default 1). */
  inc(labels?: LabelValues, value = 1): void {
    const key = labelKey(this.labels, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  /** Decrement by `value` (default 1). */
  dec(labels?: LabelValues, value = 1): void {
    const key = labelKey(this.labels, labels);
    this.values.set(key, (this.values.get(key) ?? 0) - value);
  }

  /** Current value for the given label set (0 if not set). */
  get(labels?: LabelValues): number {
    return this.values.get(labelKey(this.labels, labels)) ?? 0;
  }

  /** Reset all label values to 0. */
  reset(): void {
    this.values.clear();
  }
}

// ─── Histogram ───────────────────────────────────────────────────────────────

/** A histogram — buckets observations into cumulative buckets. */
export class Histogram implements Metric {
  readonly type: MetricType = 'histogram';
  values: Map<string, HistogramValue> = new Map();

  constructor(
    public name: string,
    public help: string,
    public labels: string[] = [],
    public buckets: number[] = [],
  ) {
    // Buckets must be sorted ascending; +Inf is implicit.
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  /** Observe a value. */
  observe(labels: LabelValues | undefined, value: number): void;
  observe(value: number): void;
  observe(arg1: LabelValues | number | undefined, arg2?: number): void {
    let labels: LabelValues | undefined;
    let value: number;
    if (typeof arg1 === 'number') {
      labels = undefined;
      value = arg1;
    } else {
      labels = arg1;
      value = arg2 ?? 0;
    }
    const key = labelKey(this.labels, labels);
    let hv = this.values.get(key);
    if (!hv) {
      hv = {
        count: 0,
        sum: 0,
        buckets: this.buckets.map((le) => ({ le, count: 0 })),
      };
      this.values.set(key, hv);
    }
    hv.count += 1;
    hv.sum += value;
    for (const b of hv.buckets) {
      if (value <= b.le) b.count += 1;
    }
  }

  /** Histogram value for the given label set (or undefined). */
  get(labels?: LabelValues): HistogramValue | undefined {
    return this.values.get(labelKey(this.labels, labels));
  }

  /** Percentile for the given label set (0 if no observations). */
  percentile(labels: LabelValues | undefined, p: number): number {
    const hv = this.get(labels);
    if (!hv) return 0;
    return histogramPercentile(hv, p);
  }

  /** Reset all observations. */
  reset(): void {
    this.values.clear();
  }
}

// ─── MetricsRegistry ──────────────────────────────────────────────────────────

/** Union of all metric class types. */
export type AnyMetric = Counter | Gauge | Histogram;

/**
 * Owns all metrics. Provides registration, lookup, exposition (Prometheus
 * text format), and JSON snapshot.
 */
export class MetricsRegistry {
  private metrics: Map<string, AnyMetric> = new Map();

  /** Register a counter. Returns the counter (for direct inc/get calls). */
  registerCounter(name: string, help = '', labels: string[] = []): Counter {
    if (this.metrics.has(name)) {
      const m = this.metrics.get(name)!;
      if (m instanceof Counter) return m;
    }
    const c = new Counter(name, help, labels);
    this.metrics.set(name, c);
    return c;
  }

  /** Register a gauge. Returns the gauge. */
  registerGauge(name: string, help = '', labels: string[] = []): Gauge {
    if (this.metrics.has(name)) {
      const m = this.metrics.get(name)!;
      if (m instanceof Gauge) return m;
    }
    const g = new Gauge(name, help, labels);
    this.metrics.set(name, g);
    return g;
  }

  /** Register a histogram. Returns the histogram. */
  registerHistogram(
    name: string,
    help = '',
    labels: string[] = [],
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ): Histogram {
    if (this.metrics.has(name)) {
      const m = this.metrics.get(name)!;
      if (m instanceof Histogram) return m;
    }
    const h = new Histogram(name, help, labels, buckets);
    this.metrics.set(name, h);
    return h;
  }

  /** Look up a metric by name (returns undefined if not registered). */
  get(name: string): AnyMetric | undefined {
    return this.metrics.get(name);
  }

  /** Convenience: get a registered Counter (undefined if not a counter). */
  getCounter(name: string): Counter | undefined {
    const m = this.metrics.get(name);
    return m instanceof Counter ? m : undefined;
  }

  /** Convenience: get a registered Gauge. */
  getGauge(name: string): Gauge | undefined {
    const m = this.metrics.get(name);
    return m instanceof Gauge ? m : undefined;
  }

  /** Convenience: get a registered Histogram. */
  getHistogram(name: string): Histogram | undefined {
    const m = this.metrics.get(name);
    return m instanceof Histogram ? m : undefined;
  }

  /** All registered metrics. */
  all(): AnyMetric[] {
    return [...this.metrics.values()];
  }

  /**
   * Emit the standard Prometheus text exposition format:
   *
   *   # HELP metric_name help text
   *   # TYPE metric_name counter|gauge|histogram
   *   metric_name{label="value"} 42
   *   metric_name_bucket{label="value",le="100"} 5
   *   metric_name_sum{label="value"} 1234.5
   *   metric_name_count{label="value"} 10
   *
   * Suitable for scraping via `/api/metrics` or feeding to a
   * Prometheus-bridge.
   */
  expose(): string {
    const lines: string[] = [];
    for (const m of this.metrics.values()) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.type}`);
      if (m instanceof Histogram) {
        for (const [key, hv] of m.values.entries()) {
          const prefix = key ? `${key},` : '';
          for (const b of hv.buckets) {
            lines.push(`${m.name}_bucket{${prefix}le="${b.le}"} ${b.count}`);
          }
          lines.push(`${m.name}_bucket{${prefix}le="+Inf"} ${hv.count}`);
          lines.push(`${m.name}_sum${key ? `{${key}}` : ''} ${hv.sum}`);
          lines.push(`${m.name}_count${key ? `{${key}}` : ''} ${hv.count}`);
        }
      } else {
        for (const [key, value] of m.values.entries()) {
          lines.push(`${m.name}${key ? `{${key}}` : ''} ${value}`);
        }
      }
    }
    return lines.join('\n');
  }

  /**
   * JSON snapshot — every metric, every label set, with type info.
   * Useful for dashboards that don't speak Prometheus text format.
   */
  json(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const m of this.metrics.values()) {
      const entries: Record<string, unknown> = {};
      for (const [key, value] of m.values.entries()) {
        entries[key || '_'] = value;
      }
      out[m.name] = {
        type: m.type,
        help: m.help,
        labels: m.labels,
        ...(m instanceof Histogram ? { buckets: m.buckets } : {}),
        values: entries,
      };
    }
    return out;
  }

  /** Reset every metric (clears all label values). */
  reset(): void {
    for (const m of this.metrics.values()) m.reset();
  }

  /**
   * Record a connector outcome into the standard connector metrics.
   * Helper used by the ops dashboard + alerting — keeps the metric
   * emission format consistent with `connectors-v2/metrics.ts`.
   */
  recordConnectorRequest(
    connector: string,
    status: 'success' | 'failed' | 'rate_limited' | 'error',
    latencyMs: number,
  ): void {
    const total = this.getCounter('payswap_connector_requests_total');
    const latency = this.getHistogram('payswap_connector_latency_ms');
    total?.inc({ connector, status });
    latency?.observe({ connector }, latencyMs);
    eventEngine.emit('ops.metric_recorded', {
      metric: 'payswap_connector_requests_total',
      connector,
      status,
      latencyMs,
    });
  }
}

// ─── Singleton + Standard Metrics ─────────────────────────────────────────────

/** Singleton metrics registry — shared by the entire PaySwap runtime. */
export const metricsRegistry = new MetricsRegistry();

/**
 * Pre-register the standard PaySwap operational metrics. Called once at
 * module load. Idempotent (calling twice is a no-op — `registerX` returns
 * the existing metric if already registered).
 */
export function registerStandardMetrics(registry: MetricsRegistry = metricsRegistry): void {
  // Payments
  registry.registerCounter(
    'payswap_payments_total',
    'Total payments processed, by status/currency/corridor.',
    ['status', 'currency', 'corridor'],
  );
  // Payouts
  registry.registerCounter(
    'payswap_payouts_total',
    'Total payouts processed, by method/status.',
    ['method', 'status'],
  );
  // Settlement duration
  registry.registerHistogram(
    'payswap_settlement_duration_ms',
    'Time from payment intent to final settlement, by corridor.',
    ['corridor'],
    [100, 500, 1000, 5000, 10000, 30000, 60000],
  );
  // Planner latency
  registry.registerHistogram(
    'payswap_planner_latency_ms',
    'Solver/planner latency per plan.',
    [],
    [1, 5, 10, 25, 50, 100, 250],
  );
  // Connector latency
  registry.registerHistogram(
    'payswap_connector_latency_ms',
    'Per-connector request latency.',
    ['connector'],
    [10, 50, 100, 250, 500, 1000, 5000],
  );
  // Connector requests
  registry.registerCounter(
    'payswap_connector_requests_total',
    'Total connector requests, by connector/status.',
    ['connector', 'status'],
  );
  // Twin token supply
  registry.registerGauge(
    'payswap_twin_tokens_supply',
    'Circulating Twin Token supply, by asset.',
    ['asset'],
  );
  // Twin token escrow
  registry.registerGauge(
    'payswap_twin_tokens_escrowed',
    'Twin Tokens currently escrowed (in-flight), by asset.',
    ['asset'],
  );
  // LP active count
  registry.registerGauge(
    'payswap_lp_active_count',
    'Number of active liquidity providers.',
    [],
  );
  // LP capacity
  registry.registerGauge(
    'payswap_lp_capacity_available',
    'Available LP capacity, by corridor.',
    ['corridor'],
  );
  // Ledger posts
  registry.registerCounter(
    'payswap_ledger_posted_total',
    'Total ledger entries posted.',
    [],
  );
  // Webhook deliveries
  registry.registerCounter(
    'payswap_webhook_deliveries_total',
    'Total webhook deliveries, by status.',
    ['status'],
  );
  // Treasury reserve ratio
  registry.registerGauge(
    'payswap_treasury_reserve_ratio',
    'Per-currency treasury reserve ratio (reserve / circulating).',
    ['currency'],
  );
  // DB query duration
  registry.registerHistogram(
    'payswap_db_query_duration_ms',
    'Database query duration.',
    [],
    [1, 5, 10, 25, 50, 100],
  );
}

// Register on module load.
registerStandardMetrics();
