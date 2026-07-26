/**
 * PaySwap Protocol — Production Connectors v2 — Health Monitor.
 *
 * Tracks per-connector health based on the success/failure of recent
 * queries. A connector is considered healthy while `consecutiveFailures`
 * stays below the threshold (default 3). The registry exposes this to
 * the planner so it can prefer healthy rails during routing.
 *
 * Health is a *runtime* concept: even a "production" connector can be
 * briefly unhealthy during an upstream outage. The monitor never turns
 * a connector off permanently — three successes in a row flip it back
 * to healthy.
 */
import type { ConnectorError, ConnectorHealth, ConnectorId } from './types';

/** Default failure threshold. Configurable per-monitor. */
export const DEFAULT_FAILURE_THRESHOLD = 3;

interface HealthState {
  id: ConnectorId;
  healthy: boolean;
  latencyMs: number;
  lastCheckTs: number;
  consecutiveFailures: number;
}

export class HealthMonitor {
  private states = new Map<ConnectorId, HealthState>();
  private readonly failureThreshold: number;

  constructor(failureThreshold: number = DEFAULT_FAILURE_THRESHOLD) {
    this.failureThreshold = failureThreshold;
  }

  private ensure(id: ConnectorId): HealthState {
    let s = this.states.get(id);
    if (!s) {
      s = {
        id,
        healthy: true,
        latencyMs: 0,
        lastCheckTs: 0,
        consecutiveFailures: 0,
      };
      this.states.set(id, s);
    }
    return s;
  }

  /** Record a successful query — resets the failure counter. */
  recordSuccess(id: ConnectorId, latencyMs: number): void {
    const s = this.ensure(id);
    s.consecutiveFailures = 0;
    s.healthy = true;
    s.latencyMs = latencyMs;
    s.lastCheckTs = Date.now();
  }

  /** Record a failed query — increments the failure counter, may flip to unhealthy. */
  recordFailure(id: ConnectorId, _error: ConnectorError): void {
    const s = this.ensure(id);
    s.consecutiveFailures += 1;
    s.lastCheckTs = Date.now();
    if (s.consecutiveFailures >= this.failureThreshold) {
      s.healthy = false;
    }
  }

  /** Snapshot of one connector's health. */
  getHealth(id: ConnectorId): ConnectorHealth {
    const s = this.ensure(id);
    return {
      id: s.id,
      healthy: s.healthy,
      latencyMs: s.latencyMs,
      lastCheckTs: s.lastCheckTs,
      consecutiveFailures: s.consecutiveFailures,
    };
  }

  /** True if the connector is currently considered healthy. */
  isHealthy(id: ConnectorId): boolean {
    return this.ensure(id).healthy;
  }

  /** Health for every connector seen so far. */
  all(): ConnectorHealth[] {
    // Ensure all known ids appear even if never queried.
    return [...this.states.values()].map((s) => ({
      id: s.id,
      healthy: s.healthy,
      latencyMs: s.latencyMs,
      lastCheckTs: s.lastCheckTs,
      consecutiveFailures: s.consecutiveFailures,
    }));
  }

  /** Reset all health state (e.g. between simulation runs). */
  reset(): void {
    this.states.clear();
  }
}
