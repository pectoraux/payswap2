/**
 * Operations OS — Type definitions (M-OPS-42)
 *
 * These types describe the operational surface of the PaySwap runtime:
 * incidents, runbooks, on-call rotations, maintenance windows, investigations,
 * treasury operations, settlement operations and migrations.
 *
 * The Incident/IncidentUpdate types map to the existing Prisma models
 * (`Incident`, `IncidentUpdate`). The other domains are kept in-memory
 * (single-process Node runtime) per the M-OPS-42 spec — operations tooling
 * that does not need durable cross-process persistence in v1.
 */

// ═══════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Incident severity. Mirrors the existing Prisma `Incident.severity`
 * (P1–P4) but uses the SEV* notation requested by the M-OPS-42 spec.
 * SEV1 = critical (system down), SEV2 = major (feature broken),
 * SEV3 = minor, SEV4 = cosmetic.
 */
export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

/**
 * Lifecycle of an incident. `postmortem` is a terminal state — the incident
 * is resolved but a written postmortem is being authored.
 */
export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved'
  | 'postmortem';

export interface OpsIncident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  /** E.g. "runtime", "treasury", "settlement", "marketplace", "connectors". */
  component: string;
  createdBy: string;
  assignedTo?: string;
  acknowledgedAt?: number;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;
  updates: IncidentUpdate[];
  affectedMerchants: string[];
  rootCause?: string;
  remediation?: string;
}

export interface IncidentUpdate {
  id: string;
  incidentId: string;
  authorId: string;
  message: string;
  status?: IncidentStatus;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNBOOKS
// ═══════════════════════════════════════════════════════════════════════════

export interface Runbook {
  id: string;
  name: string;
  description: string;
  category:
    | 'incident'
    | 'treasury'
    | 'settlement'
    | 'maintenance'
    | 'migration'
    | 'security';
  steps: RunbookStep[];
  /** Human-readable hint for when to use this runbook. */
  trigger: string;
  owner: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface RunbookStep {
  order: number;
  title: string;
  description: string;
  /** Optional CLI command for the operator to run. */
  command?: string;
  expectedOutput?: string;
  /** How to verify the step worked. */
  validationCheck?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ON-CALL
// ═══════════════════════════════════════════════════════════════════════════

export interface OnCallSchedule {
  id: string;
  userId: string;
  userName: string;
  role: 'primary' | 'secondary' | 'manager';
  startAt: number;
  endAt: number;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAINTENANCE WINDOWS
// ═══════════════════════════════════════════════════════════════════════════

export interface MaintenanceWindow {
  id: string;
  title: string;
  description: string;
  component: string;
  startAt: number;
  endAt: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  impact: 'none' | 'minor' | 'major' | 'outage';
  createdBy: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVESTIGATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface OpsInvestigation {
  id: string;
  /** Optional link to an OpsIncident. */
  incidentId?: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'concluded';
  findings: string;
  assignedTo: string;
  createdAt: number;
  concludedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TREASURY OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface TreasuryOperation {
  id: string;
  type:
    | 'reserve_adjustment'
    | 'rebalance'
    | 'withdrawal'
    | 'deposit'
    | 'fx_hedge';
  country: string;
  currency: string;
  amount: number;
  status: 'pending' | 'approved' | 'executed' | 'failed' | 'reversed';
  requestedBy: string;
  approvedBy?: string;
  executedAt?: number;
  rationale: string;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SETTLEMENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface SettlementOperation {
  id: string;
  type:
    | 'manual_settlement'
    | 'retry_failed'
    | 'force_complete'
    | 'reverse'
    | 'reconcile';
  transactionId: string;
  status: 'pending' | 'approved' | 'executed' | 'failed';
  requestedBy: string;
  approvedBy?: string;
  rationale: string;
  createdAt: number;
  executedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface Migration {
  id: string;
  name: string;
  description: string;
  type: 'schema' | 'data' | 'code' | 'config';
  status: 'planned' | 'in_progress' | 'completed' | 'rolled_back' | 'failed';
  version: string;
  rollbackPlan: string;
  startedAt?: number;
  completedAt?: number;
  startedBy: string;
  steps: MigrationStep[];
}

export interface MigrationStep {
  order: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregated snapshot returned by `GET /api/ops/overview` for the Ops
 * dashboard. Combines the active incidents, current on-call roster,
 * upcoming maintenance windows, and pending treasury/settlement operations
 * into a single response so the dashboard can render in one round-trip.
 */
export interface OpsOverview {
  activeIncidents: OpsIncident[];
  incidentStats: {
    total: number;
    open: number;
    bySeverity: Record<string, number>;
    avgResolutionTimeMs: number;
  };
  onCallRoster: {
    primary?: OnCallSchedule;
    secondary?: OnCallSchedule;
    manager?: OnCallSchedule;
  };
  upcomingMaintenance: MaintenanceWindow[];
  activeMaintenance?: MaintenanceWindow;
  pendingTreasuryOps: TreasuryOperation[];
  pendingSettlementOps: SettlementOperation[];
  failedSettlements: SettlementOperation[];
  activeMigrations: Migration[];
  plannedMigrations: Migration[];
  openInvestigations: OpsInvestigation[];
  ts: number;
}
