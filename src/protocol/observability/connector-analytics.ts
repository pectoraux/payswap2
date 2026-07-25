/**
 * PaySwap Protocol — Observability — Connector Analytics.
 *
 * Aggregates per-connector request telemetry into:
 *   - uptime (success / total) over a time range
 *   - average latency + p95 latency over a time range
 *   - throughput (requests/sec) over a time range
 *   - error rate over a time range
 *   - cross-connector comparison (uptime / latency / throughput / error-rate)
 *
 * Non-invasive:
 *   - `recordRequest(connectorId, success, latencyMs)` accepts the simplest
 *     possible call shape so the protocol layer can invoke it inline.
 *   - `subscribe(eventBus?)` wires the service to `trace.span` events emitted
 *     by the observability tracing module when a span named `connector.query`
 *     ends, so connectors traced via `tracer.withSpan('connector.query', ...)`
 *     are auto-ingested without any change to business logic.
 *
 * The kernel is FROZEN — this module imports only `round`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { round, nowTs } from '@/kernel/support';
import { eventEngine, type EventEngine } from '@/kernel/event';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeRange {
  from: number;
  to: number;
}

export interface ConnectorRequest {
  connectorId: string;
  success: boolean;
  latencyMs: number;
  ts: number;
  error?: string;
}

export interface ConnectorStats {
  connectorId: string;
  totalRequests: number;
  successCount: number;
  failedCount: number;
  uptime: number; // %
  errorRate: number; // %
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughputRps: number; // requests per second over `range`
  lastRequestTs: number;
}

export interface ConnectorComparison {
  connectors: ConnectorStats[];
  totals: {
    count: number;
    totalRequests: number;
    avgUptime: number;
    avgLatencyMs: number;
    avgErrorRate: number;
  };
}

export interface ConnectorTimeSeriesPoint {
  ts: number;
  requests: number;
  success: number;
  failed: number;
  avgLatencyMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECOND_MS = 1_000;

function inRange(ts: number, range: TimeRange): boolean {
  return ts >= range.from && ts <= range.to;
}

function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.max(1, Math.ceil(clamped * n));
  return sorted[Math.min(rank - 1, n - 1)];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ConnectorAnalyticsService {
  private requests: ConnectorRequest[] = [];
  private readonly maxRecords: number;
  private unsubscribe?: () => void;

  constructor(maxRecords = 200_000) {
    this.maxRecords = maxRecords;
  }

  /** Record a connector request outcome. */
  recordRequest(connectorId: string, success: boolean, latencyMs: number, ts: number = nowTs()): void {
    this.requests.push({ connectorId, success, latencyMs, ts });
    if (this.requests.length > this.maxRecords) {
      this.requests = this.requests.slice(-this.maxRecords);
    }
  }

  /** Convenience overload — record a fully-shaped `ConnectorRequest`. */
  record(req: ConnectorRequest): void {
    this.requests.push(req);
    if (this.requests.length > this.maxRecords) {
      this.requests = this.requests.slice(-this.maxRecords);
    }
  }

  /** Uptime (%) for a connector over `range`. */
  getUptime(connectorId: string, range: TimeRange): number {
    const all = this.requests.filter(
      (r) => r.connectorId === connectorId && inRange(r.ts, range),
    );
    if (all.length === 0) return 0;
    const ok = all.filter((r) => r.success).length;
    return round((ok / all.length) * 100, 4);
  }

  /** Average latency (ms) for a connector over `range`. */
  getLatency(connectorId: string, range: TimeRange): number {
    const all = this.requests.filter(
      (r) => r.connectorId === connectorId && inRange(r.ts, range),
    );
    if (all.length === 0) return 0;
    return round(all.reduce((s, r) => s + r.latencyMs, 0) / all.length, 2);
  }

  /** p95 latency (ms) for a connector over `range`. */
  getP95Latency(connectorId: string, range: TimeRange): number {
    const all = this.requests
      .filter((r) => r.connectorId === connectorId && inRange(r.ts, range))
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
    return percentile(all, 0.95);
  }

  /** Throughput (requests per second) for a connector over `range`. */
  getThroughput(connectorId: string, range: TimeRange): number {
    const all = this.requests.filter(
      (r) => r.connectorId === connectorId && inRange(r.ts, range),
    );
    const durationSec = Math.max(1, (range.to - range.from) / SECOND_MS);
    return round(all.length / durationSec, 4);
  }

  /** Error rate (%) for a connector over `range`. */
  getErrorRate(connectorId: string, range: TimeRange): number {
    const all = this.requests.filter(
      (r) => r.connectorId === connectorId && inRange(r.ts, range),
    );
    if (all.length === 0) return 0;
    const failed = all.filter((r) => !r.success).length;
    return round((failed / all.length) * 100, 4);
  }

  /** Full stats for a single connector. */
  getStats(connectorId: string, range: TimeRange): ConnectorStats {
    const all = this.requests.filter(
      (r) => r.connectorId === connectorId && inRange(r.ts, range),
    );
    const total = all.length;
    const success = all.filter((r) => r.success).length;
    const failed = total - success;
    const latencies = all.map((r) => r.latencyMs).sort((a, b) => a - b);
    const durationSec = Math.max(1, (range.to - range.from) / SECOND_MS);
    const lastTs = total > 0 ? all[all.length - 1].ts : 0;
    return {
      connectorId,
      totalRequests: total,
      successCount: success,
      failedCount: failed,
      uptime: total > 0 ? round((success / total) * 100, 4) : 0,
      errorRate: total > 0 ? round((failed / total) * 100, 4) : 0,
      avgLatencyMs:
        total > 0 ? round(all.reduce((s, r) => s + r.latencyMs, 0) / total, 2) : 0,
      p95LatencyMs: percentile(latencies, 0.95),
      p99LatencyMs: percentile(latencies, 0.99),
      throughputRps: round(total / durationSec, 4),
      lastRequestTs: lastTs,
    };
  }

  /** All known connector IDs. */
  getConnectorIds(): string[] {
    const set = new Set<string>();
    for (const r of this.requests) set.add(r.connectorId);
    return [...set].sort();
  }

  /** Side-by-side comparison of every connector. */
  getConnectorComparison(range: TimeRange): ConnectorComparison {
    const ids = this.getConnectorIds();
    const connectors = ids.map((id) => this.getStats(id, range));
    const totalRequests = connectors.reduce((s, c) => s + c.totalRequests, 0);
    const avgUptime =
      connectors.length > 0
        ? round(connectors.reduce((s, c) => s + c.uptime, 0) / connectors.length, 4)
        : 0;
    const avgLatency =
      connectors.length > 0
        ? round(connectors.reduce((s, c) => s + c.avgLatencyMs, 0) / connectors.length, 2)
        : 0;
    const avgErrorRate =
      connectors.length > 0
        ? round(connectors.reduce((s, c) => s + c.errorRate, 0) / connectors.length, 4)
        : 0;
    return {
      connectors: connectors.sort((a, b) => b.totalRequests - a.totalRequests),
      totals: {
        count: connectors.length,
        totalRequests,
        avgUptime,
        avgLatencyMs: avgLatency,
        avgErrorRate,
      },
    };
  }

  /** Per-connector time-series (bucket = 1 min). */
  getTimeSeries(connectorId: string, range: TimeRange, bucketMs = 60_000): ConnectorTimeSeriesPoint[] {
    const buckets = new Map<
      number,
      { requests: number; success: number; failed: number; latencySum: number }
    >();
    for (const r of this.requests) {
      if (r.connectorId !== connectorId) continue;
      if (!inRange(r.ts, range)) continue;
      const bucket = Math.floor(r.ts / bucketMs) * bucketMs;
      const e = buckets.get(bucket) ?? { requests: 0, success: 0, failed: 0, latencySum: 0 };
      e.requests += 1;
      if (r.success) e.success += 1;
      else e.failed += 1;
      e.latencySum += r.latencyMs;
      buckets.set(bucket, e);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, v]) => ({
        ts,
        requests: v.requests,
        success: v.success,
        failed: v.failed,
        avgLatencyMs: v.requests > 0 ? round(v.latencySum / v.requests, 2) : 0,
      }));
  }

  /**
   * Subscribe to `trace.span` events emitted by the observability tracing
   * module. Spans named `connector.query` are auto-ingested as connector
   * requests (success = status 'ok', latency = durationMs). The connector ID
   * is read from `attributes.connectorId` (falls back to `attributes.connector`).
   */
  subscribe(eventBus: EventEngine = eventEngine): () => void {
    const handler = (event: { type: string; payload: Record<string, unknown>; ts: number }) => {
      try {
        if (event.type !== 'trace.span') return;
        const p = event.payload as {
          name?: string;
          status?: string;
          durationMs?: number;
          attributes?: Record<string, unknown>;
        };
        if (p.name !== 'connector.query') return;
        const attrs = p.attributes ?? {};
        const connectorId =
          (attrs.connectorId as string | undefined) ??
          (attrs.connector as string | undefined) ??
          'unknown';
        this.recordRequest(
          connectorId,
          p.status !== 'error',
          p.durationMs ?? 0,
          event.ts,
        );
      } catch {
        // non-invasive
      }
    };
    const off = eventBus.on('trace.', handler);
    this.unsubscribe = off;
    return off;
  }

  /** Stop any active subscription. */
  unsubscribeAll(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /** Reset (testing only). */
  reset(): void {
    this.requests = [];
  }

  /** Snapshot count. */
  stats(): { requests: number; connectors: number } {
    return { requests: this.requests.length, connectors: this.getConnectorIds().length };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForConnector = globalThis as unknown as {
  __PAYSWAP_CONNECTOR_ANALYTICS?: ConnectorAnalyticsService;
};

export const connectorAnalytics: ConnectorAnalyticsService =
  _globalForConnector.__PAYSWAP_CONNECTOR_ANALYTICS ?? new ConnectorAnalyticsService();
if (!_globalForConnector.__PAYSWAP_CONNECTOR_ANALYTICS) {
  _globalForConnector.__PAYSWAP_CONNECTOR_ANALYTICS = connectorAnalytics;
}

export type { EventEngine };
