/**
 * PaySwap Protocol — Dispute Resolution Engine.
 *
 * Replaces insurance. The frozen Twin Tokens in Settlement Escrow ARE the guarantee.
 *
 * Flow:
 *   Opened → EvidenceCollection → Voting → Adjudicated
 *     → LPWins → EscrowRefunded
 *     → MerchantWins → MerchantWithdraws | ReplacementRequested → ReplacementSettled
 *     → CollateralSlash → LP penalized
 *
 * Fraud classification with escalating penalties:
 *   settlement_timeout → small reputation penalty
 *   unable_to_prove → escrow remains frozen, merchant may withdraw
 *   forged_evidence → collateral slash + reputation slash + suspension
 *   repeated_fraud → LP removed + routes closed + staking locked
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { settlementEscrow } from './escrow';
import { collateralVault } from './collateral-vault';
import { lpLifecycle } from '../lp-lifecycle-manager';

export type DisputeState =
  | 'opened'
  | 'evidence_collection'
  | 'voting'
  | 'adjudicated'
  | 'lp_wins'
  | 'merchant_wins'
  | 'collateral_slash'
  | 'resolved';

export type DisputeOutcome = 'lp_wins' | 'merchant_wins' | 'collateral_slash';

export type FraudType =
  | 'settlement_timeout'
  | 'unable_to_prove'
  | 'forged_evidence'
  | 'repeated_fraud'
  | 'none';

export type EvidenceParty = 'lp' | 'merchant' | 'community' | 'payswap';

export interface DisputeEvidence {
  id: string;
  party: EvidenceParty;
  submittedAt: number;
  evidenceType: string;
  content: string;
  verified: boolean;
  proofHash?: string;
}

export interface CommunityVote {
  voterId: string;
  forMerchant: boolean;
  weight: number;
  ts: number;
}

export interface Dispute {
  id: string;
  escrowId: string;
  transactionId: string;
  lpId: string;
  merchantId: string;
  amount: number;
  currency: string;
  state: DisputeState;
  outcome: DisputeOutcome | null;
  fraudType: FraudType;
  evidence: DisputeEvidence[];
  communityVotes: { for: number; against: number; votes: CommunityVote[] };
  payswapVote: 'pending' | 'for_merchant' | 'for_lp';
  merchantTier: string;
  merchantDisputeWeight: number;
  replacementLpId: string | null;
  openedAt: number;
  resolvedAt: number | null;
  deadline: number;
  history: { from: DisputeState; to: DisputeState; action: string; ts: number; reason: string }[];
}

const ALLOWED: Record<DisputeState, string[]> = {
  opened: ['start_evidence'],
  evidence_collection: ['open_voting', 'auto_resolve'],
  voting: ['adjudicate'],
  adjudicated: ['execute_lp_wins', 'execute_merchant_wins', 'execute_slash'],
  lp_wins: ['resolve'],
  merchant_wins: ['resolve', 'request_replacement'],
  collateral_slash: ['resolve'],
  resolved: [],
};

export class DisputeEngine {
  private disputes: Map<string, Dispute> = new Map();

  /** Open a dispute on a frozen escrow entry. */
  open(escrowId: string, merchantId: string, merchantTier: string, reason: string, deadlineMs: number = 86400000): Dispute | null {
    const escrow = settlementEscrow.get(escrowId);
    if (!escrow || escrow.state !== 'frozen') return null;

    const disputeId = uid('dispute');
    settlementEscrow.dispute(escrowId, disputeId);

    const dispute: Dispute = {
      id: disputeId,
      escrowId,
      transactionId: escrow.transactionId,
      lpId: escrow.lpId,
      merchantId,
      amount: escrow.amount,
      currency: escrow.currency,
      state: 'opened',
      outcome: null,
      fraudType: 'none',
      evidence: [],
      communityVotes: { for: 0, against: 0, votes: [] },
      payswapVote: 'pending',
      merchantTier,
      merchantDisputeWeight: this.tierWeight(merchantTier),
      replacementLpId: null,
      openedAt: Date.now(),
      resolvedAt: null,
      deadline: Date.now() + deadlineMs,
      history: [],
    };
    this.disputes.set(disputeId, dispute);
    this.transition(dispute, 'evidence_collection', 'start_evidence', `Dispute opened: ${reason}`);
    this.submitEvidence(disputeId, 'merchant', 'dispute_reason', reason, false);
    eventEngine.emit('dispute.opened', { disputeId, escrowId, lpId: escrow.lpId, merchantId, amount: escrow.amount }, 0);
    return dispute;
  }

  /** Submit evidence from any party. */
  submitEvidence(disputeId: string, party: EvidenceParty, evidenceType: string, content: string, verified: boolean, proofHash?: string): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || d.state !== 'evidence_collection') return null;
    const evidence: DisputeEvidence = {
      id: uid('evid'), party, submittedAt: Date.now(), evidenceType, content, verified, proofHash,
    };
    d.evidence.push(evidence);
    eventEngine.emit('dispute.evidence_submitted', { disputeId, party, evidenceType, verified }, 0);
    return d;
  }

  /** Move to voting phase. */
  openVoting(disputeId: string): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || !ALLOWED[d.state]?.includes('open_voting')) return null;
    return this.transition(d, 'voting', 'open_voting', 'Voting opened');
  }

  /** Cast a community vote. */
  communityVote(disputeId: string, voterId: string, forMerchant: boolean, weight: number = 1): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || d.state !== 'voting') return null;
    const vote: CommunityVote = { voterId, forMerchant, weight, ts: Date.now() };
    d.communityVotes.votes.push(vote);
    if (forMerchant) d.communityVotes.for += weight;
    else d.communityVotes.against += weight;
    eventEngine.emit('dispute.vote_cast', { disputeId, voterId, forMerchant, weight }, 0);
    return d;
  }

  /** PaySwap adjudicates (weighted by merchant tier). */
  adjudicate(disputeId: string, payswapForMerchant: boolean, fraudType: FraudType = 'none'): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || !ALLOWED[d.state]?.includes('adjudicate')) return null;
    d.payswapVote = payswapForMerchant ? 'for_merchant' : 'for_lp';
    d.fraudType = fraudType;

    // Weighted outcome: community votes + PaySwap vote, weighted by merchant tier
    const merchantWeight = d.communityVotes.for * d.merchantDisputeWeight + (payswapForMerchant ? 2 : 0);
    const lpWeight = d.communityVotes.against * (1 - d.merchantDisputeWeight) + (payswapForMerchant ? 0 : 2);

    if (merchantWeight > lpWeight) {
      d.outcome = fraudType === 'forged_evidence' || fraudType === 'repeated_fraud' ? 'collateral_slash' : 'merchant_wins';
    } else {
      d.outcome = 'lp_wins';
    }

    this.transition(d, 'adjudicated', 'adjudicate', `Adjudicated: ${d.outcome} (fraud: ${fraudType})`);
    this.executeOutcome(d);
    return d;
  }

  /** Merchant requests replacement LP. */
  requestReplacement(disputeId: string, newLpId: string): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || d.state !== 'merchant_wins' || !ALLOWED[d.state]?.includes('request_replacement')) return null;
    d.replacementLpId = newLpId;
    settlementEscrow.transfer(d.escrowId, newLpId);
    eventEngine.emit('dispute.replacement_requested', { disputeId, oldLpId: d.lpId, newLpId }, 0);
    return this.transition(d, 'resolved', 'request_replacement', `Replacement LP: ${newLpId}`);
  }

  /** Execute the adjudicated outcome. */
  private executeOutcome(d: Dispute): void {
    switch (d.outcome) {
      case 'lp_wins':
        settlementEscrow.refund(d.escrowId);
        this.transition(d, 'lp_wins', 'execute_lp_wins', 'LP won — escrow refunded');
        this.applyFraudPenalty(d);
        this.transition(d, 'resolved', 'resolve', 'Dispute resolved');
        break;
      case 'merchant_wins':
        settlementEscrow.slash(d.escrowId);
        this.transition(d, 'merchant_wins', 'execute_merchant_wins', 'Merchant won — escrow slashed');
        this.applyFraudPenalty(d);
        break;
      case 'collateral_slash':
        settlementEscrow.slash(d.escrowId);
        this.slashCollateral(d);
        this.transition(d, 'collateral_slash', 'execute_slash', 'Collateral slashed');
        this.applyFraudPenalty(d);
        this.transition(d, 'resolved', 'resolve', 'Dispute resolved');
        break;
    }
    d.resolvedAt = Date.now();
    eventEngine.emit('dispute.resolved', { disputeId: d.id, outcome: d.outcome, fraudType: d.fraudType }, 0);
  }

  /** Apply fraud penalties based on fraud type. */
  private applyFraudPenalty(d: Dispute): void {
    if (d.fraudType === 'none') return;
    const lp = lpLifecycle.get(d.lpId);
    if (!lp) return;

    switch (d.fraudType) {
      case 'settlement_timeout':
        lpLifecycle.updateReputation(d.lpId, lp.reputation - 0.05);
        break;
      case 'unable_to_prove':
        lpLifecycle.updateReputation(d.lpId, lp.reputation - 0.10);
        break;
      case 'forged_evidence':
        lpLifecycle.updateReputation(d.lpId, lp.reputation - 0.25);
        lpLifecycle.suspend(d.lpId, 'Forged evidence in dispute');
        break;
      case 'repeated_fraud':
        lpLifecycle.slash(d.lpId, 'Repeated fraud');
        break;
    }
  }

  /** Slash collateral after adjudication. */
  private slashCollateral(d: Dispute): void {
    const lp = lpLifecycle.get(d.lpId);
    if (!lp) return;
    for (const collateralId of lp.collateralIds) {
      const collateral = collateralVault.get(collateralId);
      if (collateral && collateral.state === 'locked') {
        const slashAmount = Math.min(collateral.remainingAmount, d.amount * 0.1);
        collateralVault.slash(collateralId, slashAmount, `Dispute ${d.id}: ${d.fraudType}`);
      }
    }
  }

  get(disputeId: string): Dispute | undefined { return this.disputes.get(disputeId); }
  all(): Dispute[] { return [...this.disputes.values()]; }
  active(): Dispute[] { return this.all().filter((d) => d.state !== 'resolved'); }
  byEscrow(escrowId: string): Dispute | undefined { return this.all().find((d) => d.escrowId === escrowId); }

  reset(): void { this.disputes.clear(); }

  private tierWeight(tier: string): number {
    switch (tier) {
      case 'premium': return 1.0;
      case 'trusted': return 0.6;
      case 'verified': return 0.3;
      default: return 0.1;
    }
  }

  private transition(d: Dispute, toState: DisputeState, action: string, reason: string): Dispute {
    const fromState = d.state;
    d.state = toState;
    d.history.push({ from: fromState, to: toState, action, ts: Date.now(), reason });
    return d;
  }
}

export const disputeEngine = new DisputeEngine();
