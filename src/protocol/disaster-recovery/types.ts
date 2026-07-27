/**
 * PaySwap Protocol — Disaster Recovery — Types.
 *
 * Disaster recovery is **proactive**: backups are scheduled, replication
 * is continuous, chaos tests are periodic, and RPO/RTO is measured. The
 * system is designed to survive region loss with <60s data loss (RPO)
 * and <5min recovery (RTO).
 *
 * This module declares the canonical types shared across the DR layer:
 *  - `Region`               — the four active-active regions PaySwap
 *                             runs in (US East, EU West, AP Southeast,
 *                             AF South).
 *  - `ReplicationLag`       — per-secondary replication lag (ms + last
 *                             sync ts).
 *  - `BackupRecord`         — a single backup (event-store / ledger
 *                             snapshot / full state) with SHA-256
 *                             checksum, location, region, and optional
 *                             verification result.
 *  - `RestorePlan`          — a recovery plan (strategy + steps +
 *                             estimated recovery time + RPO/RTO targets
 *                             + data loss risk).
 *  - `RPO_RTO_Measurement`  — measured RPO + RTO + targets + compliance.
 *  - `ChaosTestResult`      — chaos test outcome (injected failure +
 *                             impact + detection + recovery time +
 *                             pass/fail).
 *  - `DRStatus`             — the aggregate DR status snapshot (overall
 *                             health, regions, replication lag, last
 *                             backup, RPO/RTO, incidents).
 *
 * Design notes:
 *  - All identifiers are opaque strings.
 *  - Timestamps are epoch milliseconds (`Date.now()`).
 *  - All sizes are in bytes.
 *  - Status / state unions are string-literal types so the audit trail
 *    is self-describing.
 *
 * The kernel is FROZEN — this module imports nothing from the kernel.
 * It is pure type declarations + constants.
 */

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * The four active-active regions PaySwap runs in.
 *
 *  - `us-east-1`      — US East (N. Virginia)   — primary by default.
 *  - `eu-west-1`      — EU West (Ireland)       — secondary (GDPR zone).
 *  - `ap-southeast-1` — AP Southeast (Singapore) — secondary.
 *  - `af-south-1`     — Africa (Cape Town)      — secondary (low-latency
 *                                                 for African corridors).
 */
export type Region = 'us-east-1' | 'eu-west-1' | 'ap-southeast-1' | 'af-south-1';

/** All configured regions (insertion order = failover priority). */
export const ALL_REGIONS: Region[] = [
  'us-east-1',
  'eu-west-1',
  'ap-southeast-1',
  'af-south-1',
];

/** Default primary region at cold-start. */
export const DEFAULT_PRIMARY_REGION: Region = 'us-east-1';

// ---------------------------------------------------------------------------
// Replication
// ---------------------------------------------------------------------------

/**
 * Per-secondary replication lag.
 *
 *  - `sourceRegion`  — the region events are replicated FROM (the primary).
 *  - `targetRegion`  — the region events are replicated TO (a secondary).
 *  - `lagMs`         — how far behind the target is, in ms. 0 = fully
 *                      caught up.
 *  - `lastSyncTs`    — the most recent ts at which the target
 *                      acknowledged a replicated event.
 */
export interface ReplicationLag {
  sourceRegion: Region;
  targetRegion: Region;
  lagMs: number;
  lastSyncTs: number;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

/** The kind of artefact a backup captures. */
export type BackupType = 'event_store' | 'ledger_snapshot' | 'full_state';

/** The result of verifying a backup (re-computing its checksum). */
export type BackupVerifyResult = 'verified' | 'mismatch' | 'missing' | 'error';

/**
 * A single backup record.
 *
 *  - `id`           — opaque backup id.
 *  - `type`         — what kind of artefact was backed up.
 *  - `size`         — size in bytes.
 *  - `createdAt`    — ts the backup was taken.
 *  - `checksum`     — SHA-256 hex digest of the backup payload.
 *  - `location`     — a logical location string (e.g.
 *                     `s3://payswap-backups/us-east-1/event_store/evt_abc`).
 *  - `region`       — the region the backup is stored in.
 *  - `verifiedAt`   — ts the backup was last verified, or null.
 *  - `verifyResult` — outcome of the last verification, or null.
 */
export interface BackupRecord {
  id: string;
  type: BackupType;
  size: number;
  createdAt: number;
  checksum: string;
  location: string;
  region: Region;
  verifiedAt?: number | null;
  verifyResult?: BackupVerifyResult | null;
}

// ---------------------------------------------------------------------------
// Restore plans
// ---------------------------------------------------------------------------

/**
 * The recovery strategy a `RestorePlan` uses.
 *
 *  - `event_replay`    — replay the event store from the last snapshot
 *                        forward (fast, used when only the live state is
 *                        lost but the event log is intact).
 *  - `snapshot_replay` — load the most recent ledger snapshot then
 *                        replay events forward (used when state is
 *                        corrupted but a recent snapshot exists).
 *  - `cold_restore`    — full restore from a cold backup (event store +
 *                        ledger snapshot + full state). Used after total
 *                        region loss or ransomware.
 */
export type RestoreStrategy = 'event_replay' | 'snapshot_replay' | 'cold_restore';

/**
 * A recovery plan.
 *
 *  - `strategy`              — the high-level approach.
 *  - `steps`                 — ordered, human-readable steps.
 *  - `estimatedRecoveryMs`   — best-effort wall-clock recovery estimate.
 *  - `dataLossRisk`          — a 0..1 estimate of how much data is at
 *                              risk (0 = none, 1 = catastrophic).
 *  - `rpoMs`                 — target RPO for this plan (max data loss
 *                              in ms).
 *  - `rtoMs`                 — target RTO for this plan (max recovery
 *                              time in ms).
 */
export interface RestorePlan {
  strategy: RestoreStrategy;
  steps: string[];
  estimatedRecoveryMs: number;
  dataLossRisk: number;
  rpoMs: number;
  rtoMs: number;
}

// ---------------------------------------------------------------------------
// RPO / RTO
// ---------------------------------------------------------------------------

/**
 * A measured RPO + RTO point.
 *
 *  - `rpoMs`      — measured Recovery Point Objective = `now - latestEventTs`
 *                   (how much data we would lose if we failed over now).
 *  - `rtoMs`      — measured Recovery Time Objective = `recoveryEnd - recoveryStart`
 *                   (how long the last recovery actually took).
 *  - `measuredAt` — ts the measurement was taken.
 *  - `targetRpo`  — the target RPO (default 60_000ms = 1 min).
 *  - `targetRto`  — the target RTO (default 300_000ms = 5 min).
 *  - `compliant`  — true iff `rpoMs <= targetRpo && rtoMs <= targetRto`.
 */
export interface RPO_RTO_Measurement {
  rpoMs: number;
  rtoMs: number;
  measuredAt: number;
  targetRpo: number;
  targetRto: number;
  compliant: boolean;
}

/** Default targets (RPO 60s, RTO 5min). */
export const DEFAULT_TARGET_RPO_MS = 60_000;
export const DEFAULT_TARGET_RTO_MS = 300_000;

// ---------------------------------------------------------------------------
// Chaos testing
// ---------------------------------------------------------------------------

/** The kind of failure a chaos test injects. */
export type ChaosFailureType =
  | 'connector_outage'
  | 'db_disconnect'
  | 'region_loss'
  | 'network_partition'
  | 'high_latency';

/** A chaos test scenario definition. */
export interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  failureType: ChaosFailureType;
  target: string;
  /** Expected detection time (ms) — used for pass/fail grading. */
  expectedDetectionMs: number;
  /** Expected recovery time (ms) — used for pass/fail grading. */
  expectedRecoveryMs: number;
}

/**
 * The result of running a chaos scenario.
 *
 *  - `id`           — opaque result id.
 *  - `scenario`     — the scenario id that was run.
 *  - `target`       — the component / region the failure was injected into.
 *  - `injected`     — ts the failure was injected.
 *  - `impact`       — observed impact description.
 *  - `detected`     — true if the failure was detected before recovery.
 *  - `recovered`    — true if the system recovered within `expectedRecoveryMs`.
 *  - `durationMs`   — total scenario duration (inject → recover).
 *  - `passed`       — true iff detected + recovered within expectations.
 */
export interface ChaosTestResult {
  id: string;
  scenario: string;
  target: string;
  injected: number;
  impact: string;
  detected: boolean;
  recovered: boolean;
  durationMs: number;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Disaster simulation
// ---------------------------------------------------------------------------

/** The kind of disaster a simulation runs. */
export type DisasterType = 'data_center_loss' | 'ransomware' | 'corruption' | 'human_error';

/** The result of a full disaster simulation run. */
export interface DisasterSimulationResult {
  id: string;
  disasterType: DisasterType;
  startedAt: number;
  completedAt: number;
  /** Total recovery time (ms). */
  recoveryTimeMs: number;
  /** Estimated data loss (ms — equivalent to RPO). */
  dataLossMs: number;
  /** The restore plan that was executed. */
  plan: RestorePlan;
  /** Post-recovery verification outcome. */
  verification: RecoveryVerification;
  /** Overall pass/fail. */
  passed: boolean;
  /** Human-readable summary. */
  summary: string;
}

/** Post-recovery verification outcome. */
export interface RecoveryVerification {
  verified: boolean;
  ledgerBalancesMatch: boolean;
  eventCountMatch: boolean;
  reconciliationPassed: boolean;
  discrepancies: string[];
  checkedAt: number;
}

// ---------------------------------------------------------------------------
// Failover
// ---------------------------------------------------------------------------

/** The status of a failover operation. */
export type FailoverStatus = 'initiated' | 'in_progress' | 'completed' | 'failed' | 'aborted';

/** A failover record. */
export interface FailoverRecord {
  id: string;
  fromRegion: Region;
  toRegion: Region;
  reason: string;
  status: FailoverStatus;
  initiatedAt: number;
  completedAt?: number | null;
  /** True if the failover was triggered automatically. */
  automatic: boolean;
  /** Post-failover verification notes (e.g. DNS propagation, health checks). */
  notes: string[];
}

// ---------------------------------------------------------------------------
// DR status / incidents
// ---------------------------------------------------------------------------

/** Overall DR layer health. */
export type DRHealth = 'operational' | 'degraded' | 'recovering' | 'failed';

/** The severity of a DR incident. */
export type IncidentSeverity = 'info' | 'warning' | 'critical' | 'severe';

/** A DR incident. */
export interface DRIncident {
  id: string;
  description: string;
  severity: IncidentSeverity;
  declaredAt: number;
  resolvedAt?: number | null;
  /** Optional region the incident is scoped to. */
  region?: Region | null;
  /** Optional free-form metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * The aggregate DR status snapshot returned by `DRStatusService.getStatus()`.
 *
 *  - `overall`           — roll-up of replication health + backup age +
 *                          RPO/RTO compliance + active incidents.
 *  - `regions`           — all configured regions.
 *  - `primaryRegion`     — the current primary.
 *  - `replicationLag`    — per-secondary lag.
 *  - `lastBackup`        — the most recent backup, or null.
 *  - `rpoRto`            — the latest RPO/RTO measurement.
 *  - `activeIncidents`   — unresolved DR incidents.
 */
export interface DRStatus {
  overall: DRHealth;
  regions: Region[];
  primaryRegion: Region;
  replicationLag: ReplicationLag[];
  lastBackup: BackupRecord | null;
  rpoRto: RPO_RTO_Measurement;
  activeIncidents: DRIncident[];
}
