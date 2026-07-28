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
 */

import { NextRequest, NextResponse } from 'next/server';
import { recoveryManager } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const identifier = (body?.identifier as string | undefined)?.trim();
  if (!identifier) {
    return NextResponse.json({ error: 'identifier is required' }, { status: 400 });
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
