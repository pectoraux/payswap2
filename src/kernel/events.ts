/**
 * Named Event Catalog — event sourcing for the Financial Operating System.
 *
 * Everything emits events. Never mutate silently. This catalog defines the
 * canonical event types so consumers (replay engine, audit, dashboards,
 * extensions) can subscribe to a stable vocabulary.
 *
 * Events are the kernel's single source of truth for "what happened". The
 * ledger is the source of truth for "what is the balance". Together they
 * make every state transition fully reconstructable.
 */
export const EventCatalog = {
  // Plan lifecycle
  PlanCreated: 'plan.created',
  PlanValidated: 'plan.validated',
  PlanApproved: 'plan.approved',
  PlanRejected: 'plan.rejected',
  PlanAmended: 'plan.amended',

  // Execution
  ExecutionStarted: 'execution.started',
  ExecutionCompleted: 'execution.completed',
  ExecutionRolledBack: 'execution.rolled_back',

  // Ledger
  ReserveDebited: 'reserve.debited',
  ReserveCredited: 'reserve.credited',
  LedgerPosted: 'ledger.posted',

  // Liquidity
  LPSelected: 'lp.selected',
  LPDrawn: 'lp.drawn',
  LPExhausted: 'lp.exhausted',
  LPDisappeared: 'lp.disappeared',

  // Twin tokens
  TwinMinted: 'twin.minted',
  TwinTransferred: 'twin.transferred',
  TwinBurned: 'twin.burned',

  // Treasury
  TreasuryDrawn: 'treasury.drawn',
  TreasuryRecommendation: 'treasury.recommendation',
  TreasuryRebalanced: 'treasury.rebalanced',

  // FX
  FXConverted: 'fx.converted',
  FXSpiked: 'fx.spiked',

  // Manual settlement
  ManualSettlementStarted: 'manual_settlement.started',
  ManualSettlementConfirmed: 'manual_settlement.confirmed',

  // Insurance
  InsuranceOpened: 'insurance.opened',
  InsuranceResolved: 'insurance.resolved',
  ClaimFiled: 'claim.filed',
  ClaimResolved: 'claim.resolved',

  // Constitution
  ConstitutionChecked: 'constitution.checked',
  ConstitutionViolated: 'constitution.violated',

  // Replay
  ReplayStarted: 'replay.started',
  ReplayFinished: 'replay.finished',

  // Failures
  FailureInjected: 'failure.injected',
  FailureRecovered: 'failure.recovered',

  // LP lifecycle
  LPMinted: 'lp.minted',
  LPStaked: 'lp.staked',
  LPWithdrawn: 'lp.withdrawn',
  LPRestaked: 'lp.restaked',
  LPSuspended: 'lp.suspended',
  LPReactivated: 'lp.reactivated',

  // Workflows
  WorkflowStarted: 'workflow.started',
  WorkflowStepCompleted: 'workflow.step.completed',
  WorkflowCompleted: 'workflow.completed',
} as const;

export type EventName = (typeof EventCatalog)[keyof typeof EventCatalog];

/** Human-readable labels for event types. */
export const EVENT_LABELS: Record<string, string> = {
  'plan.created': 'Plan Created',
  'plan.validated': 'Plan Validated',
  'plan.approved': 'Plan Approved',
  'plan.rejected': 'Plan Rejected',
  'plan.amended': 'Plan Amended',
  'execution.started': 'Execution Started',
  'execution.completed': 'Execution Completed',
  'execution.rolled_back': 'Execution Rolled Back',
  'reserve.debited': 'Reserve Debited',
  'reserve.credited': 'Reserve Credited',
  'ledger.posted': 'Ledger Posted',
  'lp.selected': 'LP Selected',
  'lp.drawn': 'LP Drawn',
  'lp.exhausted': 'LP Exhausted',
  'lp.disappeared': 'LP Disappeared',
  'twin.minted': 'Twin Token Minted',
  'twin.transferred': 'Twin Token Transferred',
  'twin.burned': 'Twin Token Burned',
  'treasury.drawn': 'Treasury Drawn',
  'treasury.recommendation': 'Treasury Recommendation',
  'treasury.rebalanced': 'Treasury Rebalanced',
  'fx.converted': 'FX Converted',
  'fx.spiked': 'FX Spiked',
  'manual_settlement.started': 'Manual Settlement Started',
  'manual_settlement.confirmed': 'Manual Settlement Confirmed',
  'insurance.opened': 'Insurance Opened',
  'insurance.resolved': 'Insurance Resolved',
  'claim.filed': 'Claim Filed',
  'claim.resolved': 'Claim Resolved',
  'constitution.checked': 'Constitution Checked',
  'constitution.violated': 'Constitution Violated',
  'replay.started': 'Replay Started',
  'replay.finished': 'Replay Finished',
  'failure.injected': 'Failure Injected',
  'failure.recovered': 'Failure Recovered',
  'lp.minted': 'LP Minted',
  'lp.staked': 'LP Staked',
  'lp.withdrawn': 'LP Withdrawn',
  'lp.restaked': 'LP Restaked',
  'lp.suspended': 'LP Suspended',
  'lp.reactivated': 'LP Reactivated',
  'workflow.started': 'Workflow Started',
  'workflow.step.completed': 'Workflow Step Completed',
  'workflow.completed': 'Workflow Completed',
  'reserve.mutated': 'Reserve Mutated',
  'transaction.initiated': 'Transaction Initiated',
  'transaction.transition': 'Transaction Transition',
  'workflow.begun': 'Workflow Begun',
  'workflow.step.complete': 'Workflow Step Complete',
  'workflow.step.failed': 'Workflow Step Failed',
  'workflow.finished': 'Workflow Finished',
  'insurance.filed': 'Insurance Filed',
  'extension.registered': 'Extension Registered',
  'permission.check': 'Permission Check',
};
