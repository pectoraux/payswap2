/**
 * PaySwap Protocol — Resilience — Health Check.
 *
 * Aggregates the state of every registered circuit breaker with a set of
 * basic system checks (memory, event-loop lag, event stream depth) into a
 * single `HealthStatus` snapshot. Each component is wrapped in try/catch
 * so a single failing probe cannot poison the whole report.
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/event`
 * and `@/kernel/support`, plus the local circuit-breaker registry.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';
import { circuitBreakerRegistry } from './circuit-breaker';
import type { CircuitState } from './circuit-breaker';

/** Overall health status for the resilience layer. */
export type OverallHealth = 'healthy' | 'degraded' | 'unhealthy';

/** Health of a single component probe. */
export interface ComponentHealth {
  /** Component name (e.g. `circuit_breakers`, `event_stream`, `memory`). */
  name: string;
  /** True if the probe succeeded with no warning conditions. */
  healthy: boolean;
  /** Optional details (counts, ratios, error messages). */
  details?: Record<string, unknown>;
}

/** Per-circuit state surfaced in the overall status. */
export interface CircuitHealthSummary {
  name: string;
  state: CircuitState;
}

/** Aggregated health snapshot returned by `healthCheck()`. */
export interface HealthStatus {
  /** Roll-up of component health. */
  overall: OverallHealth;
  /** Per-probe health. */
  components: ComponentHealth[];
  /** Snapshot of every circuit breaker state. */
  circuits: CircuitHealthSummary[];
  /** ts the check was taken. */
  lastCheckTs: number;
}

/** Thresholds for the system-level probes. */
export interface HealthCheckThresholds {
  /** Fraction of free memory below which the memory probe is unhealthy. */
  minFreeMemoryRatio: number;
  /** Max event-stream depth before the probe reports degraded. */
  maxEventStreamDepth: number;
  /** If any circuit is OPEN, the overall status is at least `degraded`. */
  reportOpenCircuitAs: OverallHealth;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthCheckThresholds = {
  minFreeMemoryRatio: 0.1,
  maxEventStreamDepth: 10_000,
  reportOpenCircuitAs: 'degraded',
};

/** Probe the memory usage of the Node.js process. Defensive. */
function probeMemory(thresholds: HealthCheckThresholds): ComponentHealth {
  try {
    const mem = process.memoryUsage();
    const rss = mem.rss;
    const heapUsed = mem.heapUsed;
    const heapTotal = mem.heapTotal;
    const heapFree = heapTotal > 0 ? heapTotal - heapUsed : 0;
    const freeRatio = heapTotal > 0 ? heapFree / heapTotal : 1;
    return {
      name: 'memory',
      healthy: freeRatio >= thresholds.minFreeMemoryRatio,
      details: {
        rssBytes: rss,
        heapUsedBytes: heapUsed,
        heapTotalBytes: heapTotal,
        heapFreeRatio: Number(freeRatio.toFixed(4)),
      },
    };
  } catch (err) {
    return {
      name: 'memory',
      healthy: false,
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** Probe the event stream depth (very large streams slow down replay). */
function probeEventStream(thresholds: HealthCheckThresholds): ComponentHealth {
  try {
    const events = eventEngine.read();
    const depth = events.length;
    return {
      name: 'event_stream',
      healthy: depth <= thresholds.maxEventStreamDepth,
      details: { depth, threshold: thresholds.maxEventStreamDepth },
    };
  } catch (err) {
    return {
      name: 'event_stream',
      healthy: false,
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** Probe the process uptime as a liveness signal. Defensive. */
function probeUptime(): ComponentHealth {
  try {
    const uptimeSec = process.uptime();
    return {
      name: 'process_uptime',
      healthy: true,
      details: { uptimeSec: Number(uptimeSec.toFixed(2)) },
    };
  } catch (err) {
    return {
      name: 'process_uptime',
      healthy: false,
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** Probe the circuit-breaker registry. Returns the per-circuit summary. */
function probeCircuits(): {
  component: ComponentHealth;
  circuits: CircuitHealthSummary[];
} {
  try {
    const states = circuitBreakerRegistry.states();
    const open = states.filter((s) => s.state === 'open');
    const halfOpen = states.filter((s) => s.state === 'half_open');
    return {
      component: {
        name: 'circuit_breakers',
        healthy: open.length === 0,
        details: {
          total: states.length,
          open: open.length,
          halfOpen: halfOpen.length,
          closed: states.length - open.length - halfOpen.length,
        },
      },
      circuits: states.map((s) => ({ name: s.name, state: s.state })),
    };
  } catch (err) {
    return {
      component: {
        name: 'circuit_breakers',
        healthy: false,
        details: {
          error: err instanceof Error ? err.message : String(err),
        },
      },
      circuits: [],
    };
  }
}

/**
 * Run a full health check across the resilience layer.
 *
 * Each probe runs in its own try/catch so a single failure cannot mask the
 * others. The overall status is the most severe of:
 *   - any component reporting unhealthy → at least `degraded`,
 *   - any circuit breaker OPEN → at least `degraded`,
 *   - otherwise `healthy`.
 *
 * If a component throws catastrophically (e.g. the registry is missing),
 * the overall status is `unhealthy`.
 */
export function healthCheck(
  thresholds: HealthCheckThresholds = DEFAULT_HEALTH_THRESHOLDS,
): HealthStatus {
  const components: ComponentHealth[] = [];
  const circuits: CircuitHealthSummary[] = [];

  try {
    components.push(probeMemory(thresholds));
  } catch (err) {
    components.push({
      name: 'memory',
      healthy: false,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    components.push(probeEventStream(thresholds));
  } catch (err) {
    components.push({
      name: 'event_stream',
      healthy: false,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    components.push(probeUptime());
  } catch (err) {
    components.push({
      name: 'process_uptime',
      healthy: false,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    const circuitProbe = probeCircuits();
    components.push(circuitProbe.component);
    circuits.push(...circuitProbe.circuits);
  } catch (err) {
    components.push({
      name: 'circuit_breakers',
      healthy: false,
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  // Roll up the overall status.
  let overall: OverallHealth = 'healthy';
  for (const c of components) {
    if (!c.healthy) {
      overall = overall === 'unhealthy' ? 'unhealthy' : 'degraded';
    }
  }
  const openCircuits = circuits.filter((c) => c.state === 'open').length;
  if (openCircuits > 0) {
    const target = thresholds.reportOpenCircuitAs;
    overall =
      target === 'unhealthy' ? 'unhealthy'
      : target === 'degraded' ? (overall === 'unhealthy' ? 'unhealthy' : 'degraded')
      : overall;
  }

  return {
    overall,
    components,
    circuits,
    lastCheckTs: nowTs(),
  };
}
