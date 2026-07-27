/**
 * PaySwap Protocol — Disaster Recovery — Barrel Export.
 *
 * Disaster recovery is **proactive**: backups are scheduled, replication
 * is continuous, chaos tests are periodic, and RPO/RTO is measured. The
 * system is designed to survive region loss with <60s data loss (RPO)
 * and <5min recovery (RTO).
 *
 * PUBLIC CONTRACT (stable, drop-in ready):
 *  - Multi-region replication:  `replicationService.{configureRegion, replicate, getReplicationLag, getReplicationStatus, promoteRegion, getPrimary, attach}`
 *  - Backup management:         `backupService.{createBackup, verifyBackup, restoreFromBackup, getBackup, listBackups, getLatestBackup, scheduleBackups, pruneBackups}`
 *  - Recovery orchestration:    `restoreService.{planRecovery, executeRecovery, verifyRecovery, getRecoveryHistory}`
 *  - RPO/RTO monitor:           `rpoRtoMonitor.{recordEventTime, recordRecoveryStart, recordRecoveryEnd, measure, isCompliant, getHistory, attach}`
 *  - Chaos testing:             `chaosTestService.{injectFailure, runScenario, getResults, scheduleChaosTests, runAllScenarios}`
 *  - Disaster simulation:       `disasterSimulationService.{simulateDisaster, getSimulationResults, generateReport}`
 *  - Failover:                  `failoverService.{initiateFailover, completeFailover, getFailoverStatus, getFailoverHistory, autoFailover}`
 *  - DR status:                 `drStatusService.{getStatus, isHealthy, getActiveIncidents, declareIncident, resolveIncident}`
 *
 * WIRING (one-time, in the application bootstrap):
 *   ```ts
 *   import {
 *     replicationService, rpoRtoMonitor,
 *   } from '@/protocol/disaster-recovery';
 *
 *   // Auto-replicate every kernel event to all secondaries.
 *   replicationService.attach();
 *   // Auto-record every kernel event's ts for RPO measurement.
 *   rpoRtoMonitor.attach();
 *   // Schedule periodic event-store backups (every 5 minutes).
 *   backupService.scheduleBackups(5 * 60 * 1000, 'event_store');
 *   // Schedule periodic chaos tests (every 6 hours).
 *   chaosTestService.scheduleChaosTests(6 * 60 * 60 * 1000);
 *   ```
 *
 * Events emitted on the kernel `eventEngine` (all prefixed `dr.`):
 *  - `dr.event_replicated`, `dr.region_promoted`
 *  - `dr.backup_created`, `dr.backup_verified`, `dr.backup_restored`, `dr.backup_pruned`
 *  - `dr.recovery_planned`, `dr.recovery_started`, `dr.recovery_step`, `dr.recovery_completed`, `dr.recovery_verified`
 *  - `dr.rpo_rto_measured`, `dr.rpo_rto_violation`
 *  - `dr.chaos_test_started`, `dr.chaos_test_completed`, `dr.chaos_failure_injected`, `dr.chaos_failure_recovered`
 *  - `dr.disaster_simulated`, `dr.disaster_simulation_completed`
 *  - `dr.failover_initiated`, `dr.failover_completed`, `dr.failover_failed`
 *  - `dr.incident_declared`, `dr.incident_resolved`
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs`,
 * `round` from `@/kernel/support`, `eventEngine` from `@/kernel/event`,
 * and the protocol-layer `ledgerEngine` from `@/protocol/ledger/engine`
 * (matching `src/protocol/ops/dashboards.ts`'s pattern). No kernel
 * files are modified.
 */
export * from './types';

export {
  ReplicationService,
  replicationService,
  newReplicationId,
} from './replication';

export {
  BackupService,
  backupService,
  type BackupListFilter,
  type RestoreResult,
} from './backup';

export {
  RestoreService,
  restoreService,
  type RecoveryScenario,
  type RecoveryStepResult,
  type RecoveryExecutionResult,
  type RecoveryHistoryEntry,
} from './restore';

export {
  RPORtoMonitor,
  rpoRtoMonitor,
} from './rpo-rto';

export {
  ChaosTestService,
  chaosTestService,
  DEFAULT_CHAOS_SCENARIOS,
} from './chaos-testing';

export {
  DisasterSimulationService,
  disasterSimulationService,
} from './disaster-simulation';

export {
  FailoverService,
  failoverService,
  type HealthCheckFn,
} from './failover';

export {
  DRStatusService,
  drStatusService,
} from './dr-status';
