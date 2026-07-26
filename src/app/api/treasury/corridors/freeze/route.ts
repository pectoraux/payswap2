import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TREASURY_ROLES = new Set(['TREASURY', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/treasury/corridors/freeze
 *
 * Freeze or resume a settlement corridor. Body:
 *   { corridor: string, action: 'freeze' | 'resume', reason?: string }
 *
 * Auth: TREASURY, ADMIN or SUPER_ADMIN.
 *
 * The freeze/resume state is persisted as AuditLog entries — the latest entry
 * for a given corridor determines the current state. This keeps the source of
 * truth in PostgreSQL and avoids any in-memory coupling.
 *
 *   action='freeze' → AuditLog action='TREASURY.CORRIDOR_FREEZE'
 *   action='resume' → AuditLog action='TREASURY.CORRIDOR_RESUME'
 *
 * Both entries carry `details: { corridor, reason, actorEmail }` so the
 * full freeze history is reconstructable from the audit trail.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => TREASURY_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const corridor =
    typeof body?.corridor === 'string' ? body.corridor.trim() : '';
  if (!corridor || corridor.length > 64) {
    return NextResponse.json(
      { error: 'corridor must be a non-empty string (max 64 chars)' },
      { status: 400 },
    );
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
  if (action !== 'freeze' && action !== 'resume') {
    return NextResponse.json(
      { error: "action must be 'freeze' or 'resume'" },
      { status: 400 },
    );
  }

  const reason =
    typeof body?.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : null;
  if (action === 'freeze' && !reason) {
    return NextResponse.json(
      { error: 'reason is required when freezing a corridor' },
      { status: 400 },
    );
  }

  const auditAction =
    action === 'freeze'
      ? 'TREASURY.CORRIDOR_FREEZE'
      : 'TREASURY.CORRIDOR_RESUME';

  const log = await db.auditLog.create({
    data: {
      userId: userId ?? null,
      action: auditAction,
      resourceType: 'corridor',
      resourceId: corridor,
      result: 'SUCCESS',
      details: JSON.stringify({
        corridor,
        action,
        reason,
        actorEmail: actorEmail ?? null,
      }),
    },
  });

  return NextResponse.json({
    corridor,
    action,
    active: action === 'freeze',
    auditLogId: log.id,
    createdAt: log.createdAt,
  });
}
