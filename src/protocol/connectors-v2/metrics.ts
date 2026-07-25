/**
 * PaySwap Protocol — Production Connectors v2 — Metrics Collector.
 *
 * Per-connector counters + a sliding-window latency reservoir (last 1000
 * samples) for avg / p50 / p99. All counters are non-blocking writes —
 * safe to call from the hot path of every connector request.
 *
 * The metrics snapshot returned by `get(id)` is a serializable POJO — it can
 * be exposed directly via /api/infrastructure or scraped by Prometheus-bridge.
 */
import type { ConnectorId, ConnectorMetrics } from './types';

const WINDOW_SIZE = 1000;

interface ConnectorState {
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  requestsRetried: number;
  requestsRateLimited: number;
  latencySamples: number[]; // ring buffer
  latencyIndex: number; // next write slot
  latencyCount: number; // total samples written (capped at WINDOW_SIZE for stats)
  latencySum: number; // running sum of all samples ever
  latencyTotalCount: number; // total samples ever (for avg over full history)
  lastRequestTs: number;
}

function newState(): ConnectorState {
  return {
    requestsTotal: 0,
    requestsSuccess: 0,
    requestsFailed: 0,
    requestsRetried: 0,
    requestsRateLimited: 0,
    latencySamples: new Array(WINDOW_SIZE).fill(0),
    latencyIndex: 0,
    latencyCount: 0,
    latencySum: 0,
    latencyTotalCount: 0,
    lastRequestTs: 0,
  };
}

export class MetricsCollector {
  private state: Map<ConnectorId, ConnectorState> = new Map();

  private ensure(id: ConnectorId): ConnectorState {
    let s = this.state.get(id);
    if (!s) {
      s = newState();
      this.state.set(id, s);
    }
    return s;
  }

  /**
   * Record a single request outcome.
   *   - latencyMs: wall-clock latency of the entire request (including retries).
   *   - success: whether the final response was a success.
   *   - retried: whether more than one attempt was made.
   *   - rateLimited: whether the request was short-circuited by the local rate limiter.
   */
  recordRequest(
    id: ConnectorId,
    latencyMs: number,
    success: boolean,
    retried: boolean,
    rateLimited: boolean,
  ): void {
    const s = this.ensure(id);
    s.requestsTotal += 1;
    if (success) s.requestsSuccess += 1;
    else s.requestsFailed += 1;
    if (retried) s.requestsRetried += 1;
    if (rateLimited) s.requestsRateLimited += 1;

    // Ring-buffer insert.
    s.latencySamples[s.latencyIndex] = latencyMs;
    s.latencyIndex = (s.latencyIndex + 1) % WINDOW_SIZE;
    if (s.latencyCount < WINDOW_SIZE) s.latencyCount += 1;

    // Full-history running average.
    s.latencySum += latencyMs;
    s.latencyTotalCount += 1;
    s.lastRequestTs = Date.now();
  }

  /** Snapshot of metrics for a connector. */
  get(id: ConnectorId): ConnectorMetrics {
    const s = this.ensure(id);
    const samples = s.latencySamples.slice(0, s.latencyCount).sort((a, b) => a - b);
    return {
      id,
      requestsTotal: s.requestsTotal,
      requestsSuccess: s.requestsSuccess,
      requestsFailed: s.requestsFailed,
      requestsRetried: s.requestsRetried,
      requestsRateLimited: s.requestsRateLimited,
      avgLatencyMs: s.latencyTotalCount > 0
        ? Math.round(s.latencySum / s.latencyTotalCount)
        : 0,
      p50LatencyMs: percentile(samples, 0.5),
      p99LatencyMs: percentile(samples, 0.99),
      lastRequestTs: s.lastRequestTs,
    };
  }

  /** All connectors' metric snapshots. */
  all(): ConnectorMetrics[] {
    const ids = [...this.state.keys()];
    // Include any id that has ever been recorded; if none, return empty.
    return ids.map((id) => this.get(id));
  }

  /** Reset one or all connectors' metrics. */
  reset(id?: ConnectorId): void {
    if (id) {
      this.state.delete(id);
    } else {
      this.state.clear();
    }
  }
}

/** Singleton metrics collector — shared by all production connectors. */
export const sharedMetricsCollector = new MetricsCollector();

/**
 * Compute a percentile from a SORTED (ascending) array of samples.
 * Uses the "nearest rank" method: index = ceil(p * n) - 1, clamped.
 * Returns 0 for empty input.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil(clamped * sortedAsc.length) - 1),
  );
  return Math.round(sortedAsc[idx]);
}
