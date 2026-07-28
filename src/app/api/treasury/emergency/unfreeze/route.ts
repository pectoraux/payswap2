import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { treasuryEmergencyService } from '@/treasury/emergency-store';
import {
  requireSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TREASURY_ROLES = new Set(['TREASURY', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/treasury/emergency/unfreeze
 *
 * Lift (release) an active emergency freeze. Treasury operators can lift
 * freezes; admin role is also permitted (matches the existing freeze endpoint
 * auth posture where unfreeze is broader than freeze).
 *
 * Body: { targetId: string }
 *
 * NOTE: `targetId` here refers to the FREEZE RECORD id (not the target's
 * identifier). We use the parameter name from the task spec verbatim.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => TREASURY_ROLES.has(r))) {
    return forbidden();
  }
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const targetId = typeof body?.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId) {
    return NextResponse.json(
      { error: 'targetId (freeze record id) is required' },
      { status: 400 },
    );
  }

  // Look up the freeze record. Accept either the freeze record id directly or
  // the (target, targetId) pair if the caller passed the underlying target id.
  let freeze = treasuryEmergencyService.get(targetId);
  if (!freeze) {
    // Fall back: look up by targetId == the frozen target's identifier (any
    // active freeze on that target).
    const active = treasuryEmergencyService
      .listActive()
      .find((f) => f.targetId === targetId);
    if (active) freeze = active;
  }
  if (!freeze) {
    return NextResponse.json(
      { error: 'Freeze record not found' },
      { status: 404 },
    );
  }

  if (freeze.status !== 'active') {
    return NextResponse.json(
      {
        error: `Freeze is not active (current status: ${freeze.status})`,
        freeze,
      },
      { status: 409 },
    );
  }

  const lifted = treasuryEmergencyService.unfreeze(freeze.id, actorEmail);

  // Audit log.
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'TREASURY.EMERGENCY_UNFREEZE',
        resourceType: freeze.target,
        resourceId: freeze.targetId,
        result: 'SUCCESS',
        details: JSON.stringify({
          freezeId: freeze.id,
          target: freeze.target,
          targetId: freeze.targetId,
          originalReason: freeze.reason,
          actorEmail: actorEmail ?? null,
          liftedAt: lifted?.liftedAt ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ freeze: lifted });
}
