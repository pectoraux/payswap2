/**
 * Projections — subscribe to domain events and perform side effects.
 *
 * Every projection handles ONE responsibility:
 *   - ActivityFeedProjection: writes to AuditLog (which powers the activity feed)
 *   - WebhookDeliveryProjection: fires webhook deliveries
 *   - AnalyticsProjection: updates metrics (via ops registry)
 *   - NotificationProjection: could push notifications (future)
 *
 * Projections are registered once at module load. They use the global
 * eventBus singleton, so they work across Next.js dev module re-instantiation.
 */

import { eventBus, type DomainEvent } from '../event-bus';
import { db } from '@/lib/db';

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

// ─── Self-registration ───────────────────────────────────────────────────────
// This module self-registers on import. Importing it anywhere in the server
// initializes all projections. The unified shell layout is a good place.
export function initProjections() {
  // Projections are already registered via eventBus.on() above.
  // This function exists so the import can be explicit and tree-shakeable.
  return true;
}
