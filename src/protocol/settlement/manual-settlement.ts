/**
 * PaySwap Protocol — Manual Settlement Workflow.
 *
 * When an LP cannot be auto-debited, settlement enters a manual workflow:
 *
 *   LP draw → WAITING_FOR_LP_SETTLEMENT
 *   → LP notified
 *   → LP submits proof of external settlement
 *   → Merchant confirms OR opens dispute
 *   → If confirmed: escrow released, obligation fulfilled
 *   → If disputed: dispute engine takes over
 *   → If timeout: dispute opens automatically
 *
 * No duplicated settlement. No duplicated mint. No manual overrides.
 */
import { uid, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { settlementEscrow } from './escrow';
import { disputeEngine } from './dispute-engine';

export type ManualSettlementState =
  | 'awaiting_lp_settlement'
  | 'lp_notified'
  | 'proof_submitted'
  | 'merchant_confirming'
  | 'confirmed'
  | 'disputed'
  | 'timed_out';

export interface ManualSettlement {
  id: string;
  transactionId: string;
  escrowId: string;
  lpId: string;
  merchantId: string;
  amount: number;
  currency: string;
  state: ManualSettlementState;
  proofHash: string | null;
  proofSubmittedAt: number | null;
  confirmedAt: number | null;
  disputeId: string | null;
  deadline: number;
  createdAt: number;
  history: { from: ManualSettlementState; to: ManualSettlementState; action: string; ts: number; reason: string }[];
}

const ALLOWED: Record<ManualSettlementState, string[]> = {
  awaiting_lp_settlement: ['notify_lp'],
  lp_notified: ['submit_proof', 'timeout'],
  proof_submitted: ['merchant_confirm', 'merchant_dispute', 'timeout'],
  merchant_confirming: ['confirm', 'dispute', 'timeout'],
  confirmed: [],
  disputed: [],
  timed_out: [],
};

export class ManualSettlementEngine {
  private settlements: Map<string, ManualSettlement> = new Map();

  /** Start manual settlement for a transaction. */
  start(
    transactionId: string,
    escrowId: string,
    lpId: string,
    merchantId: string,
    amount: number,
    currency: string,
    timeoutMs: number = 3600000,
  ): ManualSettlement {
    const settlement: ManualSettlement = {
      id: uid('manual'),
      transactionId, escrowId, lpId, merchantId, amount, currency,
      state: 'awaiting_lp_settlement',
      proofHash: null, proofSubmittedAt: null, confirmedAt: null, disputeId: null,
      deadline: Date.now() + timeoutMs,
      createdAt: Date.now(),
      history: [],
    };
    this.settlements.set(settlement.id, settlement);
    eventEngine.emit('manual_settlement.started', { settlementId: settlement.id, transactionId, lpId, merchantId, amount }, 0);
    return settlement;
  }

  /** Notify the LP that manual settlement is required. */
  notifyLp(settlementId: string): ManualSettlement | null {
    const s = this.settlements.get(settlementId);
    if (!s || !ALLOWED[s.state]?.includes('notify_lp')) return null;
    this.transition(s, 'lp_notified', 'notify_lp', 'LP notified of manual settlement requirement');
    eventEngine.emit('manual_settlement.lp_notified', { settlementId, lpId: s.lpId }, 0);
    return s;
  }

  /** LP submits proof of external settlement. */
  submitProof(settlementId: string, proofHash: string, proofContent: string): ManualSettlement | null {
    const s = this.settlements.get(settlementId);
    if (!s || !ALLOWED[s.state]?.includes('submit_proof')) return null;
    s.proofHash = proofHash;
    s.proofSubmittedAt = Date.now();
    this.transition(s, 'proof_submitted', 'submit_proof', `Proof submitted: ${proofContent.slice(0, 50)}`);
    eventEngine.emit('manual_settlement.proof_submitted', { settlementId, lpId: s.lpId, proofHash }, 0);
    return s;
  }

  /** Merchant confirms receipt (settlement complete). */
  confirm(settlementId: string): ManualSettlement | null {
    const s = this.settlements.get(settlementId);
    if (!s || !ALLOWED[s.state]?.includes('confirm')) return null;
    s.confirmedAt = Date.now();
    this.transition(s, 'confirmed', 'confirm', 'Merchant confirmed settlement');
    // Release escrow to LP
    settlementEscrow.release(s.escrowId, s.proofHash ?? undefined);
    eventEngine.emit('manual_settlement.confirmed', { settlementId, escrowId: s.escrowId, lpId: s.lpId }, 0);
    return s;
  }

  /** Merchant disputes (opens dispute). */
  dispute(settlementId: string, merchantTier: string, reason: string): ManualSettlement | null {
    const s = this.settlements.get(settlementId);
    if (!s || !ALLOWED[s.state]?.includes('dispute') && !ALLOWED[s.state]?.includes('merchant_dispute')) return null;
    const dispute = disputeEngine.open(s.escrowId, s.merchantId, merchantTier, reason);
    if (dispute) {
      s.disputeId = dispute.id;
      this.transition(s, 'disputed', 'dispute', `Dispute opened: ${reason}`);
      eventEngine.emit('manual_settlement.disputed', { settlementId, disputeId: dispute.id }, 0);
    }
    return s;
  }

  /** Check for timeout (auto-open dispute). */
  checkTimeout(settlementId: string, merchantTier: string, now: number = Date.now()): ManualSettlement | null {
    const s = this.settlements.get(settlementId);
    if (!s || s.state === 'confirmed' || s.state === 'disputed' || s.state === 'timed_out') return null;
    if (now < s.deadline) return null;
    this.transition(s, 'timed_out', 'timeout', 'Manual settlement timed out');
    // Auto-open dispute
    const dispute = disputeEngine.open(s.escrowId, s.merchantId, merchantTier, 'Settlement timeout');
    if (dispute) {
      s.disputeId = dispute.id;
      disputeEngine.adjudicate(dispute.id, false, 'settlement_timeout');
    }
    eventEngine.emit('manual_settlement.timed_out', { settlementId, disputeId: s.disputeId }, 0);
    return s;
  }

  get(settlementId: string): ManualSettlement | undefined { return this.settlements.get(settlementId); }
  byTransaction(transactionId: string): ManualSettlement | undefined { return this.all().find((s) => s.transactionId === transactionId); }
  all(): ManualSettlement[] { return [...this.settlements.values()]; }
  active(): ManualSettlement[] { return this.all().filter((s) => s.state !== 'confirmed' && s.state !== 'disputed' && s.state !== 'timed_out'); }

  reset(): void { this.settlements.clear(); }

  private transition(s: ManualSettlement, toState: ManualSettlementState, action: string, reason: string): void {
    const fromState = s.state;
    s.state = toState;
    s.history.push({ from: fromState, to: toState, action, ts: Date.now(), reason });
  }
}

export const manualSettlementEngine = new ManualSettlementEngine();
