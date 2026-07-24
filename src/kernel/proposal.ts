/**
 * PaySwap Runtime — Proposal Primitive.
 *
 * Replaces both Claim and Commitment. A Proposal is the only transient object:
 *
 *   Evidence → Proposal → (accepted) → Obligation
 *   Evidence → Proposal → (rejected) → Event (logged, not persisted)
 *
 * A Proposal contains:
 *   - who proposes (proposer)
 *   - who benefits (beneficiary)
 *   - what is proposed (type, amount, conditions)
 *   - required evidence (citations)
 *   - expiry (TTL)
 *   - state (offered → accepted → activated → completed | rejected | expired)
 *
 * Bilateral: proposer offers (SYN), beneficiary accepts (SYN-ACK), proposer
 * activates (ACK → creates obligation). Exactly like TCP.
 *
 * After completion, the Proposal disappears — its lifecycle is recorded in
 * Events. No long-lived Claim or Commitment state.
 */
import { uid, round } from './support';
import type { EvidenceCitation } from './evidence';

export type ProposalType =
  | 'deliver'       // "I will deliver X to Y"
  | 'confirm'       // "I will confirm receipt"
  | 'authorize'     // "I will authorize this action"
  | 'verify'        // "I will verify this claim"
  | 'transfer'      // "I will transfer rights"
  | 'approve'       // "I will approve this request"
  | 'release'       // "I will release this resource"
  | 'submit'        // "I will submit evidence"
  | 'resolve'       // "I will resolve this dispute"
  | 'rebalance'     // "I will rebalance state"
  | 'provide'       // "I will provide capacity/liquidity"
  | 'custom';

export type ProposalState =
  | 'offered'       // SYN: proposer offers
  | 'accepted'      // SYN-ACK: beneficiary accepts
  | 'activated'     // ACK: proposer confirms → obligation created
  | 'completed'     // obligation fulfilled
  | 'rejected'      // beneficiary rejected
  | 'expired'       // TTL passed without activation
  | 'withdrawn'     // proposer withdrew before activation
  | 'breached';     // activated but not fulfilled

export interface Proposal {
  id: string;
  type: ProposalType;
  state: ProposalState;
  proposerId: string;          // who proposes
  beneficiaryId: string;       // who benefits
  amount?: number;
  currency?: string;
  conditions: { description: string; met: boolean }[];
  evidenceCitations: EvidenceCitation[];
  confidence: number;          // aggregate confidence from evidence
  offeredAt: number;
  expiresAt: number;
  activatedAt: number | null;
  completedAt: number | null;
  obligationId?: string;       // link to obligation when activated
  rejectionReason?: string;
  meta?: Record<string, unknown>;
}

/** Factory: create a Proposal. */
export function proposal(params: {
  type: ProposalType;
  proposerId: string;
  beneficiaryId: string;
  amount?: number;
  currency?: string;
  conditions?: { description: string; met: boolean }[];
  evidenceCitations?: EvidenceCitation[];
  confidence?: number;
  ttlMs?: number;
  meta?: Record<string, unknown>;
}): Proposal {
  const now = Date.now();
  return {
    id: uid('prop'),
    type: params.type,
    state: 'offered',
    proposerId: params.proposerId,
    beneficiaryId: params.beneficiaryId,
    amount: params.amount,
    currency: params.currency,
    conditions: params.conditions ?? [],
    evidenceCitations: params.evidenceCitations ?? [],
    confidence: params.confidence ?? 0,
    offeredAt: now,
    expiresAt: now + (params.ttlMs ?? 120_000),
    activatedAt: null,
    completedAt: null,
    meta: params.meta,
  };
}

/** SYN-ACK: beneficiary accepts the proposal. */
export function accept(p: Proposal): Proposal {
  return { ...p, state: 'accepted' };
}

/** Beneficiary rejects. */
export function reject(p: Proposal, reason?: string): Proposal {
  return { ...p, state: 'rejected', rejectionReason: reason };
}

/** ACK: proposer activates → creates obligation. Bilateral handshake complete. */
export function activate(p: Proposal, obligationId: string): Proposal {
  return { ...p, state: 'activated', activatedAt: Date.now(), obligationId };
}

/** Obligation fulfilled → proposal completed. Proposal then disappears. */
export function complete(p: Proposal): Proposal {
  return { ...p, state: 'completed', completedAt: Date.now() };
}

/** TTL expired. */
export function expire(p: Proposal): Proposal {
  return { ...p, state: 'expired' };
}

/** Proposer withdraws before activation. */
export function withdraw(p: Proposal, reason?: string): Proposal {
  return { ...p, state: 'withdrawn', rejectionReason: reason };
}

/** Activated but not fulfilled. */
export function breach(p: Proposal, reason: string): Proposal {
  return { ...p, state: 'breached', rejectionReason: reason };
}

/** Check if all conditions are met for activation. */
export function canActivate(p: Proposal): boolean {
  return p.state === 'accepted' && p.conditions.every((c) => c.met);
}

/** Check if expired. */
export function isExpired(p: Proposal, now: number = Date.now()): boolean {
  return (p.state === 'offered' || p.state === 'accepted') && now > p.expiresAt;
}

/** Is this proposal still active (not resolved)? */
export function isActive(p: Proposal): boolean {
  return p.state === 'offered' || p.state === 'accepted' || p.state === 'activated';
}

/**
 * Proposal Store — tracks active proposals.
 * Completed/expired/rejected proposals are removed (their lifecycle is in Events).
 */
export class ProposalStore {
  private proposals: Map<string, Proposal> = new Map();

  register(p: Proposal): Proposal {
    this.proposals.set(p.id, p);
    return p;
  }

  get(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  update(id: string, p: Proposal): void {
    this.proposals.set(id, p);
  }

  /** Remove completed/expired/rejected proposals (they're now in Events). */
  gc(): number {
    let removed = 0;
    for (const [id, p] of this.proposals) {
      if (p.state === 'completed' || p.state === 'expired' || p.state === 'rejected' || p.state === 'withdrawn' || p.state === 'breached') {
        this.proposals.delete(id);
        removed++;
      }
    }
    return removed;
  }

  active(): Proposal[] {
    return [...this.proposals.values()].filter(isActive);
  }

  byProposer(entityId: string): Proposal[] {
    return this.all().filter((p) => p.proposerId === entityId);
  }

  byBeneficiary(entityId: string): Proposal[] {
    return this.all().filter((p) => p.beneficiaryId === entityId);
  }

  all(): Proposal[] {
    return [...this.proposals.values()];
  }

  reset(): void {
    this.proposals.clear();
  }
}

export const proposalStore = new ProposalStore();

export const PROPOSAL_LABELS: Record<ProposalType, string> = {
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
  provide: 'Provide',
  custom: 'Custom',
};
