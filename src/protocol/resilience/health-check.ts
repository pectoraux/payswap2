/**
 * PaySwap Protocol — Resilience / Comprehensive Health Check.
 * -----------------------------------------------------------------------------
 * Aggregates the state of every resilience subsystem into a single
 * `HealthStatus` snapshot. Used by:
 *
 *   - The `/api/protocol/health` route (returns the JSON to ops dashboards)
 *   - The ops `systemOverview` dashboard
 *   - The kubernetes liveness/readiness probes
 *
 * Health is computed SYNCHRONOUSLY from in-memory state — no network calls,
 * no DB queries. This ensures the health check itself cannot become a
 * bottleneck or fail because of an outage.
 *
 * The overall status is:
 *   - healthy   → all components healthy, no active outages, no open circuits,
 *                 DLQ empty.
 *   - degraded  → at least one component unhealthy OR an outage active OR a
 *                 circuit open OR DLQ has entries.
 *   - unhealthy → multiple components unhealthy OR a `full` outage active.
 */
import { circuitBreakerRegistry, type CircuitBreakerMetrics } from './circuit-breaker';
import { outageManager, type Outage } from './outage-handler';
import { deadLetterQueue } from './dead-letter';
import { partialSettlementRecovery } from './partial-settlement';
import { sharedHealthMonitor } from '@/protocol/connectors-v2/health';
import { ledgerEngine } from '@/protocol/ledger';

/** A single component's health. */
export interface ComponentHealth {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  details?: string;
}

/** Overall health snapshot. */
export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentHealth[];
  outages: Outage[];
  circuits: Array<{ name: string; state: string }>;
  dlqDepth: number;
  partialSettlementsPending: number;
  lastCheckTs: number;
}

/**
 * Compute the current health status.
 *
 * Aggregates:
 *   - Circuit breaker states (from circuitBreakerRegistry)
 *   - Connector health (from connectors-v2 sharedHealthMonitor — best-effort,
 *     defensive if unavailable)
 *   - Active outages (from outageManager)
 *   - DLQ depth (warning if > 0)
 *   - Partial settlements pending recovery
 *   - Ledger integrity (from ledgerEngine.verifyIntegrity — best-effort,
 *     defensive if ledger is unavailable)
 */
export function healthCheck(): HealthStatus {
  const components: ComponentHealth[] = [];
  const lastCheckTs = Date.now();

  // 1. Circuit breakers.
  const circuitMetrics: CircuitBreakerMetrics[] = circuitBreakerRegistry.metricsAll();
  const circuits = circuitMetrics.map((m) => ({ name: m.name, state: m.state }));
  for (const m of circuitMetrics) {
    components.push({
      name: `circuit:${m.name}`,
      healthy: m.state !== 'open',
      details: `state=${m.state}, failures=${m.windowFailureCount}, trips=${m.trips}`,
    });
  }

  // 2. Connectors-v2 health (defensive — skip if no connectors registered yet).
  try {
    const all = sharedHealthMonitor.all();
    for (const h of all) {
      components.push({
        name: `connector:${h.id}`,
        healthy: h.healthy,
        latencyMs: h.latencyMs,
        details: `consecutiveFailures=${h.consecutiveFailures}${h.lastError ? `, lastError=${h.lastError}` : ''}`,
      });
    }
  } catch {
    // Connectors-v2 not available — skip silently.
  }

  // 3. Active outages.
  const outages = outageManager.active();

  // 4. DLQ depth.
  const dlqDepth = deadLetterQueue.depth('pending_review');
  components.push({
    name: 'dlq',
    healthy: dlqDepth === 0,
    details: dlqDepth === 0 ? 'empty' : `${dlqDepth} entries pending review`,
  });

  // 5. Partial settlements pending recovery.
  const partials = partialSettlementRecovery.list({ state: 'partial' });
  const recovering = partialSettlementRecovery.list({ state: 'recovering' });
  const partialSettlementsPending = partials.length + recovering.length;
  components.push({
    name: 'partial_settlements',
    healthy: partials.length === 0,
    details:
      partials.length === 0 && recovering.length === 0
        ? 'none'
        : `${partials.length} partial, ${recovering.length} recovering`,
  });

  // 6. Ledger integrity (defensive).
  try {
    const integrity = ledgerEngine.verifyIntegrity();
    components.push({
      name: 'ledger:integrity',
      healthy: integrity.balanced,
      details: `balanced=${integrity.balanced}, discrepancy=${integrity.discrepancy}, debits=${integrity.totalDebits}, credits=${integrity.totalCredits}`,
    });
  } catch {
    // Ledger not available — skip silently.
  }

  // Compute overall status.
  const unhealthyCount = components.filter((c) => !c.healthy).length;
  const fullOutageCount = outages.filter((o) => o.severity === 'full').length;

  let overall: HealthStatus['overall'];
  if (fullOutageCount > 0 || unhealthyCount >= 3) {
    overall = 'unhealthy';
  } else if (unhealthyCount > 0 || outages.length > 0 || dlqDepth > 0 || partialSettlementsPending > 0) {
    overall = 'degraded';
  } else {
    overall = 'healthy';
  }

  return {
    overall,
    components,
    outages,
    circuits,
    dlqDepth,
    partialSettlementsPending,
    lastCheckTs,
  };
}

/**
 * Lightweight ping — returns true iff the overall health is `healthy` or
 * `degraded` (i.e. not `unhealthy`). Used for kubernetes readiness probes.
 */
export function ping(): boolean {
  const status = healthCheck();
  return status.overall !== 'unhealthy';
}

/**
 * Liveness check — always returns true unless the process can't compute
 * health (in which case it throws). Used for kubernetes liveness probes.
 */
export function liveness(): boolean {
  healthCheck();
  return true;
}
