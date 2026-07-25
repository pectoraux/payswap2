/**
 * PaySwap Protocol — Merchant Platform (v2) — Refunds.
 *
 * Refund management with approval workflow, per-payment cumulative tracking,
 * and partial-refund support.
 *
 * Lifecycle:
 *   pending   → approved  (approver approves; or auto-approved if below threshold)
 *   pending   → rejected  (approver rejects)
 *   approved  → processed (`processRefund` executes the refund)
 *
 * Policies:
 *  - **Full refund**: refund the entire original payment amount.
 *  - **Partial refund**: refund a portion. The service tracks the total
 *    refunded per payment — cumulative partials cannot exceed the original
 *    payment amount.
 *  - **Approval threshold**: refunds whose amount exceeds the configured
 *    threshold require explicit approval; below-threshold refunds are
 *    auto-approved on submission.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `merchant.refund_requested`  — on `requestRefund`.
 *  - `merchant.refund_approved`   — on `approveRefund`.
 *  - `merchant.refund_rejected`   — on `rejectRefund`.
 *  - `merchant.refund_processed`  — on `processRefund`.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`, `round`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`.
 */
import { uid, nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import type {
  Refund,
  RefundFilter,
  RefundStatus,
  RefundType,
  TimeRange,
} from './types';

/** Default refund amount above which approval is required. */
const DEFAULT_APPROVAL_THRESHOLD = 1000;

/** Internal record of a captured payment (so refunds can validate amount). */
interface PaymentRecord {
  id: string;
  merchantId: string;
  amount: number;
  currency: string;
  capturedAt: number;
}

/** Refund statistics for a merchant over a time range. */
export interface RefundStats {
  merchantId: string;
  total: number;
  byStatus: Record<RefundStatus, number>;
  byType: Record<RefundType, number>;
  totalAmount: number;
  totalProcessedAmount: number;
  range: TimeRange;
  asOf: number;
}

/**
 * RefundService owns refund requests, the approval workflow, and the
 * per-payment cumulative-refunded ledger.
 */
export class RefundService {
  private refunds = new Map<string, Refund>();
  private payments = new Map<string, PaymentRecord>();
  /** Total refunded per payment (sum of all `processed` refunds). */
  private refundedByPayment = new Map<string, number>();
  private approvalThreshold = DEFAULT_APPROVAL_THRESHOLD;
  /**
   * Optional refund executor. Returns `true` on success, `false` on failure.
   * Defaults to always-succeed.
   */
  private refundFn: (refund: Refund) => boolean = () => true;

  /** Configure the approval threshold (amounts > threshold require approval). */
  setApprovalThreshold(amount: number): void {
    this.approvalThreshold = Math.max(0, amount);
  }

  getApprovalThreshold(): number {
    return this.approvalThreshold;
  }

  /** Inject the refund executor (production wires this to the payment engine). */
  setRefundExecutor(fn: (refund: Refund) => boolean): void {
    this.refundFn = fn;
  }

  // ---------------------------------------------------------- recordPayment
  /**
   * Register a captured payment so that subsequent refunds can be validated
   * against the original amount. Production wires this to the payment
   * engine's `payment.completed` event.
   */
  recordPayment(merchantId: string, paymentId: string, amount: number, currency: string): void {
    this.payments.set(paymentId, {
      id: paymentId,
      merchantId,
      amount: round(amount, 6),
      currency,
      capturedAt: nowTs(),
    });
  }

  getPayment(paymentId: string): PaymentRecord | undefined {
    return this.payments.get(paymentId);
  }

  /** Total amount already refunded against a payment (sum of `processed`). */
  refundedForPayment(paymentId: string): number {
    return this.refundedByPayment.get(paymentId) ?? 0;
  }

  // ------------------------------------------------------------- requestRefund
  /**
   * Request a refund.
   *
   *  - `type='full'`: the `amount` parameter is ignored — the entire
   *    remaining payment amount is refunded.
   *  - `type='partial'`: the `amount` parameter is the partial amount to
   *    refund. Cumulative partials cannot exceed the original amount.
   *
   * Returns `null` if the payment is unknown or the refund would exceed the
   * original amount.
   */
  requestRefund(
    merchantId: string,
    paymentId: string,
    amount: number,
    type: RefundType,
    reason: string,
    requestedBy: string,
  ): Refund | null {
    const payment = this.payments.get(paymentId);
    if (!payment || payment.merchantId !== merchantId) return null;

    let refundAmount: number;
    if (type === 'full') {
      refundAmount = round(payment.amount - this.refundedForPayment(paymentId), 6);
      if (refundAmount <= 0) return null; // already fully refunded
    } else {
      refundAmount = round(amount, 6);
      if (refundAmount <= 0) return null;
      const already = this.refundedForPayment(paymentId);
      if (already + refundAmount > payment.amount) {
        return null; // would exceed original
      }
    }

    const now = nowTs();
    const requiresApproval = refundAmount > this.approvalThreshold;
    const refund: Refund = {
      id: uid('rfnd'),
      merchantId,
      paymentId,
      amount: refundAmount,
      currency: payment.currency,
      type,
      reason,
      status: requiresApproval ? 'pending' : 'approved',
      requestedAt: now,
      requestedBy,
    };

    // If auto-approved, immediately attempt to process.
    if (!requiresApproval) {
      refund.processedAt = now;
      const ok = this.refundFn(refund);
      if (ok) {
        refund.status = 'processed';
        this.refundedByPayment.set(
          paymentId,
          round(this.refundedForPayment(paymentId) + refundAmount, 6),
        );
        eventEngine.emit('merchant.refund_processed', {
          merchantId,
          refundId: refund.id,
          paymentId,
          amount: refundAmount,
          currency: refund.currency,
          type,
          autoApproved: true,
        });
      } else {
        // Refund execution failed — keep as 'approved' so a retry can pick it up.
        refund.status = 'approved';
      }
    }

    this.refunds.set(refund.id, refund);
    eventEngine.emit('merchant.refund_requested', {
      merchantId,
      refundId: refund.id,
      paymentId,
      amount: refundAmount,
      currency: refund.currency,
      type,
      reason,
      requestedBy,
      requiresApproval,
      status: refund.status,
    });
    return refund;
  }

  // ------------------------------------------------------------- approveRefund
  approveRefund(refundId: string, approverId: string): Refund | null {
    const r = this.refunds.get(refundId);
    if (!r || r.status !== 'pending') return null;
    r.status = 'approved';
    r.approverId = approverId;
    eventEngine.emit('merchant.refund_approved', {
      merchantId: r.merchantId,
      refundId: r.id,
      approverId,
      amount: r.amount,
    });
    return r;
  }

  // -------------------------------------------------------------- rejectRefund
  rejectRefund(refundId: string, approverId: string, reason: string): Refund | null {
    const r = this.refunds.get(refundId);
    if (!r || r.status !== 'pending') return null;
    r.status = 'rejected';
    r.approverId = approverId;
    r.rejectionReason = reason;
    r.processedAt = nowTs();
    eventEngine.emit('merchant.refund_rejected', {
      merchantId: r.merchantId,
      refundId: r.id,
      approverId,
      reason,
    });
    return r;
  }

  // -------------------------------------------------------------- processRefund
  /**
   * Execute the refund. Only allowed for `approved` refunds. Returns the
   * updated refund (status `processed` on success, stays `approved` on
   * failure) or `null` if the refund is missing or not in `approved` state.
   */
  processRefund(refundId: string): Refund | null {
    const r = this.refunds.get(refundId);
    if (!r || r.status !== 'approved') return null;

    // Re-validate cumulative cap (defensive: payment may have been refunded
    // by another refund in the meantime).
    const payment = this.payments.get(r.paymentId);
    if (payment) {
      const already = this.refundedForPayment(r.paymentId);
      if (already + r.amount > payment.amount) {
        return null;
      }
    }

    const ok = this.refundFn(r);
    if (!ok) return r; // stays approved; caller can retry
    r.status = 'processed';
    r.processedAt = nowTs();
    this.refundedByPayment.set(
      r.paymentId,
      round(this.refundedForPayment(r.paymentId) + r.amount, 6),
    );
    eventEngine.emit('merchant.refund_processed', {
      merchantId: r.merchantId,
      refundId: r.id,
      paymentId: r.paymentId,
      amount: r.amount,
      currency: r.currency,
      type: r.type,
      autoApproved: false,
    });
    return r;
  }

  // -------------------------------------------------------------------- getters
  getRefund(id: string): Refund | undefined {
    return this.refunds.get(id);
  }

  listRefunds(merchantId: string, filter?: RefundFilter): Refund[] {
    let list = [...this.refunds.values()].filter((r) => r.merchantId === merchantId);
    if (filter) {
      if (filter.status) list = list.filter((r) => r.status === filter.status);
      if (filter.type) list = list.filter((r) => r.type === filter.type);
      if (filter.paymentId) list = list.filter((r) => r.paymentId === filter.paymentId);
      if (typeof filter.from === 'number') list = list.filter((r) => r.requestedAt >= filter.from!);
      if (typeof filter.to === 'number') list = list.filter((r) => r.requestedAt <= filter.to!);
    }
    return list.sort((a, b) => b.requestedAt - a.requestedAt);
  }

  // -------------------------------------------------------------- getRefundStats
  getRefundStats(merchantId: string, range?: TimeRange): RefundStats {
    const list = this.listRefunds(merchantId, range ?? {});
    const byStatus: Record<RefundStatus, number> = {
      pending: 0,
      approved: 0,
      processed: 0,
      rejected: 0,
    };
    const byType: Record<RefundType, number> = { full: 0, partial: 0 };
    let totalAmount = 0;
    let totalProcessedAmount = 0;
    for (const r of list) {
      byStatus[r.status] += 1;
      byType[r.type] += 1;
      totalAmount += r.amount;
      if (r.status === 'processed') totalProcessedAmount += r.amount;
    }
    return {
      merchantId,
      total: list.length,
      byStatus,
      byType,
      totalAmount: round(totalAmount, 6),
      totalProcessedAmount: round(totalProcessedAmount, 6),
      range: range ?? {},
      asOf: nowTs(),
    };
  }

  all(): Refund[] {
    return [...this.refunds.values()];
  }

  // --------------------------------------------------------------------- reset
  reset(): void {
    this.refunds.clear();
    this.payments.clear();
    this.refundedByPayment.clear();
    this.approvalThreshold = DEFAULT_APPROVAL_THRESHOLD;
    this.refundFn = () => true;
  }
}

// Singleton.
const _g = globalThis as unknown as { __PAYSWAP_REFUND_SERVICE?: RefundService };
export const refundService: RefundService =
  _g.__PAYSWAP_REFUND_SERVICE ?? new RefundService();
if (!_g.__PAYSWAP_REFUND_SERVICE) _g.__PAYSWAP_REFUND_SERVICE = refundService;
