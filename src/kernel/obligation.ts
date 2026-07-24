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
import { uid } from './support';
import type { EvidenceCitation } from './evidence';

export type ObligationType =
  | 'fiat_settlement'      // LP owes merchant fiat
  | 'token_release'        // escrow owes token release
  | 'confirmation'         // merchant owes confirmation
  | 'rebalance'            // treasury owes reserve rebalance
  | 'dispute_resolution'   // governance owes dispute resolution
  | 'evidence_submission'  // LP owes evidence of settlement
  | 'replacement_settlement' // replacement LP owes settlement
  | 'collateral_release'   // vault owes collateral release
  | 'exposure_release'     // LP owes exposure release
  | 'proof_submission'     // LP owes fiat proof
  | 'vote'                 // community owes governance vote
  | 'custom';

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
  obligorId: string;      // entity that owes
  obligeeId: string;      // entity that is owed
  amount?: number;
  currency?: string;

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
  fiat_settlement: 'Fiat Settlement',
  token_release: 'Token Release',
  confirmation: 'Confirmation',
  rebalance: 'Rebalance',
  dispute_resolution: 'Dispute Resolution',
  evidence_submission: 'Evidence Submission',
  replacement_settlement: 'Replacement Settlement',
  collateral_release: 'Collateral Release',
  exposure_release: 'Exposure Release',
  proof_submission: 'Proof Submission',
  vote: 'Governance Vote',
  custom: 'Custom',
};
