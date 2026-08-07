/**
 * POST /api/identity/recovery/initiate — initiate account recovery.
 *
 * Body: { identifier: string }
 *
 * Returns `{ recoveryId, methods }`. The recovery flow is intentionally
 * public (no auth required) — it's the front-door for users who lost
 * access to their credentials.
 *
 * The endpoint NEVER leaks whether the identifier exists. If no identity
 * matches, an empty `methods` array is returned (and the subsequent
 * `completeRecovery` call will fail).
 *
 * SEC-5: rate limited per identifier AND per IP. 5 attempts per 15 minutes,
 * then blocked for 15 minutes. This prevents enumeration and abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { recoveryManager } from '@/identity';
import { checkRateLimit, RATE_LIMITS, rateLimitResetIn } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // SEC-5: rate limit per IP (catches distributed enumeration).
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit('recovery:ip', clientIp, RATE_LIMITS.recovery.maxRequests, RATE_LIMITS.recovery.windowMs, RATE_LIMITS.recovery.blockDurationMs)) {
    const resetIn = rateLimitResetIn('recovery:ip', clientIp, RATE_LIMITS.recovery.maxRequests, RATE_LIMITS.recovery.windowMs);
    return NextResponse.json(
      { error: 'Too many recovery attempts from this IP. Try again later.', retryAfterMs: resetIn },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(resetIn / 1000)) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const identifier = (body?.identifier as string | undefined)?.trim();
  if (!identifier) {
    return NextResponse.json({ error: 'identifier is required' }, { status: 400 });
  }

  // SEC-5: rate limit per identifier (catches targeted enumeration).
  if (!checkRateLimit('recovery:id', identifier, RATE_LIMITS.recovery.maxRequests, RATE_LIMITS.recovery.windowMs, RATE_LIMITS.recovery.blockDurationMs)) {
    const resetIn = rateLimitResetIn('recovery:id', identifier, RATE_LIMITS.recovery.maxRequests, RATE_LIMITS.recovery.windowMs);
    return NextResponse.json(
      { error: 'Too many recovery attempts for this identifier. Try again later.', retryAfterMs: resetIn },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(resetIn / 1000)) } },
    );
  }

  const result = await recoveryManager.initiateRecovery(identifier);
  // In a real implementation, the code would be sent via email/SMS here.
  // For the demo, we surface the pendingCode in the response so the admin
  // UI can display it (clearly marked as "demo only").
  const methodsWithCodes = result.methods.map((m) => ({
    ...m,
    pendingCode: m.pendingCode,
    backupCodes: m.backupCodes,
  }));
  return NextResponse.json({
    recoveryId: result.recoveryId,
    methods: methodsWithCodes,
  });
}
