/**
 * Idempotency helpers for API routes. (H-2 fix — P1-4.)
 *
 * Clients can pass an `Idempotency-Key` header to safely retry requests
 * without creating duplicate transactions. The key + cached response are
 * persisted to the `IdempotencyRecord` table (unique on `key`) so the
 * dedup survives process restarts and works across instances.
 *
 * Money-out routes (payouts/create, refunds/create, wallet/{transfer,
 * deposit, withdraw}) wrap their side-effecting logic in
 * `withIdempotency()`. A second request with the same key (within the
 * TTL) returns the cached `{ status, body }` without re-running the
 * side effect.
 *
 * Rules:
 *  - Same key → return cached response (dedup).
 *  - No key → no idempotency (pass through).
 *  - Key expires after `ttlHours` (default: 24h).
 *  - DB lookup failure is fail-open (better than blocking all money
 *    movement because the dedup layer is degraded). The degradation
 *    is logged loudly so ops knows.
 *
 * Future work (OPS-1 — request-hash mismatch → 409 Conflict) is tracked
 * in the audit roadmap; the IdempotencyRecord schema already has
 * `requestHash`/`scope`/`responseStatus`/`responseBody` columns ready
 * for that upgrade.
 */

import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';

/**
 * Extract the idempotency key from the request header.
 *
 * Returns the trimmed header value, or `null` if the client did not send
 * an `Idempotency-Key` header. Callers decide how to handle the null
 * case — money-out routes skip dedup (so the route still works for
 * clients that don't send the header) and process the request as a
 * unique operation.
 *
 * (Previously this generated a fresh UUID when the header was absent,
 * which made the return value always non-null and hid from callers
 * whether the key was client-supplied or auto-generated — defeating the
 * purpose of the wrapper, since auto-generated keys are always unique
 * and would never dedup. Returning `null` makes that explicit.)
 */
export function getIdempotencyKey(req: NextRequest): string | null {
  const header = req.headers.get('idempotency-key');
  if (header && header.trim().length > 0) {
    return header.trim();
  }
  return null;
}

/**
 * Generate a fresh idempotency key (UUIDv4). Used by routes that need a
 * correlation id but don't have a client-supplied key — the value is
 * NOT used for dedup, only for tracing.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
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

/**
 * Execute `fn` with idempotency protection. If `key` has been seen before
 * (and hasn't expired), return the cached response. Otherwise, run `fn`,
 * cache the result, and return it.
 *
 * The key + response are persisted to the IdempotencyRecord table (unique
 * on `key`) so the dedup survives process restarts and works across
 * instances.
 *
 * Fail-open policy: if the DB lookup fails (e.g. transient connection
 * error), the function proceeds WITHOUT dedup. This is intentional —
 * blocking all money-movement because the dedup layer is degraded would
 * be worse than allowing a potential duplicate. The degradation is
 * logged loudly so ops knows.
 *
 * @param key       The idempotency key (from Idempotency-Key header).
 * @param route     The route path (for auditability).
 * @param fn        The function to execute. Must return a { status, body } object.
 * @param ttlHours  How long the key is cached (default: 24h).
 */
export async function withIdempotency<T>(
  key: string,
  route: string,
  fn: () => Promise<{ status: number; body: T }>,
  ttlHours: number = 24,
): Promise<{ status: number; body: T; cached: boolean }> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  // Try to find an existing record.
  try {
    const existing = await db.idempotencyRecord.findUnique({ where: { key } });
    if (existing && existing.expiresAt > new Date()) {
      return {
        status: existing.status,
        body: JSON.parse(existing.response) as T,
        cached: true,
      };
    }
  } catch {
    // If DB lookup fails, proceed without dedup (fail open — better than blocking all payments).
    // Log loudly so ops knows the dedup layer is degraded.
    console.error('[withIdempotency] DB lookup failed — proceeding WITHOUT dedup. Key:', key);
  }

  // Run the function.
  const result = await fn();

  // Cache the result (best-effort — if the insert fails due to a race,
  // another instance won the race; that's fine, we still return our result).
  try {
    await db.idempotencyRecord.upsert({
      where: { key },
      create: {
        key,
        route,
        method: 'POST',
        status: result.status,
        response: JSON.stringify(result.body),
        expiresAt,
      },
      update: {}, // don't overwrite if it already exists (race loser)
    });
  } catch {
    // Best-effort — a race condition means another instance cached it first.
  }

  return { ...result, cached: false };
}
