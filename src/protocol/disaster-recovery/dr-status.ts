/**
 * PaySwap Protocol — Disaster Recovery — DR Status Aggregator.
 *
 * The DR status service is the single roll-up point for the entire DR
 * layer. It aggregates:
 *   - the configured regions + current primary (from `replicationService`),
 *   - the per-secondary replication lag,
 *   - the most recent backup (from `backupService`),
 *   - the latest RPO/RTO measurement (from `rpoRtoMonitor`),
 *   - active DR incidents (declared via `declareIncident`).
 *
 * `getStatus()` returns the canonical `DRStatus` snapshot.
 * `isHealthy()` is the boolean roll-up: `true` iff
 *   - overall status is `operational`,
 *   - no `critical` / `severe` active incidents,
 *   - RPO/RTO is compliant,
 *   - the most recent backup is less than 1 hour old.
 *
 * Incidents declared here are the DR layer's operational incidents
 * (separate from kernel resilience alerts). They are time-stamped,
 * severity-tagged, and can be resolved via `resolveIncident()`.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `dr.incident_declared`   — when an incident is declared.
 *  - `dr.incident_resolved`   — when an incident is resolved.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and the
 * sibling `replicationService`, `backupService`, `rpoRtoMonitor`. No
 * kernel files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';
import type {
  DRHealth,
  DRIncident,
  DRStatus,
  IncidentSeverity,
  RPO_RTO_Measurement,
  Region,
} from './types';
import { DEFAULT_TARGET_RPO_MS, DEFAULT_TARGET_RTO_MS } from './types';
import { replicationService } from './replication';
import { backupService } from './backup';
import { rpoRtoMonitor } from './rpo-rto';

/** A backup is considered "fresh" if it is less than this many ms old. */
const FRESH_BACKUP_MS = 60 * 60 * 1000; // 1 hour

/** Replication lag is considered "healthy" if it is under this many ms. */
const HEALTHY_LAG_MS = 5_000; // 5 seconds

/**
 * DR status service — the single roll-up point for the DR layer.
 */
export class DRStatusService {
  private incidents: DRIncident[] = [];
  private readonly maxIncidentHistory = 500;

  // --------------------------------------------------------------- status

  /**
   * Returns the canonical `DRStatus` snapshot. Aggregates:
   *   - regions + primary from `replicationService`,
   *   - replication lag from `replicationService`,
   *   - last backup from `backupService`,
   *   - RPO/RTO from `rpoRtoMonitor` (a fresh measurement is taken if
   *     no measurement has been recorded yet),
   *   - active incidents (declared here).
   */
  getStatus(): DRStatus {
    const regions = replicationService.getRegions();
    const primaryRegion = replicationService.getPrimary() ?? regions[0] ?? 'us-east-1';
    const replicationLag = replicationService.getReplicationStatus();
    const lastBackup = backupService.getLatestBackup() ?? null;
    const rpoRto = this.getRpoRto();
    const activeIncidents = this.getActiveIncidents();
    const overall = this.computeOverallHealth(replicationLag, lastBackup, rpoRto, activeIncidents);
    return {
      overall,
      regions,
      primaryRegion,
      replicationLag,
      lastBackup,
      rpoRto,
      activeIncidents,
    };
  }

  /** Get the latest RPO/RTO measurement, taking a fresh one if needed. */
  private getRpoRto(): RPO_RTO_Measurement {
    const latest = rpoRtoMonitor.getLatest();
    if (latest) return latest;
    return rpoRtoMonitor.measure();
  }

  /**
   * Compute the overall DR health from the constituent signals.
   *
   *  - `failed`     — there are `severe` active incidents.
   *  - `recovering` — there are `critical` active incidents, OR a
   *                   failover is in progress (we approximate by
   *                   checking for active `critical` incidents).
   *  - `degraded`   — RPO/RTO is non-compliant, OR replication lag is
   *                   above the healthy threshold, OR the last backup
   *                   is stale (>1h old), OR there are `warning`
   *                   active incidents.
   *  - `operational` — otherwise.
   */
  private computeOverallHealth(
    replicationLag: Array<{ lagMs: number }>,
    lastBackup: { createdAt: number } | null,
    rpoRto: RPO_RTO_Measurement,
    activeIncidents: DRIncident[],
  ): DRHealth {
    // Severe incidents → failed.
    if (activeIncidents.some((i) => i.severity === 'severe')) {
      return 'failed';
    }
    // Critical incidents → recovering.
    if (activeIncidents.some((i) => i.severity === 'critical')) {
      return 'recovering';
    }
    // RPO/RTO non-compliant → degraded.
    if (!rpoRto.compliant) {
      return 'degraded';
    }
    // Replication lag above threshold → degraded.
    if (replicationLag.some((l) => l.lagMs > HEALTHY_LAG_MS)) {
      return 'degraded';
    }
    // Stale or missing backup → degraded.
    const now = nowTs();
    if (!lastBackup || now - lastBackup.createdAt > FRESH_BACKUP_MS) {
      return 'degraded';
    }
    // Warning incidents → degraded.
    if (activeIncidents.some((i) => i.severity === 'warning')) {
      return 'degraded';
    }
    return 'operational';
  }

  /**
   * Boolean health check — `true` iff the overall status is
   * `operational`.
   */
  isHealthy(): boolean {
    return this.getStatus().overall === 'operational';
  }

  // --------------------------------------------------------------- incidents

  /**
   * Declare a DR incident. Returns the new `DRIncident`.
   */
  declareIncident(
    description: string,
    severity: IncidentSeverity,
    region?: Region,
  ): DRIncident {
    const incident: DRIncident = {
      id: uid('inc'),
      description,
      severity,
      declaredAt: nowTs(),
      resolvedAt: null,
      region: region ?? null,
      metadata: {},
    };
    this.incidents.push(incident);
    this.trimIncidents();
    eventEngine.emit('dr.incident_declared', {
      incidentId: incident.id,
      description,
      severity,
      region: incident.region,
      ts: incident.declaredAt,
    });
    return incident;
  }

  /**
   * Resolve a DR incident. Returns the resolved incident, or null if
   * the id is unknown or already resolved.
   */
  resolveIncident(incidentId: string): DRIncident | null {
    const incident = this.incidents.find((i) => i.id === incidentId);
    if (!incident) return null;
    if (incident.resolvedAt !== null) return incident;
    incident.resolvedAt = nowTs();
    eventEngine.emit('dr.incident_resolved', {
      incidentId: incident.id,
      ts: incident.resolvedAt,
    });
    return incident;
  }

  /** All incidents (resolved + active), oldest first. */
  getAllIncidents(): DRIncident[] {
    return [...this.incidents];
  }

  /** Active (unresolved) incidents, oldest first. */
  getActiveIncidents(): DRIncident[] {
    return this.incidents.filter((i) => i.resolvedAt === null);
  }

  /** Get a single incident by id. */
  getIncident(id: string): DRIncident | null {
    return this.incidents.find((i) => i.id === id) ?? null;
  }

  /** Trim incident history to the configured max. */
  private trimIncidents(): void {
    while (this.incidents.length > this.maxIncidentHistory) {
      this.incidents.shift();
    }
  }

  /** Reset all incidents (used in tests). */
  reset(): void {
    this.incidents.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_DR_STATUS: DRStatusService | undefined;
}

/** Singleton DR status service. */
export const drStatusService: DRStatusService =
  globalThis.__PAYSWAP_DR_STATUS ?? new DRStatusService();

if (!globalThis.__PAYSWAP_DR_STATUS) {
  globalThis.__PAYSWAP_DR_STATUS = drStatusService;
}

/** Re-export the default RPO/RTO targets for callers. */
export { DEFAULT_TARGET_RPO_MS, DEFAULT_TARGET_RTO_MS };
