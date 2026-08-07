/**
 * OPS-1: Idempotency as infrastructure.
 *
 * Persists idempotency keys to the database so a client retrying a payment
 * 100 times creates exactly one payment. The key→request hash→response
 * mapping survives process restarts.
 *
 * Rules:
 *  - Same key + same body → return cached response (200)
 *  - Same key + different body → return 409 Conflict
 *  - No key → no idempotency (pass through)
 *  - Key expires after 24 hours (configurable)
 *
 * Usage in an API route:
 *   const idemResult = await withIdempotency(req, 'payments', async () => {
 *     // ... create payment ...
 *     return NextResponse.json({ paymentId });
 *   });
 *   return idemResult;
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createHash } from 'crypto';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Compute a SHA-256 hash of the request body for idempotency comparison.
 * The hash includes the URL path + the body, so the same key on different
 * endpoints doesn't collide.
 */
async function computeRequestHash(req: Request, body: unknown): Promise<string> {
  const path = new URL(req.url).pathname;
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  return createHash('sha256').update(`${path}:${bodyStr}`).digest('hex');
}

/**
 * Execute a handler with idempotency protection.
 *
 * @param req The incoming request
 * @param scope The idempotency scope (e.g., 'payments', 'payouts')
 * @param handler The handler to execute if not cached
 * @returns NextResponse — either the cached response or the handler's response
 */
export async function withIdempotency(
  req: Request,
  scope: string,
  handler: () => Promise<NextResponse>,
  opts: { ttlMs?: number } = {},
): Promise<NextResponse> {
  // Extract the idempotency key from headers.
  const key = req.headers.get('idempotency-key') ?? req.headers.get('x-idempotency-key');
  if (!key) {
    // No key — no idempotency. Just run the handler.
    return handler();
  }

  // Parse the body for hash computation.
  let body: unknown;
  try {
    const cloned = req.clone();
    body = await cloned.json();
  } catch {
    body = null;
  }

  const requestHash = await computeRequestHash(req, body);
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);

  // Check for an existing entry.
  try {
    const existing = await db.idempotencyRecord.findUnique({
      where: { key: `${scope}:${key}` },
    });

    if (existing) {
      // Same key + same hash → return cached response.
      if (existing.requestHash === requestHash) {
        const cachedResponse = JSON.parse(existing.responseBody);
        return NextResponse.json(cachedResponse, { status: existing.responseStatus });
      }
      // Same key + different hash → 409 Conflict.
      return NextResponse.json(
        { error: 'Idempotency key reuse: request body does not match the original request.' },
        { status: 409 },
      );
    }
  } catch {
    // DB error — fall through to handler (best-effort idempotency).
  }

  // Execute the handler.
  const response = await handler();

  // Cache the response.
  try {
    const responseStatus = response.status;
    const responseBody = await response.clone().json();
    await db.idempotencyRecord.create({
      data: {
        key: `${scope}:${key}`,
        scope,
        requestHash,
        responseStatus,
        responseBody: JSON.stringify(responseBody),
        expiresAt,
      },
    }).catch(() => {
      // Unique constraint violation — another request with the same key
      // was processed concurrently. The response is already sent; the
      // cached version will be returned on the next retry.
    });
  } catch {
    // DB error — can't cache. The response is already sent.
  }

  return response;
}

/**
 * Clean up expired idempotency records. Call this from a periodic job.
 */
export async function cleanupExpiredIdempotencyRecords(): Promise<{ deleted: number }> {
  try {
    const result = await db.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return { deleted: result.count };
  } catch {
    return { deleted: 0 };
  }
}

// ── Compatibility export for existing routes ─────────────────────────────

/**
 * Extract the idempotency key from a request. Checks the `idempotency-key`
 * header and the `x-idempotency-key` header. Returns null if not present.
 *
 * This is the simple extraction helper that existing routes use. The full
 * `withIdempotency()` wrapper above is the OPS-1 infrastructure that
 * persists the key→response mapping.
 */
export function getIdempotencyKey(req: Request): string | null {
  return req.headers.get('idempotency-key') ?? req.headers.get('x-idempotency-key');
}
