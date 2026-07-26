import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORT_ROLES = new Set(['SUPPORT', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/support/webhooks/replay
 *
 * Re-send a previously recorded webhook delivery. Looks up the source
 * delivery, resolves its endpoint, then writes a new WebhookDelivery row
 * that records the replay attempt (status, response code, body).
 *
 * Body: { deliveryId: string }
 * Returns: { delivery: WebhookDelivery }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => SUPPORT_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const deliveryId =
    typeof body?.deliveryId === 'string' ? body.deliveryId.trim() : '';
  if (!deliveryId) {
    return NextResponse.json(
      { error: 'deliveryId is required' },
      { status: 400 },
    );
  }

  const source = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!source) {
    return NextResponse.json(
      { error: 'Webhook delivery not found' },
      { status: 404 },
    );
  }
  if (!source.endpoint) {
    return NextResponse.json(
      { error: 'Webhook endpoint no longer exists' },
      { status: 409 },
    );
  }

  // Simulate the actual re-send. In production this would issue an HTTP POST
  // to `source.endpoint.url` with the same payload + signature. In this
  // sandbox we sample the outcome so dashboards see both successes and
  // failures — mirroring the in-memory webhookEngine's behaviour.
  const success = Math.random() > 0.1;
  const responseStatus = success ? 200 : 503;
  const responseBody = success ? 'OK' : 'Service Unavailable';

  // Reuse the source signature (same payload → same HMAC). The new delivery
  // gets a fresh id and its own created/delivered timestamps so the audit
  // trail distinguishes it from the original send.
  const replay = await db.webhookDelivery.create({
    data: {
      endpointId: source.endpointId,
      eventType: source.eventType,
      payload: source.payload,
      signature: source.signature,
      status: success ? 'DELIVERED' : 'FAILED',
      attempts: 1,
      responseStatus,
      responseBody,
      deliveredAt: new Date(),
      nextRetryAt: null,
    },
  });

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'SUPPORT.WEBHOOK_REPLAY',
        resourceType: 'WebhookDelivery',
        resourceId: replay.id,
        result: success ? 'SUCCESS' : 'FAILURE',
        details: JSON.stringify({
          sourceDeliveryId: source.id,
          endpointId: source.endpointId,
          endpointUrl: source.endpoint.url,
          eventType: source.eventType,
          responseStatus,
          replayRequestId: randomUUID(),
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ delivery: replay }, { status: 201 });
}
