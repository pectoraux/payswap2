/**
 * PaymentProjection — rebuilds the payments read model from the Domain Event
 * stream. (M-RT-18, recreated for M-RT-19.)
 */

import type { StoredEvent } from '../../events';
import type { Projection } from '../../read-models';
import type {
  PaymentView,
  PaymentListOptions,
  PaymentRecordedPayload,
  PaymentCompletedPayload,
  PaymentFailedPayload,
  PaymentRefundedPayload,
} from './types';
import { PAYMENT_EVENT_PREFIXES } from './types';

export class PaymentProjection implements Projection {
  readonly name = 'payments';
  readonly handles = [...PAYMENT_EVENT_PREFIXES];

  private readonly byId = new Map<string, PaymentView>();
  private readonly byMerchant = new Map<string, string[]>();
  private lastPosition = -1;
  private eventsAppliedCount = 0;
  private lastReplayMs: number | null = null;

  async apply(events: StoredEvent[]): Promise<void> {
    for (const ev of events) {
      this.applyOne(ev);
      this.eventsAppliedCount++;
    }
    if (events.length > 0) {
      this.lastPosition = events[events.length - 1].globalPosition;
    }
  }

  async rebuild(allEvents: StoredEvent[]): Promise<void> {
    const start = Date.now();
    this.byId.clear();
    this.byMerchant.clear();
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

  list(merchantId: string, opts?: PaymentListOptions): PaymentView[] {
    const ids = this.byMerchant.get(merchantId) ?? [];
    let views = ids.map((id) => this.byId.get(id)!).filter(Boolean);
    if (opts?.status) {
      views = views.filter((p) => p.status === opts.status);
    }
    views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const skip = opts?.skip ?? 0;
    const take = opts?.take ?? 50;
    return views.slice(skip, skip + take);
  }

  count(merchantId: string, status?: string): number {
    const ids = this.byMerchant.get(merchantId) ?? [];
    if (!status) return ids.length;
    return ids.map((id) => this.byId.get(id)!).filter((p) => p?.status === status).length;
  }

  aggregateVolume(merchantId: string): number {
    const ids = this.byMerchant.get(merchantId) ?? [];
    return ids
      .map((id) => this.byId.get(id)!)
      .reduce((sum, p) => (p?.status === 'COMPLETED' ? sum + p.amount : sum), 0);
  }

  get(paymentId: string): PaymentView | null {
    return this.byId.get(paymentId) ?? null;
  }

  totalAll(): number {
    return this.byId.size;
  }

  eventsApplied(): number {
    return this.eventsAppliedCount;
  }

  lastReplayDurationMs(): number | null {
    return this.lastReplayMs;
  }

  private applyOne(event: StoredEvent): void {
    switch (event.type) {
      case 'payment.recorded':
        this.applyRecorded(event);
        break;
      case 'payment.completed':
        this.applyCompleted(event);
        break;
      case 'payment.failed':
        this.applyFailed(event);
        break;
      case 'payment.refunded':
        this.applyRefunded(event);
        break;
      default:
        return;
    }
  }

  private applyRecorded(event: StoredEvent): void {
    const payload = event.payload as unknown as PaymentRecordedPayload;
    if (this.byId.has(payload.paymentId)) return;
    const view: PaymentView = {
      id: payload.paymentId,
      reference: payload.reference ?? payload.paymentId.slice(0, 12),
      amount: payload.amount,
      currency: payload.currency,
      status: payload.status,
      method: payload.method ?? '—',
      corridor: payload.corridor ?? '—',
      fee: payload.fee,
      netAmount: payload.netAmount,
      createdAt: new Date(payload.createdAt),
      settledAt: payload.settledAt ? new Date(payload.settledAt) : null,
      customerName: null,
      customerEmail: null,
      description: payload.description ?? null,
    };
    this.byId.set(payload.paymentId, view);
    const list = this.byMerchant.get(payload.merchantId) ?? [];
    list.push(payload.paymentId);
    this.byMerchant.set(payload.merchantId, list);
  }

  private applyCompleted(event: StoredEvent): void {
    const payload = event.payload as unknown as PaymentCompletedPayload;
    const existing = this.byId.get(payload.paymentId);
    if (!existing) return;
    this.byId.set(payload.paymentId, {
      ...existing,
      status: 'COMPLETED',
      settledAt: new Date(event.metadata.timestamp),
    });
  }

  private applyFailed(event: StoredEvent): void {
    const payload = event.payload as unknown as PaymentFailedPayload;
    const existing = this.byId.get(payload.paymentId);
    if (!existing) return;
    this.byId.set(payload.paymentId, { ...existing, status: 'FAILED' });
  }

  private applyRefunded(event: StoredEvent): void {
    const payload = event.payload as unknown as PaymentRefundedPayload;
    const existing = this.byId.get(payload.paymentId);
    if (!existing) return;
    this.byId.set(payload.paymentId, { ...existing, status: 'REFUNDED' });
  }
}
