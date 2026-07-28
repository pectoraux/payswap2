/**
 * POST /api/identity/recovery/complete — complete account recovery.
 *
 * Body:
 *   {
 *     recoveryId: string,
 *     methodId: string,
 *     code: string
 *   }
 *
 * Returns `{ resetToken }` on success. The reset token is a one-time secret
 * the client uses to reset the identity's primary credentials.
 *
 * Public (no auth required) — this is the second step of the recovery flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { recoveryManager } from '@/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const recoveryId = (body?.recoveryId as string | undefined)?.trim();
  const methodId = (body?.methodId as string | undefined)?.trim();
  const code = (body?.code as string | undefined)?.trim();

  if (!recoveryId || !methodId || !code) {
    return NextResponse.json(
      { error: 'recoveryId, methodId, and code are required' },
      { status: 400 },
    );
  }

  try {
    const { resetToken } = await recoveryManager.completeRecovery(recoveryId, methodId, code);
    return NextResponse.json({ ok: true, resetToken });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Recovery failed' },
      { status: 400 },
    );
  }
}
