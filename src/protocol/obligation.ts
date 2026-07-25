/**
 * PaySwap Runtime — Obligation Primitive.
 *
 * The one missing primitive. The protocol is fundamentally an obligation
 * network. The world is not converging balances — it's converging outstanding
 * obligations until none remain.
 *
 *   Entity owes Entity → Obligation
 *   Obligation is resolved by Transition
 *   When all obligations are resolved, the world has converged.
 *
 * Examples:
 *   - LP owes merchant fiat
 *   - Merchant owes confirmation
 *   - Escrow owes token release
 *   - Treasury owes reserve rebalance
 *   - Governance owes dispute resolution
 *
 * Obligations make the runtime generic — they exist in finance, supply chains,
 * logistics, and many other domains. Any system that converges outstanding
 * obligations can be modeled with this runtime.
 */
import { uid } from '@/kernel/support';
import type { EvidenceCitation } from '@/kernel/evidence';

export type ObligationType =
  | 'deliver'      // generic: deliver something to someone
  | 'confirm'      // generic: confirm receipt/acknowledgment
  | 'authorize'    // generic: authorize an action
  | 'verify'       // generic: verify a claim or state
  | 'transfer'     // generic: transfer ownership/rights
  | 'approve'      // generic: approve a request
  | 'release'      // generic: release a held resource
  | 'submit'       // generic: submit evidence/proof
  | 'resolve'      // generic: resolve a dispute
  | 'rebalance'    // generic: rebalance state
  | 'custom';      // domain-specific (PaySwap types live in protocol layer)

export type ObligationState =
  | 'created'
  | 'pending'      // waiting for the obligated party to act
  | 'in_progress'  // action started (e.g., LP settling externally)
  | 'fulfilled'    // obligation met
  | 'breached'     // obligation not met (triggers dispute/penalty)
  | 'cancelled'    // obligation voided
  | 'transferred'; // obligation moved to another party (replacement LP)

export type ObligationPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Obligation {
  id: string;
  type: ObligationType;
  state: ObligationState;
  priority: ObligationPriority;

  // Who owes what to whom
  obligorId: string;      // entity that owes (original owner of the obligation)
  obligeeId: string;      // entity that is owed (beneficiary)
  amount?: number;
  currency?: string;

  // Settlement rights — live on the obligation, not on escrow
  currentFulfillerId: string;  // who is currently responsible for fulfilling
  escrowId?: string;           // escrow holding the guarantee
  deadline: number;            // when this obligation must be fulfilled

  // Evidence supporting this obligation
  evidenceCitations: EvidenceCitation[];

  // Lifecycle
  createdAt: number;
  dueAt: number;          // deadline
  fulfilledAt: number | null;
  breachedAt: number | null;

  // Resolution
  resolvedByTransitionId?: string;  // which transition fulfilled this
  replacementObligationId?: string; // if transferred to replacement LP

  // Dispute
  disputeId?: string;
  breachReason?: string;

  meta?: Record<string, unknown>;
}

/** Factory: create an Obligation. */
export function obligation(params: {
  type: ObligationType;
  priority?: ObligationPriority;
  obligorId: string;
  obligeeId: string;
  amount?: number;
  currency?: string;
  currentFulfillerId?: string;
  escrowId?: string;
  evidenceCitations?: EvidenceCitation[];
  dueAt: number;
  meta?: Record<string, unknown>;
}): Obligation {
  return {
    id: uid('obl'),
    type: params.type,
    state: 'created',
    priority: params.priority ?? 'medium',
    obligorId: params.obligorId,
    obligeeId: params.obligeeId,
    amount: params.amount,
    currency: params.currency,
    currentFulfillerId: params.currentFulfillerId ?? params.obligorId,
    escrowId: params.escrowId,
    deadline: params.dueAt,
    evidenceCitations: params.evidenceCitations ?? [],
    createdAt: Date.now(),
    dueAt: params.dueAt,
    fulfilledAt: null,
    breachedAt: null,
    meta: params.meta,
  };
}

/** Transition an obligation to a new state. */
export function transitionObligation(
  ob: Obligation,
  to: ObligationState,
  reason?: string,
  transitionId?: string,
): Obligation {
  const updated = { ...ob };
  updated.state = to;
  if (to === 'fulfilled') {
    updated.fulfilledAt = Date.now();
    updated.resolvedByTransitionId = transitionId;
  } else if (to === 'breached') {
    updated.breachedAt = Date.now();
    updated.breachReason = reason;
  } else if (to === 'transferred') {
    updated.replacementObligationId = transitionId; // ID of the replacement obligation
  }
  return updated;
}

/** Check if an obligation is overdue. */
export function isOverdue(ob: Obligation, now: number = Date.now()): boolean {
  return ob.state === 'pending' || ob.state === 'in_progress' ? now > ob.dueAt : false;
}

/** Check if an obligation is active (not yet resolved). */
export function isActive(ob: Obligation): boolean {
  return ob.state === 'created' || ob.state === 'pending' || ob.state === 'in_progress';
}

/**
 * Transfer the fulfiller of an obligation (for replacement LPs).
 * Only the currentFulfillerId changes — the obligation itself stays the same.
 * This makes replacement LPs trivial: just transfer fulfiller.
 */
export function transferFulfiller(ob: Obligation, newFulfillerId: string): Obligation {
  return {
    ...ob,
    currentFulfillerId: newFulfillerId,
    state: 'transferred',
  };
}

/**
 * Obligation Store — tracks all outstanding obligations in the world.
 * The world has converged when all obligations are fulfilled or cancelled.
 */
export class ObligationStore {
  private obligations: Map<string, Obligation> = new Map();

  register(ob: Obligation): Obligation {
    this.obligations.set(ob.id, ob);
    return ob;
  }

  get(id: string): Obligation | undefined {
    return this.obligations.get(id);
  }

  update(id: string, ob: Obligation): void {
    this.obligations.set(id, ob);
  }

  all(): Obligation[] {
    return [...this.obligations.values()];
  }

  active(): Obligation[] {
    return this.all().filter(isActive);
  }

  fulfilled(): Obligation[] {
    return this.all().filter((o) => o.state === 'fulfilled');
  }

  breached(): Obligation[] {
    return this.all().filter((o) => o.state === 'breached');
  }

  byObligor(entityId: string): Obligation[] {
    return this.all().filter((o) => o.obligorId === entityId);
  }

  byObligee(entityId: string): Obligation[] {
    return this.all().filter((o) => o.obligeeId === entityId);
  }

  /** Has the world converged? (no active obligations) */
  isConverged(): boolean {
    return this.active().length === 0;
  }

  /** Total outstanding obligation amount for an entity. */
  outstandingFor(entityId: string): number {
    return this.byObligor(entityId)
      .filter(isActive)
      .reduce((sum, o) => sum + (o.amount ?? 0), 0);
  }

  reset(): void {
    this.obligations.clear();
  }
}

export const obligationStore = new ObligationStore();

/** Human-readable labels. */
export const OBLIGATION_LABELS: Record<ObligationType, string> = {
  deliver: 'Deliver',
  confirm: 'Confirm',
  authorize: 'Authorize',
  verify: 'Verify',
  transfer: 'Transfer',
  approve: 'Approve',
  release: 'Release',
  submit: 'Submit',
  resolve: 'Resolve',
  rebalance: 'Rebalance',
  custom: 'Custom',
};
