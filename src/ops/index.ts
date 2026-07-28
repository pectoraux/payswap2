/**
 * Operations OS — barrel + factory (M-OPS-42)
 *
 * Exports all types, the individual manager singletons, and an `opsEngine`
 * facade that bundles them into a single object for convenience.
 */

export * from './types';

export { incidentManager } from './incident-manager';
export type {
  NewIncidentInput,
  IncidentListFilter,
  IncidentStats,
} from './incident-manager';

export { runbookManager } from './runbook-manager';
export type { NewRunbookInput, RunbookListFilter } from './runbook-manager';

export { onCallManager } from './oncall-manager';
export type {
  OnCallRole,
  AssignOnCallInput,
} from './oncall-manager';

export { maintenanceManager } from './maintenance-manager';
export type {
  NewMaintenanceInput,
  MaintenanceListFilter,
} from './maintenance-manager';

export { investigationManager } from './investigation-manager';
export type {
  NewInvestigationInput,
  InvestigationListFilter,
} from './investigation-manager';

export { treasuryOps } from './treasury-ops';
export type {
  NewTreasuryOpInput,
  TreasuryOpListFilter,
} from './treasury-ops';

export { settlementOps } from './settlement-ops';
export type {
  NewSettlementOpInput,
  SettlementOpListFilter,
} from './settlement-ops';

export { migrationManager } from './migration-manager';
export type { NewMigrationInput, MigrationListFilter } from './migration-manager';

import { incidentManager } from './incident-manager';
import { runbookManager } from './runbook-manager';
import { onCallManager } from './oncall-manager';
import { maintenanceManager } from './maintenance-manager';
import { investigationManager } from './investigation-manager';
import { treasuryOps } from './treasury-ops';
import { settlementOps } from './settlement-ops';
import { migrationManager } from './migration-manager';

/**
 * `opsEngine` — facade that bundles every Operations OS manager.
 *
 * Usage:
 *   import { opsEngine } from '@/ops';
 *   await opsEngine.incidents.create({...});
 *   await opsEngine.treasury.getPending();
 */
export const opsEngine = {
  incidents: incidentManager,
  runbooks: runbookManager,
  onCall: onCallManager,
  maintenance: maintenanceManager,
  investigations: investigationManager,
  treasury: treasuryOps,
  settlement: settlementOps,
  migrations: migrationManager,
} as const;

export type OpsEngine = typeof opsEngine;
