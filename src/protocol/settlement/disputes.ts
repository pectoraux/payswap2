/**
 * PaySwap Protocol — Dispute Resolution.
 *
 * Replaces the insurance model. There is NO insurance pool. The frozen Twin
 * Tokens in Settlement Escrow ARE the guarantee.
 *
 * Dispute flow:
 *   Opened → EvidenceCollection → Voting → Adjudicated
 *     → LPWins → EscrowReturned
 *     → MerchantWins → MerchantWithdraws | ReplacementRequested → ReplacementSettled
 *     → CollateralSlash → LP penalized
 */
import { uid } from '@/kernel/support';
import { settlementEscrowContract, collateralVaultContract, lpRegistryContract } from '../contracts';

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
  | 'repeated_fraud';

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
  fraudType: FraudType | null;
  evidence: { lp: string[]; merchant: string[] };
  communityVotes: { for: number; against: number };
  payswapVote: 'pending' | 'for' | 'against';
  merchantTier: string;
  merchantDisputeWeight: number;
  openedAt: number;
  resolvedAt: number | null;
  replacementLpId: string | null;
}

export class DisputeEngine {
  private disputes: Map<string, Dispute> = new Map();

  /** Open a dispute on a frozen escrow. */
  open(escrowId: string, merchantId: string, merchantTier: string, reason: string): Dispute | undefined {
    const escrow = settlementEscrowContract.get(escrowId);
    if (!escrow || escrow.state !== 'frozen') return undefined;

    const disputeId = uid('dispute');
    settlementEscrowContract.dispute(escrowId, disputeId);

    const dispute: Dispute = {
      id: disputeId,
      escrowId,
      transactionId: escrow.transactionId,
      lpId: escrow.lpId,
      merchantId,
      amount: escrow.amount,
      currency: escrow.currency,
      state: 'evidence_collection',
      outcome: null,
      fraudType: null,
      evidence: { lp: [], merchant: [reason] },
      communityVotes: { for: 0, against: 0 },
      payswapVote: 'pending',
      merchantTier,
      merchantDisputeWeight: this.tierWeight(merchantTier),
      openedAt: Date.now(),
      resolvedAt: null,
      replacementLpId: null,
    };
    this.disputes.set(disputeId, dispute);
    return dispute;
  }

  /** Submit LP evidence. */
  submitLpEvidence(disputeId: string, evidence: string): void {
    const d = this.disputes.get(disputeId);
    if (d) d.evidence.lp.push(evidence);
  }

  /** Submit merchant evidence. */
  submitMerchantEvidence(disputeId: string, evidence: string): void {
    const d = this.disputes.get(disputeId);
    if (d) d.evidence.merchant.push(evidence);
  }

  /** Move to voting phase. */
  openVoting(disputeId: string): void {
    const d = this.disputes.get(disputeId);
    if (d && d.state === 'evidence_collection') d.state = 'voting';
  }

  /** Cast community vote. */
  communityVote(disputeId: string, forMerchant: boolean): void {
    const d = this.disputes.get(disputeId);
    if (d && d.state === 'voting') {
      if (forMerchant) d.communityVotes.for++;
      else d.communityVotes.against++;
    }
  }

  /** PaySwap adjudicates (weighted by merchant tier). */
  adjudicate(disputeId: string, payswapForMerchant: boolean, fraudType?: FraudType): Dispute | undefined {
    const d = this.disputes.get(disputeId);
    if (!d || d.state !== 'voting') return undefined;

    d.payswapVote = payswapForMerchant ? 'for' : 'against';
    d.fraudType = fraudType ?? null;

    // Weighted outcome: community votes + PaySwap vote, weighted by merchant tier
    const merchantWeight = d.communityVotes.for * d.merchantDisputeWeight + (payswapForMerchant ? 2 : 0);
    const lpWeight = d.communityVotes.against * (1 - d.merchantDisputeWeight) + (payswapForMerchant ? 0 : 2);

    if (merchantWeight > lpWeight) {
      d.outcome = fraudType === 'forged_evidence' || fraudType === 'repeated_fraud' ? 'collateral_slash' : 'merchant_wins';
      d.state = d.outcome === 'collateral_slash' ? 'collateral_slash' : 'merchant_wins';
      this.executeMerchantWins(d);
    } else {
      d.outcome = 'lp_wins';
      d.state = 'lp_wins';
      this.executeLpWins(d);
    }

    d.state = 'resolved';
    d.resolvedAt = Date.now();
    this.applyFraudPenalty(d);
    return d;
  }

  /** Merchant requests replacement LP. */
  requestReplacement(disputeId: string, newLpId: string): Dispute | undefined {
    const d = this.disputes.get(disputeId);
    if (!d || d.state !== 'resolved' || d.outcome !== 'merchant_wins') return undefined;
    d.replacementLpId = newLpId;
    settlementEscrowContract.transfer(d.escrowId, newLpId);
    return d;
  }

  private executeLpWins(d: Dispute): void {
    settlementEscrowContract.refund(d.escrowId);
  }

  private executeMerchantWins(d: Dispute): void {
    if (d.outcome === 'collateral_slash') {
      settlementEscrowContract.slash(d.escrowId);
    } else {
      // Merchant can withdraw or request replacement
      settlementEscrowContract.slash(d.escrowId);
    }
  }

  private applyFraudPenalty(d: Dispute): void {
    if (!d.fraudType) return;
    const lpReg = lpRegistryContract.get(d.lpId);
    if (!lpReg) return;

    switch (d.fraudType) {
      case 'settlement_timeout':
        lpRegistryContract.updateReputation(d.lpId, lpReg.reputation - 0.05);
        break;
      case 'unable_to_prove':
        // Escrow already frozen — merchant can withdraw
        lpRegistryContract.updateReputation(d.lpId, lpReg.reputation - 0.10);
        break;
      case 'forged_evidence':
        // Collateral slash + reputation slash + suspension
        const collateral = collateralVaultContract.byLp(d.lpId);
        if (collateral.length > 0) {
          collateralVaultContract.slash(collateral[0].id, d.amount * 0.1, 'forged_evidence');
        }
        lpRegistryContract.updateReputation(d.lpId, lpReg.reputation - 0.25);
        break;
      case 'repeated_fraud':
        // Remove LP + close routes + lock staking
        lpRegistryContract.updateReputation(d.lpId, 0);
        lpRegistryContract.updateExposure(d.lpId, 0);
        break;
    }
  }

  private tierWeight(tier: string): number {
    switch (tier) {
      case 'premium': return 1.0;
      case 'trusted': return 0.6;
      case 'verified': return 0.3;
      default: return 0.1;
    }
  }

  get(disputeId: string): Dispute | undefined {
    return this.disputes.get(disputeId);
  }

  all(): Dispute[] {
    return [...this.disputes.values()];
  }
}

export const disputeEngine = new DisputeEngine();
