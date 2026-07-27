/**
 * RefundProjection — rebuilds the refunds read model from the Domain Event
 * stream. (M-RT-19, Capability Migration: Refunds.)
 *
 * Same projection discipline as PaymentProjection (M-RT-18):
 *   - Implements the `Projection` interface (subscribes to live events).
 *   - Pure `rebuild(events)` from the global log.
 *   - Idempotent `applyRequested` (no-op if refundId already exists).
 *   - Later events (approved/rejected/executed/failed) patch status only —
 *     immutable financial facts (merchantId/paymentId/amount/type/createdAt)
 *     never change after creation.
 *
 * EVENTS HANDLED:
 *   - refund.requested  — creates the row (backfill / legacy import)
 *   - refund.approved   — status: PENDING → APPROVED, sets approvedBy
 *   - refund.rejected   — status: PENDING → REJECTED, sets approvedBy + reason
 *   - refund.executed   — status: APPROVED → PROCESSED, sets processedAt
 *   - refund.failed     — status: → FAILED, sets reason
 *
 * INDEXES:
 *   - byId:       Map<refundId, RefundView>          (primary)
 *   - byMerchant: Map<merchantId, refundId[]>        (per-merchant queries)
 *   - byPayment:  Map<paymentId, refundId[]>         (per-payment queries)
 */

import type { StoredEvent } from '../../events';
import type { Projection } from '../../read-models';
import type {
  RefundView,
  RefundListOptions,
  RefundRequestedPayload,
  RefundApprovedPayload,
  RefundRejectedPayload,
  RefundExecutedPayload,
  RefundFailedPayload,
} from './types';
import { REFUND_EVENT_PREFIXES } from './types';

/**
 * RefundProjection — derives RefundView[] from events.
 *
 * Two faces:
 *   1. As a `Projection`: receives live `apply()` calls from ProjectionRunner.
 *   2. As a pure query: `list(merchantId)`, `count(merchantId)`, etc.
 */
export class RefundProjection implements Projection {
  readonly name = 'refunds';
  readonly handles = [...REFUND_EVENT_PREFIXES];

  /** Primary store: refundId → RefundView. */
  private readonly byId = new Map<string, RefundView>();
  /** Secondary index: merchantId → refundId[] (insertion order). */
  private readonly byMerchant = new Map<string, string[]>();
  /** Secondary index: paymentId → refundId[] (insertion order). */
  private readonly byPayment = new Map<string, string[]>();
  /** Last global position processed (for checkpoint + rebuild). */
  private lastPosition = -1;
  /** Total events applied (for health metrics). */
  private eventsAppliedCount = 0;
  /** Last rebuild duration (for health metrics). */
  private lastReplayMs: number | null = null;

  // ── Projection interface (called by ProjectionRunner) ───────────────────

  /** Apply a batch of newly-appended refund events (live). */
  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) {
      this.lastPosition = events[events.length - 1].globalPosition;
    }
  }

  /** Wipe + rebuild from the global log (admin/ops only). */
  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    const start = Date.now();
    this.byId.clear();
    this.byMerchant.clear();
    this.byPayment.clear();
    this.lastPosition = -1;
    this.eventsAppliedCount = 0;
    for (const ev of allEvents) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (allEvents.length > 0) {
      this.lastPosition = allEvents[allEvents.length - 1].globalPosition;
    }
    this.lastReplayMs = Date.now() - start;
  }

  checkpoint(): number {
    return this.lastPosition;
  }

  // ── Pure query methods (called by RefundsService) ───────────────────────

  /** List refunds for a merchant, newest first, with optional pagination. */
  list(merchantId: string, opts?: RefundListOptions): RefundView[] {
    const ids = this.byMerchant.get(merchantId) ?? [];
    let views = ids.map((id) => this.byId.get(id)!).filter(Boolean);
    if (opts?.status) {
      views = views.filter((r) => r.status === opts.status);
    }
    if (opts?.paymentId) {
      views = views.filter((r) => r.paymentId === opts.paymentId);
    }
    // newest first
    views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const skip = opts?.skip ?? 0;
    const take = opts?.take ?? 100;
    return views.slice(skip, skip + take);
  }

  /** List refunds for a payment (any merchant). */
  listByPayment(paymentId: string): RefundView[] {
    const ids = this.byPayment.get(paymentId) ?? [];
    return ids.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  /** Total refund count for a merchant (optionally filtered by status). */
  count(merchantId: string, status?: string): number {
    const ids = this.byMerchant.get(merchantId) ?? [];
    if (!status) return ids.length;
    return ids
      .map((id) => this.byId.get(id)!)
      .filter((r) => r?.status === status).length;
  }

  /** Sum of APPROVED + PROCESSED refund amounts for a merchant. */
  aggregateAmount(merchantId: string): number {
    const ids = this.byMerchant.get(merchantId) ?? [];
    return ids
      .map((id) => this.byId.get(id)!)
      .reduce(
        (sum, r) =>
          r && (r.status === 'APPROVED' || r.status === 'PROCESSED')
            ? sum + r.amount
            : sum,
        0,
      );
  }

  /** Count of PENDING refunds for a merchant. */
  pendingCount(merchantId: string): number {
    return this.count(merchantId, 'PENDING');
  }

  /** Get a single refund by ID (or null if not in projection). */
  get(refundId: string): RefundView | null {
    return this.byId.get(refundId) ?? null;
  }

  /** Total refunds across all merchants (admin view). */
  totalAll(): number {
    return this.byId.size;
  }

  /** Total events applied (for health metrics). */
  eventsApplied(): number {
    return this.eventsAppliedCount;
  }

  /** Last rebuild duration (for health metrics). */
  lastReplayDurationMs(): number | null {
    return this.lastReplayMs;
  }

  // ── Internal: apply one event (pure, but mutates internal state) ────────

  private applyOne(event: StoredEvent): void {
    switch (event.type) {
      case 'refund.requested':
        this.applyRequested(event);
        break;
      case 'refund.approved':
        this.applyApproved(event);
        break;
      case 'refund.rejected':
        this.applyRejected(event);
        break;
      case 'refund.executed':
        this.applyExecuted(event);
        break;
      case 'refund.failed':
        this.applyFailed(event);
        break;
      default:
        // Not a refund event — ignore (rebuild() sees the full log).
        return;
    }
  }

  private applyRequested(event: StoredEvent): void {
    const payload = event.payload as unknown as RefundRequestedPayload;
    if (this.byId.has(payload.refundId)) {
      // Idempotent: re-publish is a no-op.
      return;
    }
    const view: RefundView = {
      id: payload.refundId,
      merchantId: payload.merchantId,
      paymentId: payload.paymentId,
      amount: payload.amount,
      type: payload.type,
      reason: payload.reason,
      status: payload.status,
      requestedBy: payload.requestedBy,
      approvedBy: null,
      processedAt: null,
      createdAt: new Date(payload.createdAt),
      environment: payload.environment,
    };
    this.byId.set(payload.refundId, view);
    // Update byMerchant index.
    const mList = this.byMerchant.get(payload.merchantId) ?? [];
    mList.push(payload.refundId);
    this.byMerchant.set(payload.merchantId, mList);
    // Update byPayment index.
    const pList = this.byPayment.get(payload.paymentId) ?? [];
    pList.push(payload.refundId);
    this.byPayment.set(payload.paymentId, pList);
  }

  private applyApproved(event: StoredEvent): void {
    const payload = event.payload as unknown as RefundApprovedPayload;
    const existing = this.byId.get(payload.refundId);
    if (!existing) return;
    this.byId.set(payload.refundId, {
      ...existing,
      status: 'APPROVED',
      approvedBy: payload.approvedBy,
    });
  }

  private applyRejected(event: StoredEvent): void {
    const payload = event.payload as unknown as RefundRejectedPayload;
    const existing = this.byId.get(payload.refundId);
    if (!existing) return;
    this.byId.set(payload.refundId, {
      ...existing,
      status: 'REJECTED',
      approvedBy: payload.rejectedBy,
    });
  }

  private applyExecuted(event: StoredEvent): void {
    const payload = event.payload as unknown as RefundExecutedPayload;
    const existing = this.byId.get(payload.refundId);
    if (!existing) return;
    this.byId.set(payload.refundId, {
      ...existing,
      status: 'PROCESSED',
      processedAt: new Date(payload.executedAt),
    });
  }

  private applyFailed(event: StoredEvent): void {
    const payload = event.payload as unknown as RefundFailedPayload;
    const existing = this.byId.get(payload.refundId);
    if (!existing) return;
    this.byId.set(payload.refundId, {
      ...existing,
      status: 'FAILED',
    });
  }
}
