/**
 * PaySwap Runtime — Commitment Primitive.
 *
 * The final kernel primitive. A Commitment is the stage between an auction
 * award (or task acceptance) and obligation creation. It represents accepted
 * responsibility — once activated, it creates the corresponding Obligation.
 *
 *   Auction award → Commitment (LP accepts responsibility)
 *   Commitment activated → Obligation created
 *   Obligation fulfilled → World converges
 *
 * Difference from Obligation:
 *   Obligation = something is owed (already exists)
 *   Commitment = an actor has accepted responsibility (may create obligation)
 *
 * Example:
 *   LP bids in auction → not an obligation yet
 *   After award → Commitment: "LP will settle 40,000 GHS by deadline"
 *   If accepted/activated → creates Obligation: "LP owes merchant 40,000 GHS"
 *
 * The 9 frozen primitives: Entity, Capability, Evidence, Claim, Commitment,
 * Obligation, Command, Transition, Event. No more will be added.
 */
import { uid } from './support';
import type { EvidenceCitation } from './evidence';

export type CommitmentType =
  | 'settlement'              // LP commits to settling a payment
  | 'replacement_settlement'  // LP commits to replacing another LP
  | 'manual_completion'       // LP commits to manually completing settlement
  | 'evidence_submission'     // LP commits to providing evidence
  | 'confirmation'            // merchant commits to confirming receipt
  | 'dispute_resolution'      // governance commits to resolving a dispute
  | 'rebalance'               // treasury commits to rebalancing reserves
  | 'capacity_provision'      // LP commits to providing capacity
  | 'custom';

export type CommitmentState =
  | 'offered'      // SYN: committer proposes
  | 'accepted'     // SYN-ACK: beneficiary accepts
  | 'activated'    // ACK: committer confirms activation → obligation created
  | 'completed'    // commitment fulfilled
  | 'expired'      // deadline passed without activation
  | 'withdrawn'    // commitment withdrawn before activation
  | 'breached'     // activated but not fulfilled
  | 'rejected';    // beneficiary rejected the offer

export interface Commitment {
  id: string;
  type: CommitmentType;
  state: CommitmentState;

  committerId: string;       // entity making the commitment
  beneficiaryId: string;     // entity that benefits
  amount?: number;
  currency?: string;

  // Conditions that must be met for activation
  conditions: { description: string; met: boolean }[];

  // Evidence supporting this commitment
  evidenceCitations: EvidenceCitation[];

  // Lifecycle
  offeredAt: number;
  expiresAt: number;         // deadline for activation
  activatedAt: number | null;
  completedAt: number | null;

  // Link to the obligation this commitment created
  obligationId?: string;

  meta?: Record<string, unknown>;
}

/** Factory: create a Commitment. */
export function commitment(params: {
  type: CommitmentType;
  committerId: string;
  beneficiaryId: string;
  amount?: number;
  currency?: string;
  conditions?: { description: string; met: boolean }[];
  evidenceCitations?: EvidenceCitation[];
  ttlMs?: number;
  meta?: Record<string, unknown>;
}): Commitment {
  const now = Date.now();
  return {
    id: uid('commit'),
    type: params.type,
    state: 'offered',
    committerId: params.committerId,
    beneficiaryId: params.beneficiaryId,
    amount: params.amount,
    currency: params.currency,
    conditions: params.conditions ?? [],
    evidenceCitations: params.evidenceCitations ?? [],
    offeredAt: now,
    expiresAt: now + (params.ttlMs ?? 120_000), // 2 min default
    activatedAt: null,
    completedAt: null,
    meta: params.meta,
  };
}

/** Accept a commitment (SYN-ACK: beneficiary accepts the offer). */
export function acceptCommitment(c: Commitment): Commitment {
  return { ...c, state: 'accepted' };
}

/** Reject a commitment (beneficiary rejects the offer). */
export function rejectCommitment(c: Commitment, reason?: string): Commitment {
  return { ...c, state: 'rejected', meta: { ...c.meta, rejectionReason: reason } };
}

/**
 * Activate a commitment (ACK: committer confirms → creates obligation).
 * Bilateral handshake complete: SYN → SYN-ACK → ACK → activated.
 */
export function activateCommitment(c: Commitment, obligationId: string): Commitment {
  return {
    ...c,
    state: 'activated',
    activatedAt: Date.now(),
    obligationId,
  };
}

/** Complete a commitment (the obligation was fulfilled). */
export function completeCommitment(c: Commitment): Commitment {
  return { ...c, state: 'completed', completedAt: Date.now() };
}

/** Expire a commitment (deadline passed without activation). */
export function expireCommitment(c: Commitment): Commitment {
  return { ...c, state: 'expired' };
}

/** Withdraw a commitment (before activation). */
export function withdrawCommitment(c: Commitment, reason?: string): Commitment {
  return { ...c, state: 'withdrawn', meta: { ...c.meta, withdrawalReason: reason } };
}

/** Breach a commitment (activated but not fulfilled). */
export function breachCommitment(c: Commitment, reason: string): Commitment {
  return { ...c, state: 'breached', meta: { ...c.meta, breachReason: reason } };
}

/** Check if all conditions are met for activation. */
export function canActivate(c: Commitment): boolean {
  return c.state === 'accepted' && c.conditions.every((cond) => cond.met);
}

/** Check if a commitment has expired. */
export function isExpired(c: Commitment, now: number = Date.now()): boolean {
  return c.state === 'offered' || c.state === 'accepted' ? now > c.expiresAt : false;
}

/**
 * Commitment Store — tracks all commitments in the world.
 */
export class CommitmentStore {
  private commitments: Map<string, Commitment> = new Map();

  register(c: Commitment): Commitment {
    this.commitments.set(c.id, c);
    return c;
  }

  get(id: string): Commitment | undefined {
    return this.commitments.get(id);
  }

  update(id: string, c: Commitment): void {
    this.commitments.set(id, c);
  }

  all(): Commitment[] {
    return [...this.commitments.values()];
  }

  active(): Commitment[] {
    return this.all().filter((c) => c.state === 'offered' || c.state === 'accepted' || c.state === 'activated');
  }

  byCommitter(entityId: string): Commitment[] {
    return this.all().filter((c) => c.committerId === entityId);
  }

  byBeneficiary(entityId: string): Commitment[] {
    return this.all().filter((c) => c.beneficiaryId === entityId);
  }

  reset(): void {
    this.commitments.clear();
  }
}

export const commitmentStore = new CommitmentStore();

/** Human-readable labels. */
export const COMMITMENT_LABELS: Record<CommitmentType, string> = {
  settlement: 'Settlement',
  replacement_settlement: 'Replacement Settlement',
  manual_completion: 'Manual Completion',
  evidence_submission: 'Evidence Submission',
  confirmation: 'Confirmation',
  dispute_resolution: 'Dispute Resolution',
  rebalance: 'Rebalance',
  capacity_provision: 'Capacity Provision',
  custom: 'Custom',
};
