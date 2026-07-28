import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVENT_TYPES = [
  'payment.created',
  'payment.completed',
  'payment.failed',
  'payout.created',
  'payout.completed',
  'payout.failed',
  'refund.created',
  'refund.completed',
  'invoice.paid',
  'invoice.overdue',
  'customer.created',
  'extension.installed',
  'extension.uninstalled',
] as const;

/**
 * GET /api/developer/webhooks
 *
 * List the developer's webhook endpoints + recent deliveries.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    if (!merchantId) {
      return NextResponse.json({ ok: true, endpoints: [], deliveries: [] });
    }

    const endpoints = await db.webhookEndpoint.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });

    const endpointIds = endpoints.map((e) => e.id);
    const deliveries =
      endpointIds.length > 0
        ? await db.webhookDelivery.findMany({
            where: { endpointId: { in: endpointIds } },
            orderBy: { createdAt: 'desc' },
            take: 25,
          })
        : [];

    // Compute per-endpoint delivery stats.
    const stats = new Map<
      string,
      { total: number; success: number; lastDeliveryAt: Date | null }
    >();
    for (const d of deliveries) {
      const s = stats.get(d.endpointId) ?? { total: 0, success: 0, lastDeliveryAt: null };
      s.total += 1;
      if (d.status === 'DELIVERED') s.success += 1;
      if (!s.lastDeliveryAt || d.createdAt > s.lastDeliveryAt) {
        s.lastDeliveryAt = d.createdAt;
      }
      stats.set(d.endpointId, s);
    }

    return NextResponse.json({
      ok: true,
      endpoints: endpoints.map((e) => {
        const s = stats.get(e.id);
        const successRate = s && s.total > 0 ? s.success / s.total : null;
        return {
          id: e.id,
          url: e.url,
          events: e.events,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          deliveryCount: s?.total ?? 0,
          successRate,
          lastDeliveryAt: s?.lastDeliveryAt ? s.lastDeliveryAt.toISOString() : null,
        };
      }),
      deliveries: deliveries.map((d) => ({
        id: d.id,
        endpointId: d.endpointId,
        eventType: d.eventType,
        status: d.status,
        responseStatus: d.responseStatus,
        responseBody: d.responseBody,
        attempts: d.attempts,
        createdAt: d.createdAt.toISOString(),
        deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
      })),
      eventTypes: EVENT_TYPES,
    });
  } catch (err) {
    console.error('[api/developer/webhooks GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/developer/webhooks
 *
 * Register a new webhook endpoint.
 *
 * Body: { url: string, events: string[] }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return NextResponse.json({ ok: false, error: 'URL is required' }, { status: 400 });
  }
  // Validate URL.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('URL must use http(s)');
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid URL' }, { status: 400 });
  }

  const requestedEvents = Array.isArray(body.events) ? body.events : [];
  const events = Array.from(
    new Set(
      requestedEvents
        .filter((e: unknown): e is string => typeof e === 'string')
        .filter((e: string) => (EVENT_TYPES as readonly string[]).includes(e)),
    ),
  );
  if (events.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'At least one event type is required' },
      { status: 400 },
    );
  }

  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    if (!merchantId) {
      return NextResponse.json(
        { ok: false, error: 'No merchant available' },
        { status: 400 },
      );
    }

    // Generate a signing secret — stored as a hash, returned to the caller
    // once on creation (mirrors the API key pattern). For simplicity we
    // store a hash so we can verify signatures later.
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const secretHash = createHash('sha256').update(secret).digest('hex');

    const endpoint = await db.webhookEndpoint.create({
      data: {
        merchantId,
        url,
        secretHash,
        events: JSON.stringify(events),
        status: 'ACTIVE',
      },
    });

    return NextResponse.json(
      {
        ok: true,
        endpoint: {
          id: endpoint.id,
          url: endpoint.url,
          events: endpoint.events,
          status: endpoint.status,
          createdAt: endpoint.createdAt.toISOString(),
        },
        // Returned ONCE — the developer must copy this now.
        secret,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/developer/webhooks POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
