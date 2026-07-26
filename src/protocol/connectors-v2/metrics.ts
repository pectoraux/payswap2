/**
 * PaySwap Protocol — Production Connectors v2 — Metrics Collector.
 *
 * Lightweight per-connector counters: total/success/failed request counts
 * plus a rolling average latency. The registry surfaces these as a single
 * `metricsReport()` for dashboards and SLA tracking.
 *
 * Average latency is computed incrementally using a running mean so we
 * don't need to retain per-request samples.
 */
import type { ConnectorId, ConnectorMetrics } from './types';

interface MetricsState {
  id: ConnectorId;
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  /** Running mean — updated incrementally. */
  avgLatencyMs: number;
  lastRequestTs: number;
}

export class MetricsCollector {
  private states = new Map<ConnectorId, MetricsState>();

  private ensure(id: ConnectorId): MetricsState {
    let s = this.states.get(id);
    if (!s) {
      s = {
        id,
        requestsTotal: 0,
        requestsSuccess: 0,
        requestsFailed: 0,
        avgLatencyMs: 0,
        lastRequestTs: 0,
      };
      this.states.set(id, s);
    }
    return s;
  }

  /** Record a single request outcome. */
  recordRequest(id: ConnectorId, latencyMs: number, success: boolean): void {
    const s = this.ensure(id);
    s.requestsTotal += 1;
    if (success) s.requestsSuccess += 1;
    else s.requestsFailed += 1;
    // Incremental mean: avg = avg + (sample - avg) / n
    s.avgLatencyMs = s.avgLatencyMs + (latencyMs - s.avgLatencyMs) / s.requestsTotal;
    s.lastRequestTs = Date.now();
  }

  /** Snapshot of one connector's metrics. */
  get(id: ConnectorId): ConnectorMetrics {
    const s = this.ensure(id);
    return {
      id: s.id,
      requestsTotal: s.requestsTotal,
      requestsSuccess: s.requestsSuccess,
      requestsFailed: s.requestsFailed,
      avgLatencyMs: Math.round(s.avgLatencyMs * 100) / 100,
      lastRequestTs: s.lastRequestTs,
    };
  }

  /** Metrics for every connector seen so far. */
  all(): ConnectorMetrics[] {
    return [...this.states.values()].map((s) => ({
      id: s.id,
      requestsTotal: s.requestsTotal,
      requestsSuccess: s.requestsSuccess,
      requestsFailed: s.requestsFailed,
      avgLatencyMs: Math.round(s.avgLatencyMs * 100) / 100,
      lastRequestTs: s.lastRequestTs,
    }));
  }

  /** Reset all metrics (e.g. between simulation runs). */
  reset(): void {
    this.states.clear();
  }
}
