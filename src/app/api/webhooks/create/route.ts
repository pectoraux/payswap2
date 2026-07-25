import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_EVENTS = new Set([
  'payment.created',
  'payment.completed',
  'payment.failed',
  'payout.completed',
]);

/** SHA-256 hash of the plain secret — what we store. */
function hashSecret(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** Generate `wh_sec_` + 32 bytes of random hex. */
function generateSecret(): string {
  return `wh_sec_${randomBytes(32).toString('hex')}`;
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * POST /api/webhooks/create
 *
 * Register a new webhook endpoint for the authenticated merchant. The
 * signing secret is returned ONCE; only the SHA-256 hash is persisted.
 *
 * Body:
 *   { url, events: string[] }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const url =
    typeof body.url === 'string' && body.url.trim() ? body.url.trim() : '';
  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }
  if (!isValidUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const requestedEvents = Array.isArray(body.events) ? body.events : [];
  const events = Array.from(
    new Set(
      requestedEvents
        .filter((e: unknown): e is string => typeof e === 'string')
        .filter((e: string) => ALLOWED_EVENTS.has(e)),
    ),
  );
  if (events.length === 0) {
    return NextResponse.json(
      { error: 'At least one valid event is required' },
      { status: 400 },
    );
  }

  const plainSecret = generateSecret();
  const secretHash = hashSecret(plainSecret);

  const endpoint = await db.webhookEndpoint.create({
    data: {
      merchantId,
      url,
      secretHash,
      events: events.join(','),
      status: 'ACTIVE',
    },
  });

  return NextResponse.json(
    {
      endpoint: {
        id: endpoint.id,
        url: endpoint.url,
        events: endpoint.events,
        status: endpoint.status,
        createdAt: endpoint.createdAt,
      },
      // Returned ONCE — the merchant must copy this now.
      secret: plainSecret,
    },
    { status: 201 },
  );
}
