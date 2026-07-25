/**
 * PaySwap Protocol — Production Connectors v2 — Health Monitor.
 *
 * Tracks per-connector health: latency, consecutive failures, last error.
 * A connector is "healthy" if its consecutive-failure count is below a
 * threshold (default 3). The monitor also supports a periodic background
 * probe via `startPeriodic()` — pass a checkFn that calls `healthCheck()`
 * on each connector.
 *
 * Health is OBSERVED state — recording a failure here does NOT change any
 * protocol module's state. It only feeds dashboards and routing decisions.
 */
import type { ConnectorError, ConnectorHealth, ConnectorId } from './types';

export interface HealthMonitorOptions {
  /** Consecutive failures at/below which a connector is considered healthy. */
  failureThreshold?: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;

export class HealthMonitor {
  private health: Map<ConnectorId, ConnectorHealth> = new Map();
  private readonly failureThreshold: number;

  constructor(opts: HealthMonitorOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  }

  /** Record a successful call. Resets consecutiveFailures to 0. */
  recordSuccess(id: ConnectorId, latencyMs: number): void {
    const prev = this.health.get(id);
    this.health.set(id, {
      id,
      healthy: true,
      latencyMs,
      lastCheckTs: Date.now(),
      consecutiveFailures: 0,
      lastError: prev?.lastError, // keep last error for forensics
    });
  }

  /** Record a failed call. Increments consecutiveFailures. */
  recordFailure(id: ConnectorId, error: ConnectorError): void {
    const prev = this.health.get(id);
    const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;
    this.health.set(id, {
      id,
      healthy: consecutiveFailures < this.failureThreshold,
      latencyMs: prev?.latencyMs ?? 0,
      lastCheckTs: Date.now(),
      consecutiveFailures,
      lastError: `${error.code}: ${error.message}`,
    });
  }

  /** Get the current health snapshot for a connector. */
  getHealth(id: ConnectorId): ConnectorHealth {
    return (
      this.health.get(id) ?? {
        id,
        healthy: true,
        latencyMs: 0,
        lastCheckTs: 0,
        consecutiveFailures: 0,
      }
    );
  }

  /** Boolean health check — uses the recorded healthy flag. */
  isHealthy(id: ConnectorId): boolean {
    return this.getHealth(id).healthy;
  }

  /** All connectors' health snapshots. */
  all(): ConnectorHealth[] {
    return [...this.health.values()];
  }

  /** Reset health for one or all connectors. */
  reset(id?: ConnectorId): void {
    if (id) {
      this.health.delete(id);
    } else {
      this.health.clear();
    }
  }

  /** Get the configured failure threshold (for diagnostics). */
  getFailureThreshold(): number {
    return this.failureThreshold;
  }

  /**
   * Start a periodic background probe. Returns a `stop` function.
   *
   * `checkFn` is invoked every `intervalMs`; it should call `healthCheck()`
   * on each registered connector and `recordSuccess` / `recordFailure`
   * accordingly. The monitor itself only schedules — it does not know which
   * connectors exist.
   */
  startPeriodic(
    checkFn: () => Promise<void>,
    intervalMs: number,
  ): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped) return;
      try {
        await checkFn();
      } catch {
        // Swallow — health probe failures should not crash the runtime.
      }
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
      }
    };
    // Fire immediately, then on interval.
    timer = setTimeout(tick, 0);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

/** Singleton health monitor — shared by all production connectors. */
export const sharedHealthMonitor = new HealthMonitor();
