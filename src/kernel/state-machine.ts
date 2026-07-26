/**
 * State Machine Engine — every object in PaySwap has a lifecycle.
 *
 * Real financial systems don't execute immediately. Everything transitions
 * through states: Created → Validated → Approved → Executing → Waiting →
 * Retrying → Partially Complete → Completed → Settled → Archived.
 *
 * This dramatically simplifies the workflow engine. Instead of ad-hoc
 * workflow definitions, every object simply has a declared state machine.
 * Transitions are validated against allowed edges; invalid transitions are
 * rejected. Every transition is an auditable event.
 *
 * Objects with state machines:
 *   - Execution Plan
 *   - Payment / Transaction
 *   - Insurance Claim
 *   - LP (lifecycle state)
 *   - Treasury Recommendation
 *   - Extension
 *   - Workflow
 */
import { uid } from './support';
import { eventEngine } from './event';
import { EventCatalog } from './events';

export type ObjectKind =
  | 'plan'
  | 'payment'
  | 'insurance_claim'
  | 'lp'
  | 'merchant'
  | 'reserve'
  | 'treasury_recommendation'
  | 'extension'
  | 'workflow';

export type PlanState =
  | 'created'
  | 'validated'
  | 'approved'
  | 'executing'
  | 'waiting'
  | 'retrying'
  | 'partially_complete'
  | 'completed'
  | 'settled'
  | 'failed'
  | 'rolled_back'
  | 'archived';

export type PaymentState = PlanState;

export type InsuranceState =
  | 'filed'
  | 'evidence_required'
  | 'community_review'
  | 'payswap_vote'
  | 'approved'
  | 'denied'
  | 'appealed'
  | 'resolved';

export type LPState = 'invited' | 'pending' | 'active' | 'paused' | 'draining' | 'withdraw_requested' | 'exited' | 'slashed' | 'manual' | 'suspended' | 'inactive';

export type MerchantState = 'created' | 'verified' | 'approved' | 'operating' | 'suspended' | 'closed';

export type ReserveState = 'healthy' | 'low' | 'critical' | 'emergency' | 'recovering';

export type TreasuryRecState = 'proposed' | 'evaluating' | 'approved' | 'executing' | 'completed' | 'rejected';

export type ExtensionState = 'registered' | 'enabled' | 'disabled' | 'suspended';

export type WorkflowState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type AnyState = PlanState | InsuranceState | LPState | MerchantState | ReserveState | TreasuryRecState | ExtensionState | WorkflowState;

export interface StateTransition {
  id: string;
  objectId: string;
  objectKind: ObjectKind;
  from: AnyState;
  to: AnyState;
  ts: number;
  reason: string;
  frame?: number;
}

export interface StateMachineDefinition {
  kind: ObjectKind;
  initial: AnyState;
  terminal: AnyState[];
  edges: { from: AnyState; to: AnyState; trigger?: string }[];
}

/** The canonical state machine definitions for every object kind. */
export const STATE_MACHINES: Record<ObjectKind, StateMachineDefinition> = {
  plan: {
    kind: 'plan',
    initial: 'created',
    terminal: ['settled', 'failed', 'rolled_back', 'archived'],
    edges: [
      { from: 'created', to: 'validated', trigger: 'constitution.passed' },
      { from: 'created', to: 'failed', trigger: 'constitution.violated' },
      { from: 'validated', to: 'approved', trigger: 'policy.passed' },
      { from: 'validated', to: 'failed', trigger: 'policy.blocked' },
      { from: 'approved', to: 'executing', trigger: 'execution.start' },
      { from: 'executing', to: 'waiting', trigger: 'manual_settlement.required' },
      { from: 'executing', to: 'retrying', trigger: 'transient_failure' },
      { from: 'executing', to: 'partially_complete', trigger: 'partial_fill' },
      { from: 'waiting', to: 'executing', trigger: 'confirmation.received' },
      { from: 'retrying', to: 'executing', trigger: 'retry.attempt' },
      { from: 'retrying', to: 'failed', trigger: 'retry.exhausted' },
      { from: 'partially_complete', to: 'executing', trigger: 'continuation' },
      { from: 'executing', to: 'completed', trigger: 'execution.done' },
      { from: 'partially_complete', to: 'completed', trigger: 'execution.done' },
      { from: 'completed', to: 'settled', trigger: 'settlement.confirmed' },
      { from: 'completed', to: 'failed', trigger: 'settlement.failed' },
      { from: 'failed', to: 'rolled_back', trigger: 'rollback' },
      { from: 'settled', to: 'archived', trigger: 'archive' },
      { from: 'failed', to: 'archived', trigger: 'archive' },
    ],
  },
  payment: {
    kind: 'payment',
    initial: 'created',
    terminal: ['settled', 'failed', 'archived'],
    edges: [
      { from: 'created', to: 'validated', trigger: 'validate' },
      { from: 'validated', to: 'approved', trigger: 'approve' },
      { from: 'approved', to: 'executing', trigger: 'execute' },
      { from: 'executing', to: 'completed', trigger: 'complete' },
      { from: 'completed', to: 'settled', trigger: 'settle' },
      { from: 'executing', to: 'failed', trigger: 'fail' },
      { from: 'settled', to: 'archived', trigger: 'archive' },
    ],
  },
  insurance_claim: {
    kind: 'insurance_claim',
    initial: 'filed',
    terminal: ['resolved'],
    edges: [
      { from: 'filed', to: 'evidence_required', trigger: 'evidence.request' },
      { from: 'evidence_required', to: 'community_review', trigger: 'evidence.submitted' },
      { from: 'filed', to: 'community_review', trigger: 'auto_review' },
      { from: 'community_review', to: 'payswap_vote', trigger: 'vote.open' },
      { from: 'payswap_vote', to: 'approved', trigger: 'vote.approve' },
      { from: 'payswap_vote', to: 'denied', trigger: 'vote.deny' },
      { from: 'denied', to: 'appealed', trigger: 'appeal.file' },
      { from: 'appealed', to: 'approved', trigger: 'appeal.uphold' },
      { from: 'appealed', to: 'resolved', trigger: 'appeal.reject' },
      { from: 'approved', to: 'resolved', trigger: 'payout' },
      { from: 'denied', to: 'resolved', trigger: 'close' },
    ],
  },
  lp: {
    kind: 'lp',
    initial: 'invited',
    terminal: ['exited', 'slashed'],
    edges: [
      { from: 'invited', to: 'pending', trigger: 'apply' },
      { from: 'pending', to: 'active', trigger: 'stake' },
      { from: 'active', to: 'paused', trigger: 'pause' },
      { from: 'paused', to: 'active', trigger: 'resume' },
      { from: 'active', to: 'draining', trigger: 'drain' },
      { from: 'draining', to: 'withdraw_requested', trigger: 'request_withdraw' },
      { from: 'withdraw_requested', to: 'exited', trigger: 'withdraw_complete' },
      { from: 'active', to: 'manual', trigger: 'set_manual' },
      { from: 'manual', to: 'active', trigger: 'set_auto' },
      { from: 'active', to: 'suspended', trigger: 'suspend' },
      { from: 'manual', to: 'suspended', trigger: 'suspend' },
      { from: 'suspended', to: 'active', trigger: 'reactivate' },
      { from: 'suspended', to: 'slashed', trigger: 'slash' },
      { from: 'active', to: 'inactive', trigger: 'disconnect' },
      { from: 'inactive', to: 'active', trigger: 'reconnect' },
    ],
  },
  merchant: {
    kind: 'merchant',
    initial: 'created',
    terminal: ['closed'],
    edges: [
      { from: 'created', to: 'verified', trigger: 'verify' },
      { from: 'verified', to: 'approved', trigger: 'approve' },
      { from: 'approved', to: 'operating', trigger: 'activate' },
      { from: 'operating', to: 'suspended', trigger: 'suspend' },
      { from: 'suspended', to: 'operating', trigger: 'reactivate' },
      { from: 'operating', to: 'closed', trigger: 'close' },
      { from: 'suspended', to: 'closed', trigger: 'close' },
    ],
  },
  reserve: {
    kind: 'reserve',
    initial: 'healthy',
    terminal: [],
    edges: [
      { from: 'healthy', to: 'low', trigger: 'drop_below_50%' },
      { from: 'low', to: 'critical', trigger: 'drop_below_25%' },
      { from: 'critical', to: 'emergency', trigger: 'drop_below_threshold' },
      { from: 'emergency', to: 'recovering', trigger: 'replenish_start' },
      { from: 'recovering', to: 'healthy', trigger: 'replenished' },
      { from: 'low', to: 'healthy', trigger: 'replenished' },
      { from: 'critical', to: 'low', trigger: 'partial_replenish' },
    ],
  },
  treasury_recommendation: {
    kind: 'treasury_recommendation',
    initial: 'proposed',
    terminal: ['completed', 'rejected'],
    edges: [
      { from: 'proposed', to: 'evaluating', trigger: 'evaluate' },
      { from: 'evaluating', to: 'approved', trigger: 'approve' },
      { from: 'evaluating', to: 'rejected', trigger: 'reject' },
      { from: 'proposed', to: 'rejected', trigger: 'reject' },
      { from: 'approved', to: 'executing', trigger: 'execute' },
      { from: 'executing', to: 'completed', trigger: 'complete' },
    ],
  },
  extension: {
    kind: 'extension',
    initial: 'registered',
    terminal: [],
    edges: [
      { from: 'registered', to: 'enabled', trigger: 'enable' },
      { from: 'enabled', to: 'disabled', trigger: 'disable' },
      { from: 'disabled', to: 'enabled', trigger: 'enable' },
      { from: 'enabled', to: 'suspended', trigger: 'suspend' },
      { from: 'suspended', to: 'enabled', trigger: 'reactivate' },
    ],
  },
  workflow: {
    kind: 'workflow',
    initial: 'pending',
    terminal: ['completed', 'failed', 'cancelled'],
    edges: [
      { from: 'pending', to: 'running', trigger: 'start' },
      { from: 'running', to: 'paused', trigger: 'pause' },
      { from: 'paused', to: 'running', trigger: 'resume' },
      { from: 'running', to: 'completed', trigger: 'complete' },
      { from: 'running', to: 'failed', trigger: 'fail' },
      { from: 'paused', to: 'cancelled', trigger: 'cancel' },
    ],
  },
};

export class StateMachineEngine {
  private transitions: StateTransition[] = [];
  private objectStates: Map<string, { kind: ObjectKind; state: AnyState }> = new Map();

  /** Register an object with its initial state. */
  register(objectId: string, kind: ObjectKind): AnyState {
    const initial = STATE_MACHINES[kind].initial;
    this.objectStates.set(objectId, { kind, state: initial });
    return initial;
  }

  /** Get the current state of an object. */
  state(objectId: string): AnyState | undefined {
    return this.objectStates.get(objectId)?.state;
  }

  /** Attempt a transition. Returns true if allowed, false if invalid. */
  transition(objectId: string, to: AnyState, reason: string, frame?: number): boolean {
    const obj = this.objectStates.get(objectId);
    if (!obj) return false;
    const def = STATE_MACHINES[obj.kind];
    const allowed = def.edges.some((e) => e.from === obj.state && e.to === to);
    if (!allowed) return false;

    const t: StateTransition = {
      id: uid('st'),
      objectId,
      objectKind: obj.kind,
      from: obj.state,
      to,
      ts: Date.now(),
      reason,
      frame,
    };
    this.transitions.push(t);
    obj.state = to;
    eventEngine.emit('state.transition', { objectId, kind: obj.kind, from: t.from, to, reason, frame }, frame ?? 0);
    return true;
  }

  /** Is this object in a terminal state? */
  isTerminal(objectId: string): boolean {
    const obj = this.objectStates.get(objectId);
    if (!obj) return false;
    return STATE_MACHINES[obj.kind].terminal.includes(obj.state);
  }

  /** All transitions (for the Execution Timeline view). */
  allTransitions(): StateTransition[] {
    return [...this.transitions];
  }

  /** Transitions for a specific object. */
  transitionsFor(objectId: string): StateTransition[] {
    return this.transitions.filter((t) => t.objectId === objectId);
  }

  reset(): void {
    this.transitions = [];
    this.objectStates.clear();
  }
}

export const stateMachine = new StateMachineEngine();

/** Human-readable labels for states. */
export function stateLabel(state: AnyState): string {
  return state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get the allowed next states for an object. */
export function allowedNextStates(objectId: string): AnyState[] {
  const obj = stateMachine['objectStates'].get(objectId);
  if (!obj) return [];
  const def = STATE_MACHINES[obj.kind];
  return def.edges.filter((e) => e.from === obj.state).map((e) => e.to);
}
