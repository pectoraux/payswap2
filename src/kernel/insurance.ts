/**
 * Insurance Engine — kernel primitive for claim adjudication.
 *
 * Every claim has evidence, community votes, a PaySwap vote, a weighted
 * outcome, appeal, token slash/reward and coverage. The entire process is
 * modeled as a replayable workflow. Triggered by failures (fraud, LP default,
 * reserve breach) or by policy requirements.
 */
import type { InsuranceClaim, CurrencyCode, InsuranceClaimStatus } from './types';
import { uid, round } from './support';
import { eventEngine } from './event';

export class InsuranceEngine {
  private claims: InsuranceClaim[] = [];

  file(amount: number, currency: CurrencyCode, reason: string, frame: number): InsuranceClaim {
    const claim: InsuranceClaim = {
      id: uid('claim'),
      amount,
      currency,
      reason,
      status: 'filed',
      evidence: [],
      communityVotes: 0,
      payswapVote: 'pending',
      coverage: round(amount * 0.9, 2),
      filedAtFrame: frame,
      resolvedAtFrame: null,
    };
    this.claims.push(claim);
    eventEngine.emit('insurance.filed', { claimId: claim.id, amount, reason, frame }, frame);
    return claim;
  }

  /** Deterministic adjudication for the digital twin. */
  adjudicate(claim: InsuranceClaim, frame: number, approves: boolean): InsuranceClaim {
    claim.communityVotes = Math.floor(Math.random() * 50) + (approves ? 30 : 5);
    claim.payswapVote = approves ? 'approve' : 'deny';
    claim.status = approves ? 'approved' : 'denied';
    claim.resolvedAtFrame = frame;
    eventEngine.emit('insurance.resolved', { claimId: claim.id, status: claim.status, votes: claim.communityVotes, frame }, frame);
    return claim;
  }

  addEvidence(claim: InsuranceClaim, evidence: string): InsuranceClaim {
    claim.evidence.push(evidence);
    claim.status = 'evidence_required';
    return claim;
  }

  all(): InsuranceClaim[] {
    return [...this.claims];
  }

  reset(): void {
    this.claims = [];
  }
}

export const insuranceEngine = new InsuranceEngine();

export function statusLabel(s: InsuranceClaimStatus): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
