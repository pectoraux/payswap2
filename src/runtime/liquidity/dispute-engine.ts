/**
 * M-RT-30: Dispute Engine — evidence-first dispute resolution.
 *
 * Decision pipeline:
 *   Evidence → AI Evaluation → Community Review → PaySwap Arbitration → Resolution
 *
 * Community voting contributes evidence weighting.
 * It is NOT the primary decision mechanism.
 */

import { uid } from '@/runtime/types';

export type DisputeStatus =
  | 'open'
  | 'evidence_collection'
  | 'ai_evaluation'
  | 'community_review'
  | 'arbitration'
  | 'resolved_approved'
  | 'resolved_rejected'
  | 'resolved_vetoed';

export type EvidenceType =
  | 'transaction_logs'
  | 'bank_proof'
  | 'mobile_money_proof'
  | 'screenshot'
  | 'settlement_receipt'
  | 'recipient_confirmation';

export interface Evidence {
  id: string;
  type: EvidenceType;
  submittedBy: string;
  description: string;
  reference?: string;
  submittedAt: number;
}

export interface CommunityVote {
  id: string;
  voterId: string;
  vote: 'support' | 'reject';
  comment?: string;
  weight: number;
  votedAt: number;
}

export interface Dispute {
  id: string;
  settlementContractId: string;
  status: DisputeStatus;
  reason: string;
  evidence: Evidence[];
  votes: CommunityVote[];
  aiEvaluation?: { recommendation: 'approve' | 'reject'; confidence: number; reasoning: string };
  resolution?: { decision: 'approved' | 'rejected' | 'vetoed'; resolvedBy: string; notes: string; resolvedAt: number };
  createdAt: number;
  updatedAt: number;
}

class DisputeEngine {
  private disputes: Map<string, Dispute> = new Map();

  create(settlementContractId: string, reason: string): Dispute {
    const dispute: Dispute = {
      id: uid('disp'),
      settlementContractId,
      status: 'evidence_collection',
      reason,
      evidence: [],
      votes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.disputes.set(dispute.id, dispute);
    return dispute;
  }

  submitEvidence(disputeId: string, evidence: Omit<Evidence, 'id' | 'submittedAt'>): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || !['evidence_collection', 'open'].includes(d.status)) return null;
    d.evidence.push({ ...evidence, id: uid('ev'), submittedAt: Date.now() });
    d.updatedAt = Date.now();
    return d;
  }

  castVote(disputeId: string, voterId: string, vote: 'support' | 'reject', comment?: string): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d || d.status !== 'community_review') return null;
    // One vote per user
    const existing = d.votes.find(v => v.voterId === voterId);
    if (existing) {
      existing.vote = vote;
      existing.comment = comment;
      existing.votedAt = Date.now();
    } else {
      d.votes.push({ id: uid('vote'), voterId, vote, comment, weight: 1, votedAt: Date.now() });
    }
    d.updatedAt = Date.now();
    return d;
  }

  setAiEvaluation(disputeId: string, evaluation: Dispute['aiEvaluation']): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d) return null;
    d.aiEvaluation = evaluation;
    d.status = 'community_review';
    d.updatedAt = Date.now();
    return d;
  }

  resolve(disputeId: string, decision: 'approved' | 'rejected' | 'vetoed', resolvedBy: string, notes: string): Dispute | null {
    const d = this.disputes.get(disputeId);
    if (!d) return null;
    d.resolution = { decision, resolvedBy, notes, resolvedAt: Date.now() };
    d.status = decision === 'approved' ? 'resolved_approved' : decision === 'rejected' ? 'resolved_rejected' : 'resolved_vetoed';
    d.updatedAt = Date.now();
    return d;
  }

  /**
   * Admin veto — overrides community vote.
   */
  veto(disputeId: string, adminId: string, notes: string): Dispute | null {
    return this.resolve(disputeId, 'vetoed', adminId, notes);
  }

  get(disputeId: string): Dispute | null {
    return this.disputes.get(disputeId) ?? null;
  }

  list(filter?: { status?: DisputeStatus; settlementContractId?: string }): Dispute[] {
    let results = Array.from(this.disputes.values());
    if (filter?.status) results = results.filter(d => d.status === filter.status);
    if (filter?.settlementContractId) results = results.filter(d => d.settlementContractId === filter.settlementContractId);
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get the community vote tally (support vs reject).
   */
  getVoteTally(disputeId: string): { support: number; reject: number; total: number } {
    const d = this.disputes.get(disputeId);
    if (!d) return { support: 0, reject: 0, total: 0 };
    const support = d.votes.filter(v => v.vote === 'support').reduce((s, v) => s + v.weight, 0);
    const reject = d.votes.filter(v => v.vote === 'reject').reduce((s, v) => s + v.weight, 0);
    return { support, reject, total: support + reject };
  }
}

export const disputeEngine = new DisputeEngine();
export { DisputeEngine };
export { BandwidthEngine } from './bandwidth-engine';
export { bandwidthEngine } from './bandwidth-engine';
