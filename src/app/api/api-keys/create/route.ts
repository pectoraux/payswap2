import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SCOPES = new Set([
  'payments:read',
  'payments:write',
  'payouts:read',
  'payouts:write',
  'webhooks:read',
]);

/** SHA-256 hex hash of the plain key — what we store. */
function hashKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** Generate `psk_live_` + 32 bytes of random hex. */
function generateKey(): string {
  return `psk_live_${randomBytes(32).toString('hex')}`;
}

/**
 * POST /api/api-keys/create
 *
 * Create a new API key for the authenticated merchant. The plain key is
 * returned ONCE in the response; only the SHA-256 hash + a short prefix are
 * persisted. Scopes are validated against an allow-list.
 *
 * Body:
 *   { label, scopes: string[] }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 64)
      : '';
  if (!label) {
    return NextResponse.json({ error: 'Label is required' }, { status: 400 });
  }

  const requestedScopes = Array.isArray(body.scopes) ? body.scopes : [];
  const scopes = Array.from(
    new Set(
      requestedScopes
        .filter((s: unknown): s is string => typeof s === 'string')
        .filter((s: string) => ALLOWED_SCOPES.has(s)),
    ),
  );
  if (scopes.length === 0) {
    return NextResponse.json(
      { error: 'At least one valid scope is required' },
      { status: 400 },
    );
  }

  const plainKey = generateKey();
  const keyPrefix = plainKey.slice(0, 12); // `psk_live_xxxx`
  const keyHash = hashKey(plainKey);

  const apiKey = await db.apiKey.create({
    data: {
      merchantId,
      label,
      keyPrefix,
      keyHash,
      scopes: scopes.join(','),
      status: 'ACTIVE',
      environment: env,
    },
  });

  return NextResponse.json(
    {
      apiKey: {
        id: apiKey.id,
        label: apiKey.label,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        status: apiKey.status,
        createdAt: apiKey.createdAt,
      },
      // Returned ONCE — the merchant must copy this now.
      key: plainKey,
    },
    { status: 201 },
  );
}
