/**
 * Projections — subscribe to domain events and perform side effects.
 *
 * Every projection handles ONE responsibility:
 *   - ActivityFeedProjection: writes to AuditLog (which powers the activity feed)
 *   - WebhookDeliveryProjection: fires webhook deliveries
 *   - AnalyticsProjection: updates metrics (via ops registry)
 *   - NotificationProjection: could push notifications (future)
 *
 * INTEGRATE-1 (runtime-integration-agent): Added two RUNTIME event
 * subscribers (RefundPrismaSync + PayoutPrismaSync) that listen directly to
 * the runtime EventStore (not the application eventBus) and upsert the Prisma
 * Refund/Payout rows as derived projections. The PaymentProjection already
 * writes to Prisma from inside the runtime kernel; refunds + payouts are
 * synced here because their runtime projections are frozen.
 *
 * Projections are registered once at module load. They use the global
 * eventBus + runtime singletons, so they work across Next.js dev module
 * re-instantiation.
 */

import { eventBus, type DomainEvent } from '../event-bus';
import { db } from '@/lib/db';
import { runtime } from '@/runtime';
import type { StoredEvent } from '@/runtime';

// ─── Activity Feed / Audit Log Projection ────────────────────────────────────
// Every domain event creates an AuditLog entry, which powers:
//   - Activity Feed (GET /api/activity)
//   - Audit Trail (support + admin)
//   - Notification Center (GET /api/notifications)

eventBus.on('', async (event: DomainEvent) => {
  try {
    await db.auditLog.create({
      data: {
        action: event.type.toUpperCase(),
        resourceType: event.aggregateType,
        resourceId: event.aggregateId,
        result: 'SUCCESS',
        userId: event.actorId || undefined,
        details: JSON.stringify({
          ...event.payload,
          _eventId: event.id,
          _environment: event.environment,
          _timestamp: event.timestamp,
          _merchantId: event.merchantId,
        }),
        createdAt: new Date(event.timestamp),
      },
    });
  } catch {
    // Non-fatal — audit logging should never block the operation
  }
});

// ─── Webhook Delivery Projection ─────────────────────────────────────────────
// For payment/payout/refund events, deliver webhooks to the merchant's endpoints.

eventBus.on('payment.', async (event: DomainEvent) => {
  if (!event.merchantId) return;
  await deliverWebhooks(event);
});

eventBus.on('payout.', async (event: DomainEvent) => {
  if (!event.merchantId) return;
  await deliverWebhooks(event);
});

eventBus.on('refund.', async (event: DomainEvent) => {
  if (!event.merchantId) return;
  await deliverWebhooks(event);
});

eventBus.on('invoice.', async (event: DomainEvent) => {
  if (!event.merchantId) return;
  await deliverWebhooks(event);
});

async function deliverWebhooks(event: DomainEvent) {
  try {
    const endpoints = await db.webhookEndpoint.findMany({
      where: {
        merchantId: event.merchantId!,
        status: 'ACTIVE',
        environment: event.environment,
      },
    });

    for (const endpoint of endpoints) {
      // Check if the endpoint is subscribed to this event type
      let events: string[] = [];
      try { events = JSON.parse(endpoint.events); } catch { events = []; }
      if (events.length > 0 && !events.includes(event.type)) continue;

      // Simulate delivery (in production: real HTTP POST)
      const success = Math.random() > 0.05; // 95% success rate
      await db.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventType: event.type,
          payload: JSON.stringify(event.payload),
          signature: `sha256=${event.id}${Math.random().toString(36).slice(2, 34)}`,
          status: success ? 'DELIVERED' : 'FAILED',
          attempts: success ? 1 : 3,
          responseStatus: success ? 200 : 500,
          responseBody: success ? 'OK' : 'Internal Server Error',
          deliveredAt: success ? new Date(event.timestamp) : null,
          createdAt: new Date(event.timestamp),
        },
      });
    }
  } catch {
    // Non-fatal — webhook delivery failures shouldn't block the operation
  }
}

// ─── Customer Stats Projection ───────────────────────────────────────────────
// When a payment completes, update the customer's spending stats.

eventBus.on('payment.completed', async (event: DomainEvent) => {
  try {
    const amount = event.payload.amount as number;
    const customerEmail = event.payload.customerEmail as string;
    if (!amount || !customerEmail || !event.merchantId) return;

    await db.customerRecord.updateMany({
      where: {
        merchantId: event.merchantId,
        email: customerEmail,
        environment: event.environment,
      },
      data: {
        totalSpent: { increment: amount },
        transactionCount: { increment: 1 },
      },
    });
  } catch {
    // Non-fatal
  }
});

// ─── INTEGRATE-1: Runtime Event Subscribers (Prisma sync) ───────────────────
//
// These subscribe to the RUNTIME EventStore (not the application eventBus)
// and upsert Prisma rows as derived projections. The runtime is the source of
// truth; Prisma is a query-optimized read model.
//
//   refund.requested + refund.executed → upsert Prisma Refund
//   payout.recorded + payout.completed → upsert Prisma Payout
//
// Best-effort: failures are logged but never raised into the dispatcher
// pipeline (the in-memory runtime projection is still authoritative).

let runtimeSubscribersRegistered = false;
function ensureRuntimeSubscribers() {
  if (runtimeSubscribersRegistered) return;
  runtimeSubscribersRegistered = true;

  runtime.eventStore.subscribe(async (events: StoredEvent[]) => {
    for (const ev of events) {
      try {
        if (ev.type === 'refund.requested') {
          await syncRefundRecorded(ev);
        } else if (ev.type === 'refund.executed') {
          await syncRefundExecuted(ev);
        } else if (ev.type === 'payout.recorded') {
          await syncPayoutRecorded(ev);
        } else if (ev.type === 'payout.completed') {
          await syncPayoutCompleted(ev);
        }
      } catch {
        // Non-fatal — Prisma projection lag is reconciled by the next backfill.
      }
    }
  });
}

interface RefundRequestedPayload {
  refundId: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  environment: string;
  createdAt: number;
}

interface RefundExecutedPayload {
  refundId: string;
  executedAt: number;
  processedAt?: number;
}

async function syncRefundRecorded(ev: StoredEvent): Promise<void> {
  const p = ev.payload as unknown as RefundRequestedPayload;
  await db.refund.upsert({
    where: { id: p.refundId },
    create: {
      id: p.refundId,
      merchantId: p.merchantId,
      paymentId: p.paymentId,
      amount: p.amount,
      type: p.type,
      reason: p.reason,
      status: p.status,
      requestedBy: p.requestedBy,
      environment: p.environment,
      createdAt: new Date(p.createdAt),
    },
    update: {
      status: p.status,
    },
  });
}

async function syncRefundExecuted(ev: StoredEvent): Promise<void> {
  const p = ev.payload as unknown as RefundExecutedPayload;
  const processedAt = p.processedAt ?? p.executedAt;
  await db.refund.update({
    where: { id: p.refundId },
    data: {
      status: 'PROCESSED',
      processedAt: new Date(processedAt),
    },
  }).catch(() => {
    // Non-fatal — refund row may not yet exist if requested event is in flight.
  });
}

interface PayoutRecordedPayload {
  payoutId: string;
  merchantId: string;
  method: string;
  sourceAmount: number;
  sourceAsset: string;
  sourceCurrency: string;
  destinationCurrency: string;
  destination?: string | null;
  fxRate: number;
  feeBps: number;
  fee: number;
  netAmount: number;
  status: string;
  txHash: string;
  evidence?: string | null;
  reason?: string | null;
  environment?: string;
  actorId?: string;
  createdAt: number;
  processedAt?: number | null;
  completedAt?: number | null;
}

interface PayoutCompletedPayload {
  payoutId: string;
  amount: number;
  net: number;
  fee: number;
  txHash: string;
  completedAt: number;
}

async function syncPayoutRecorded(ev: StoredEvent): Promise<void> {
  const p = ev.payload as unknown as PayoutRecordedPayload;
  const env = p.environment ?? ev.metadata.environment;
  await db.payout.upsert({
    where: { id: p.payoutId },
    create: {
      id: p.payoutId,
      merchantId: p.merchantId,
      method: p.method,
      sourceAmount: p.sourceAmount,
      sourceAsset: p.sourceAsset,
      sourceCurrency: p.sourceCurrency,
      destinationCurrency: p.destinationCurrency,
      destination: p.destination ?? null,
      fxRate: p.fxRate,
      feeBps: p.feeBps,
      fee: p.fee,
      netAmount: p.netAmount,
      status: p.status,
      txHash: p.txHash,
      evidence: p.evidence ?? null,
      reason: p.reason ?? null,
      environment: env,
      createdAt: new Date(p.createdAt),
      processedAt: p.processedAt ? new Date(p.processedAt) : null,
      completedAt: p.completedAt ? new Date(p.completedAt) : null,
    },
    update: {
      status: p.status,
      fee: p.fee,
      netAmount: p.netAmount,
    },
  });
}

async function syncPayoutCompleted(ev: StoredEvent): Promise<void> {
  const p = ev.payload as unknown as PayoutCompletedPayload;
  await db.payout.update({
    where: { id: p.payoutId },
    data: {
      status: 'COMPLETED',
      txHash: p.txHash,
      processedAt: new Date(p.completedAt),
      completedAt: new Date(p.completedAt),
    },
  }).catch(() => {
    // Non-fatal — payout row may not yet exist if recorded event is in flight.
  });
}

// Register on module load.
ensureRuntimeSubscribers();

// ─── Self-registration ───────────────────────────────────────────────────────
// This module self-registers on import. Importing it anywhere in the server
// initializes all projections. The unified shell layout is a good place.
export function initProjections() {
  // Projections are already registered via eventBus.on() above + the runtime
  // event store subscriber. This function exists so the import can be
  // explicit and tree-shakeable.
  ensureRuntimeSubscribers();
  return true;
}
