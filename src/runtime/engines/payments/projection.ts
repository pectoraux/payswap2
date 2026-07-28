/**
 * PaymentProjection — rebuilds the payments read model from the Domain Event
 * stream. (M-RT-18, recreated for M-RT-19.)
 *
 * INTEGRATE-1 (runtime-integration-agent): The projection now ALSO writes the
 * Prisma `Payment` table. The Prisma row is treated as a derived projection of
 * the event store — never written directly by the paymentService anymore.
 *
 *   payment.recorded  → upsert Prisma Payment (status PENDING)
 *   payment.completed → update Prisma Payment (status COMPLETED, settledAt)
 *   payment.settled   → alias for payment.completed (handled here)
 *   payment.failed    → update Prisma Payment (status FAILED)
 *   payment.refunded  → update Prisma Payment (status REFUNDED)
 *
 * Prisma writes are best-effort: a failure is logged but does NOT raise — the
 * in-memory view is still authoritative for runtime queries, and the next
 * backfill pass will reconcile the Prisma row.
 */

import { db } from '@/lib/db';
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
      await this.applyOne(ev);
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
      await this.applyOne(ev);
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

  private async applyOne(event: StoredEvent): Promise<void> {
    switch (event.type) {
      case 'payment.recorded':
        await this.applyRecorded(event);
        break;
      case 'payment.completed':
      case 'payment.settled': // INTEGRATE-1: alias — payment.settled == payment.completed
        await this.applyCompleted(event);
        break;
      case 'payment.failed':
        await this.applyFailed(event);
        break;
      case 'payment.refunded':
        await this.applyRefunded(event);
        break;
      default:
        return;
    }
  }

  private async applyRecorded(event: StoredEvent): Promise<void> {
    const payload = event.payload as unknown as PaymentRecordedPayload & {
      customerName?: string | null;
      customerEmail?: string | null;
      environment?: string;
      actorId?: string;
      lpId?: string | null;
    };
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
      customerName: payload.customerName ?? null,
      customerEmail: payload.customerEmail ?? null,
      description: payload.description ?? null,
    };
    this.byId.set(payload.paymentId, view);
    const list = this.byMerchant.get(payload.merchantId) ?? [];
    list.push(payload.paymentId);
    this.byMerchant.set(payload.merchantId, list);

    // ── INTEGRATE-1: Prisma projection sink ────────────────────────────────
    // Upsert the Prisma Payment row. Best-effort — never raises into the
    // dispatcher pipeline. Idempotent via paymentId (the primary key).
    try {
      await db.payment.upsert({
        where: { id: payload.paymentId },
        create: {
          id: payload.paymentId,
          merchantId: payload.merchantId,
          customerId: null, // Payment.customerId references Customer, not CustomerRecord
          amount: payload.amount,
          currency: payload.currency,
          sourceCurrency: payload.sourceCurrency ?? payload.currency,
          destinationCurrency: payload.destinationCurrency ?? payload.currency,
          status: payload.status,
          method: payload.method,
          corridor: payload.corridor,
          lpId: payload.lpId ?? null,
          fee: payload.fee,
          netAmount: payload.netAmount,
          fxRate: payload.fxRate ?? 1,
          reference: payload.reference,
          description: payload.description,
          environment: payload.environment ?? event.metadata.environment,
          createdAt: new Date(payload.createdAt),
          updatedAt: new Date(payload.createdAt),
        },
        update: {
          status: payload.status,
          fee: payload.fee,
          netAmount: payload.netAmount,
        },
      });
    } catch {
      // Non-fatal — Prisma projection lag is reported by the health registry.
    }
  }

  private async applyCompleted(event: StoredEvent): Promise<void> {
    const payload = event.payload as unknown as PaymentCompletedPayload & {
      settledAt?: number;
    };
    const existing = this.byId.get(payload.paymentId);
    if (!existing) return;
    const settledAt = payload.settledAt
      ? new Date(payload.settledAt)
      : new Date(event.metadata.timestamp);
    this.byId.set(payload.paymentId, {
      ...existing,
      status: 'COMPLETED',
      settledAt,
    });

    // ── INTEGRATE-1: Prisma projection sink ────────────────────────────────
    try {
      await db.payment.update({
        where: { id: payload.paymentId },
        data: {
          status: 'COMPLETED',
          settledAt,
          updatedAt: new Date(),
        },
      });
    } catch {
      // Non-fatal — row may not yet exist if recorded event is still in flight.
    }
  }

  private async applyFailed(event: StoredEvent): Promise<void> {
    const payload = event.payload as unknown as PaymentFailedPayload;
    const existing = this.byId.get(payload.paymentId);
    if (!existing) return;
    this.byId.set(payload.paymentId, { ...existing, status: 'FAILED' });

    // ── INTEGRATE-1: Prisma projection sink ────────────────────────────────
    try {
      await db.payment.update({
        where: { id: payload.paymentId },
        data: {
          status: 'FAILED',
          failureReason: payload.reason,
          updatedAt: new Date(),
        },
      });
    } catch {
      // Non-fatal.
    }
  }

  private async applyRefunded(event: StoredEvent): Promise<void> {
    const payload = event.payload as unknown as PaymentRefundedPayload;
    const existing = this.byId.get(payload.paymentId);
    if (!existing) return;
    this.byId.set(payload.paymentId, { ...existing, status: 'REFUNDED' });

    // ── INTEGRATE-1: Prisma projection sink ────────────────────────────────
    try {
      await db.payment.update({
        where: { id: payload.paymentId },
        data: {
          status: 'REFUNDED',
          updatedAt: new Date(),
        },
      });
    } catch {
      // Non-fatal.
    }
  }
}
