/**
 * PaySwap Protocol — Ops Module — Prometheus-style Metrics Registry.
 *
 * A self-contained, dependency-light metrics registry that mirrors the
 * Prometheus data model:
 *
 *   - Counter   : monotonic, `inc()` only
 *   - Gauge     : `set()` / `inc()` / `dec()`
 *   - Histogram : `observe()` into fixed buckets; `percentile(p)` via
 *                  nearest-rank interpolation across all observations
 *
 * The registry produces two wire formats:
 *   - `expose()` → Prometheus text exposition format
 *   - `json()`   → plain JSON snapshot for dashboards / API routes
 *
 * The kernel is FROZEN. This module imports only `round` from
 * `@/kernel/support` and stays entirely inside `src/protocol/ops/`.
 */
import { round } from '@/kernel/support';

/** Label set — keys are label names, values are stringified. */
export type LabelSet = Record<string, string>;

/** Metric kind tag. */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** Shared descriptor fields every metric exposes. */
export interface MetricDescriptor {
  name: string;
  help: string;
  type: MetricType;
  labels: string[];
}

/** Default histogram bucket boundaries (latency in ms). */
export const DEFAULT_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
];

/** A single observed value plus its label set. */
export interface MetricEntry {
  labels: LabelSet;
  value: number;
}

/** One histogram bucket plus its cumulative count. */
export interface HistogramBucket {
  /** Upper bound (inclusive); `Infinity` represents the +Inf bucket. */
  le: number;
  /** Cumulative observations ≤ le. */
  count: number;
}

/** Aggregated histogram snapshot for one label set. */
export interface HistogramSnapshot {
  labels: LabelSet;
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

/**
 * Canonical serialization key for a label set. Uses the metric's declared
 * label names when available so missing labels sort deterministically.
 */
export function labelKey(declared: string[], labels?: LabelSet): string {
  const l = labels ?? {};
  const names = declared.length > 0 ? declared : Object.keys(l).sort();
  return names.map((k) => `${k}=${l[k] ?? ''}`).join('|');
}

/** Pretty-print a label set for the Prometheus exposition format. */
function renderLabels(labels: LabelSet, extra?: Record<string, string>): string {
  const merged: LabelSet = { ...labels, ...(extra ?? {}) };
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) return '';
  return (
    '{' +
    keys
      .map((k) => `${k}="${String(merged[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',') +
    '}'
  );
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

/** Monotonic counter — only increments. */
export class Counter implements MetricDescriptor {
  readonly type: MetricType = 'counter';
  readonly name: string;
  readonly help: string;
  readonly labels: string[];
  private entries = new Map<string, { labels: LabelSet; value: number }>();

  constructor(name: string, help: string, labels: string[] = []) {
    this.name = name;
    this.help = help;
    this.labels = labels;
  }

  /** Increment the counter for a label set. `value` must be ≥ 0. */
  inc(labels?: LabelSet, value = 1): void {
    if (value < 0) {
      throw new Error(`Counter ${this.name}.inc: value must be non-negative (got ${value})`);
    }
    const k = labelKey(this.labels, labels);
    const e = this.entries.get(k);
    if (e) e.value += value;
    else this.entries.set(k, { labels: labels ?? {}, value });
  }

  /** Current counter value for a label set (0 if never incremented). */
  get(labels?: LabelSet): number {
    return this.entries.get(labelKey(this.labels, labels))?.value ?? 0;
  }

  /** Sum of all label combinations — useful for "total" alerts. */
  total(): number {
    let s = 0;
    for (const e of this.entries.values()) s += e.value;
    return s;
  }

  /** All label/value pairs. */
  all(): MetricEntry[] {
    return [...this.entries.values()].map((e) => ({ labels: e.labels, value: e.value }));
  }

  /** Number of distinct label combinations. */
  size(): number {
    return this.entries.size;
  }

  /** Reset all values (testing only). */
  reset(): void {
    this.entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/** Gauge — set, inc, or dec. */
export class Gauge implements MetricDescriptor {
  readonly type: MetricType = 'gauge';
  readonly name: string;
  readonly help: string;
  readonly labels: string[];
  private entries = new Map<string, { labels: LabelSet; value: number }>();

  constructor(name: string, help: string, labels: string[] = []) {
    this.name = name;
    this.help = help;
    this.labels = labels;
  }

  /** Set the gauge to an absolute value (defaults to 0 when omitted). */
  set(labels?: LabelSet, value: number = 0): void {
    const k = labelKey(this.labels, labels);
    const e = this.entries.get(k);
    if (e) e.value = value;
    else this.entries.set(k, { labels: labels ?? {}, value });
  }

  /** Increment the gauge by `value` (default 1). */
  inc(labels?: LabelSet, value = 1): void {
    const k = labelKey(this.labels, labels);
    const e = this.entries.get(k);
    if (e) e.value += value;
    else this.entries.set(k, { labels: labels ?? {}, value });
  }

  /** Decrement the gauge by `value` (default 1). */
  dec(labels?: LabelSet, value = 1): void {
    this.inc(labels, -value);
  }

  /** Current gauge value for a label set (0 if never set). */
  get(labels?: LabelSet): number {
    return this.entries.get(labelKey(this.labels, labels))?.value ?? 0;
  }

  /** True if the gauge has ever been set for this label combination. */
  has(labels?: LabelSet): boolean {
    return this.entries.has(labelKey(this.labels, labels));
  }

  /** Sum across all label combinations. */
  total(): number {
    let s = 0;
    for (const e of this.entries.values()) s += e.value;
    return s;
  }

  /** All label/value pairs. */
  all(): MetricEntry[] {
    return [...this.entries.values()].map((e) => ({ labels: e.labels, value: e.value }));
  }

  /** Reset all values (testing only). */
  reset(): void {
    this.entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

/** Histogram — observations bucketed into fixed boundaries. */
export class Histogram implements MetricDescriptor {
  readonly type: MetricType = 'histogram';
  readonly name: string;
  readonly help: string;
  readonly labels: string[];
  readonly buckets: number[];

  // Per-label-set state.
  private entries = new Map<
    string,
    {
      labels: LabelSet;
      bucketCounts: number[];
      sum: number;
      count: number;
      values: number[];
    }
  >();

  // Global aggregate across every label set (drives `percentile(p)`).
  private globalValues: number[] = [];
  private globalSum = 0;
  private globalCount = 0;
  private globalBuckets: number[];

  constructor(
    name: string,
    help: string,
    labels: string[] = [],
    buckets: number[] = DEFAULT_BUCKETS_MS,
  ) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    // De-dupe + sort the bucket upper bounds.
    const uniq = Array.from(new Set(buckets)).sort((a, b) => a - b);
    this.buckets = uniq;
    this.globalBuckets = uniq.map(() => 0);
  }

  /** Record an observation (defaults to 0 when omitted). */
  observe(labels?: LabelSet, value: number = 0): void {
    if (!Number.isFinite(value)) return;
    const k = labelKey(this.labels, labels);
    let e = this.entries.get(k);
    if (!e) {
      e = {
        labels: labels ?? {},
        bucketCounts: this.buckets.map(() => 0),
        sum: 0,
        count: 0,
        values: [],
      };
      this.entries.set(k, e);
    }
    e.sum += value;
    e.count += 1;
    e.values.push(value);
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) e.bucketCounts[i] += 1;
    }
    // Global aggregates.
    this.globalSum += value;
    this.globalCount += 1;
    this.globalValues.push(value);
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) this.globalBuckets[i] += 1;
    }
  }

  /**
   * Nearest-rank percentile across ALL observations (ignoring labels).
   * `p` ∈ [0,1]. Returns 0 when no observations have been recorded.
   */
  percentile(p: number): number {
    const n = this.globalValues.length;
    if (n === 0) return 0;
    const clamped = Math.min(1, Math.max(0, p));
    const sorted = [...this.globalValues].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil(clamped * n));
    return sorted[Math.min(rank - 1, n - 1)];
  }

  /** Percentile restricted to a single label set. */
  percentileFor(p: number, labels?: LabelSet): number {
    const e = this.entries.get(labelKey(this.labels, labels));
    if (!e || e.values.length === 0) return 0;
    const clamped = Math.min(1, Math.max(0, p));
    const sorted = [...e.values].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil(clamped * sorted.length));
    return sorted[Math.min(rank - 1, sorted.length - 1)];
  }

  /** Global observation count. */
  count(): number {
    return this.globalCount;
  }

  /** Global sum of all observations. */
  sum(): number {
    return this.globalSum;
  }

  /** Global average (0 if no observations). */
  avg(): number {
    return this.globalCount === 0 ? 0 : round(this.globalSum / this.globalCount, 4);
  }

  /** Per-label-set histogram snapshots. */
  snapshots(): HistogramSnapshot[] {
    return [...this.entries.values()].map((e) => {
      const buckets: HistogramBucket[] = e.bucketCounts.map((c, i) => ({
        le: this.buckets[i],
        count: c, // bucketCounts are already cumulative (every bucket ≤ value is incremented)
      }));
      buckets.push({ le: Infinity, count: e.count });
      return { labels: e.labels, buckets, sum: round(e.sum, 6), count: e.count };
    });
  }

  /** Global histogram snapshot (aggregated across labels). */
  globalSnapshot(): HistogramSnapshot {
    const buckets: HistogramBucket[] = this.globalBuckets.map((c, i) => ({
      le: this.buckets[i],
      count: c,
    }));
    buckets.push({ le: Infinity, count: this.globalCount });
    return { labels: {}, buckets, sum: round(this.globalSum, 6), count: this.globalCount };
  }

  /** Reset all observations (testing only). */
  reset(): void {
    this.entries.clear();
    this.globalValues = [];
    this.globalSum = 0;
    this.globalCount = 0;
    this.globalBuckets = this.buckets.map(() => 0);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Union type for any registered metric. */
export type AnyMetric = Counter | Gauge | Histogram;

/** JSON-serializable metric snapshot returned by `MetricsRegistry.json()`. */
export interface MetricJsonSnapshot {
  name: string;
  help: string;
  type: MetricType;
  labels: string[];
  entries?: MetricEntry[]; // present for counter / gauge
  histogram?: HistogramSnapshot[]; // present for histogram
  total?: number; // counter/gauge sum
  count?: number; // histogram observation count
  sum?: number; // histogram observation sum
  avg?: number; // histogram average
  p50?: number; // histogram global percentiles
  p95?: number;
  p99?: number;
}

/**
 * Prometheus-style registry. Owns all metrics by name. Pre-loaded with the
 * PaySwap operational metric set on construction.
 */
export class MetricsRegistry {
  private metrics = new Map<string, AnyMetric>();

  /** Register (or return an existing) counter. */
  registerCounter(name: string, help: string, labels: string[] = []): Counter {
    const existing = this.metrics.get(name);
    if (existing instanceof Counter) return existing;
    const c = new Counter(name, help, labels);
    this.metrics.set(name, c);
    return c;
  }

  /** Register (or return an existing) gauge. */
  registerGauge(name: string, help: string, labels: string[] = []): Gauge {
    const existing = this.metrics.get(name);
    if (existing instanceof Gauge) return existing;
    const g = new Gauge(name, help, labels);
    this.metrics.set(name, g);
    return g;
  }

  /** Register (or return an existing) histogram. */
  registerHistogram(
    name: string,
    help: string,
    labels: string[] = [],
    buckets: number[] = DEFAULT_BUCKETS_MS,
  ): Histogram {
    const existing = this.metrics.get(name);
    if (existing instanceof Histogram) return existing;
    const h = new Histogram(name, help, labels, buckets);
    this.metrics.set(name, h);
    return h;
  }

  /** Fetch a metric by name. */
  get(name: string): AnyMetric | undefined {
    return this.metrics.get(name);
  }

  /** Fetch a typed counter (undefined if missing or wrong type). */
  getCounter(name: string): Counter | undefined {
    const m = this.metrics.get(name);
    return m instanceof Counter ? m : undefined;
  }

  /** Fetch a typed gauge (undefined if missing or wrong type). */
  getGauge(name: string): Gauge | undefined {
    const m = this.metrics.get(name);
    return m instanceof Gauge ? m : undefined;
  }

  /** Fetch a typed histogram (undefined if missing or wrong type). */
  getHistogram(name: string): Histogram | undefined {
    const m = this.metrics.get(name);
    return m instanceof Histogram ? m : undefined;
  }

  /** All registered metrics. */
  all(): AnyMetric[] {
    return [...this.metrics.values()];
  }

  /** Metric names. */
  names(): string[] {
    return [...this.metrics.keys()];
  }

  /** True if a metric with `name` is registered. */
  has(name: string): boolean {
    return this.metrics.has(name);
  }

  /**
   * Prometheus text exposition format. Counters/gauges render one line per
   * label set; histograms render `_bucket{le=…}`, `_sum`, and `_count` lines
   * per label set.
   */
  expose(): string {
    const lines: string[] = [];
    for (const m of this.metrics.values()) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.type}`);
      if (m instanceof Counter || m instanceof Gauge) {
        const entries = m.all();
        if (entries.length === 0) {
          lines.push(`${m.name} 0`);
        } else {
          for (const e of entries) {
            lines.push(`${m.name}${renderLabels(e.labels)} ${e.value}`);
          }
        }
      } else if (m instanceof Histogram) {
        const snaps = m.snapshots();
        if (snaps.length === 0) {
          for (const le of m.buckets) {
            lines.push(`${m.name}_bucket{le="${le}"} 0`);
          }
          lines.push(`${m.name}_bucket{le="+Inf"} 0`);
          lines.push(`${m.name}_sum 0`);
          lines.push(`${m.name}_count 0`);
        } else {
          for (const s of snaps) {
            for (const b of s.buckets) {
              const leStr = b.le === Infinity ? '+Inf' : String(b.le);
              lines.push(`${m.name}_bucket${renderLabels(s.labels, { le: leStr })} ${b.count}`);
            }
            lines.push(`${m.name}_sum${renderLabels(s.labels)} ${s.sum}`);
            lines.push(`${m.name}_count${renderLabels(s.labels)} ${s.count}`);
          }
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  /** JSON snapshot of every metric. */
  json(): Record<string, MetricJsonSnapshot> {
    const out: Record<string, MetricJsonSnapshot> = {};
    for (const m of this.metrics.values()) {
      if (m instanceof Counter || m instanceof Gauge) {
        out[m.name] = {
          name: m.name,
          help: m.help,
          type: m.type,
          labels: m.labels,
          entries: m.all(),
          total: m.total(),
        };
      } else if (m instanceof Histogram) {
        out[m.name] = {
          name: m.name,
          help: m.help,
          type: m.type,
          labels: m.labels,
          histogram: m.snapshots(),
          count: m.count(),
          sum: m.sum(),
          avg: m.avg(),
          p50: m.percentile(0.5),
          p95: m.percentile(0.95),
          p99: m.percentile(0.99),
        };
      }
    }
    return out;
  }

  /** Reset every metric (testing only). */
  reset(): void {
    for (const m of this.metrics.values()) {
      m.reset();
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-registered operational metrics + singleton
// ---------------------------------------------------------------------------

/** Metric names used across the ops module. */
export const METRIC_NAMES = {
  paymentsTotal: 'payswap_payments_total',
  payoutsTotal: 'payswap_payouts_total',
  settlementDurationMs: 'payswap_settlement_duration_ms',
  connectorRequestsTotal: 'payswap_connector_requests_total',
  twinTokensSupply: 'payswap_twin_tokens_supply',
  ledgerPostedTotal: 'payswap_ledger_posted_total',
  eventsPersistedTotal: 'payswap_events_persisted_total',
  treasuryReserveRatio: 'payswap_treasury_reserve_ratio',
} as const;

/** Build a registry with the PaySwap operational metric set pre-registered. */
function createDefaultRegistry(): MetricsRegistry {
  const r = new MetricsRegistry();
  r.registerCounter(METRIC_NAMES.paymentsTotal, 'Total payments processed, by status.', ['status']);
  r.registerCounter(METRIC_NAMES.payoutsTotal, 'Total payouts initiated, by state.', ['state']);
  r.registerHistogram(
    METRIC_NAMES.settlementDurationMs,
    'Settlement duration in milliseconds.',
    ['corridor'],
    DEFAULT_BUCKETS_MS,
  );
  r.registerCounter(
    METRIC_NAMES.connectorRequestsTotal,
    'Total connector requests, by connector and outcome.',
    ['connector', 'status'],
  );
  r.registerGauge(
    METRIC_NAMES.twinTokensSupply,
    'Current Twin Token total supply, by asset code.',
    ['asset'],
  );
  r.registerCounter(METRIC_NAMES.ledgerPostedTotal, 'Total ledger journal entries posted.');
  r.registerCounter(
    METRIC_NAMES.eventsPersistedTotal,
    'Total events persisted to the event store.',
  );
  r.registerGauge(
    METRIC_NAMES.treasuryReserveRatio,
    'Treasury reserve ratio (total reserves / twin token liability).',
  );
  return r;
}

/**
 * Singleton metrics registry, pre-loaded with the operational metric set.
 * Stashed on `globalThis` so Next.js dev module re-instantiation does not
 * create duplicate singletons (same pattern as `eventEngine`).
 */
const _globalForMetrics = globalThis as unknown as {
  __PAYSWAP_METRICS_REGISTRY?: MetricsRegistry;
};
export const metricsRegistry: MetricsRegistry =
  _globalForMetrics.__PAYSWAP_METRICS_REGISTRY ?? createDefaultRegistry();
if (!_globalForMetrics.__PAYSWAP_METRICS_REGISTRY) {
  _globalForMetrics.__PAYSWAP_METRICS_REGISTRY = metricsRegistry;
}
