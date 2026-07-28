import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SCOPES = new Set([
  'read:payments',
  'write:payments',
  'read:payouts',
  'write:payouts',
  'read:customers',
  'write:customers',
  'read:webhooks',
  'write:webhooks',
  'admin',
]);

/** SHA-256 hex hash of the plain key — what we store. */
function hashKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** Generate a key with the given prefix. */
function generateKey(env: 'test' | 'live'): string {
  const prefix = env === 'test' ? 'sk_test_' : 'sk_live_';
  return `${prefix}${randomBytes(32).toString('hex')}`;
}

/**
 * GET /api/developer/api-keys
 *
 * List the developer's API keys (both test and live).
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
      return NextResponse.json({ ok: true, apiKeys: [] });
    }
    const keys = await db.apiKey.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      ok: true,
      apiKeys: keys.map((k) => ({
        id: k.id,
        label: k.label,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        status: k.status,
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        createdAt: k.createdAt.toISOString(),
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
      })),
    });
  } catch (err) {
    console.error('[api/developer/api-keys GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/developer/api-keys
 *
 * Create a new API key. The plain key is returned ONCE in the response;
 * only the SHA-256 hash + a short prefix are persisted.
 *
 * Body: { label: string, scopes: string[], environment: 'test' | 'live' }
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

  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 64)
      : '';
  if (!label) {
    return NextResponse.json({ ok: false, error: 'Label is required' }, { status: 400 });
  }

  const env: 'test' | 'live' =
    body.environment === 'live' ? 'live' : 'test';

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
      { ok: false, error: 'At least one valid scope is required' },
      { status: 400 },
    );
  }

  try {
    const merchantId = await resolveDeveloperMerchantId(userId);
    if (!merchantId) {
      return NextResponse.json(
        { ok: false, error: 'No merchant available — cannot create API key' },
        { status: 400 },
      );
    }

    const plainKey = generateKey(env);
    const keyPrefix = plainKey.slice(0, 16); // `sk_test_xxxxxxxx` / `sk_live_xxxxxxxx`
    const keyHash = hashKey(plainKey);

    const apiKey = await db.apiKey.create({
      data: {
        merchantId,
        label,
        keyPrefix,
        keyHash,
        scopes: JSON.stringify(scopes),
        status: 'ACTIVE',
      },
    });

    return NextResponse.json(
      {
        ok: true,
        apiKey: {
          id: apiKey.id,
          label: apiKey.label,
          keyPrefix: apiKey.keyPrefix,
          scopes: apiKey.scopes,
          status: apiKey.status,
          environment: env,
          createdAt: apiKey.createdAt.toISOString(),
        },
        // Returned ONCE — the developer must copy this now.
        key: plainKey,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[api/developer/api-keys POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
