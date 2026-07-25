import { NextRequest, NextResponse } from 'next/server';
import { emergencyFreezeEngine } from '@/protocol/treasury-v2';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/treasury/freeze — emergency freeze (admin only).
 *
 * Auth posture:
 *   - No session → 401 Unauthorized
 *   - Session but not ADMIN/SUPER_ADMIN → 403 Forbidden
 *
 * Body: { scope: 'account'|'asset'|'corridor'; target; reason; initiatedBy; durationMs? }
 */
export async function POST(req: NextRequest) {
  // 1. Must be authenticated.
  const session = await requireSession();
  if (!session) return unauthorized();

  // 2. Must hold an admin role.
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const body = await req.json();
  const { scope, target, reason, initiatedBy, durationMs } = body;
  let result;
  if (scope === 'account') result = emergencyFreezeEngine.freezeAccount(target, reason, initiatedBy, durationMs);
  else if (scope === 'asset') result = emergencyFreezeEngine.freezeAsset(target, reason, initiatedBy);
  else if (scope === 'corridor') result = emergencyFreezeEngine.freezeCorridor({ from: target.from, to: target.to }, reason, initiatedBy);
  else return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  return NextResponse.json({ freeze: result });
}

/** GET /api/treasury/freeze — list active freezes (admin only). */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  return NextResponse.json({ freezes: emergencyFreezeEngine.active() });
}
