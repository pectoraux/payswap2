import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { treasuryEmergencyService, type EmergencyTarget } from '@/treasury/emergency-store';
import {
  requireAdminSession,
  requireSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TARGETS: EmergencyTarget[] = ['country', 'corridor', 'reserve', 'wallet'];

/**
 * POST /api/treasury/emergency/freeze
 *
 * Treasury admin issues an emergency freeze on a target.
 *
 * Body: { target: 'country'|'corridor'|'reserve'|'wallet', targetId: string, reason: string, duration?: number(ms) }
 *
 * Auth: ADMIN / SUPER_ADMIN only.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const target = typeof body?.target === 'string' ? body.target : '';
  const targetId = typeof body?.targetId === 'string' ? body.targetId.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const duration =
    typeof body?.duration === 'number' && Number.isFinite(body.duration)
      ? Math.max(0, Math.floor(body.duration))
      : undefined;

  if (!VALID_TARGETS.includes(target as EmergencyTarget)) {
    return NextResponse.json(
      { error: `target must be one of: ${VALID_TARGETS.join(', ')}` },
      { status: 400 },
    );
  }
  if (!targetId) {
    return NextResponse.json({ error: 'targetId is required' }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }
  if (reason.length > 1000) {
    return NextResponse.json(
      { error: 'reason must be ≤ 1000 chars' },
      { status: 400 },
    );
  }
  if (duration !== undefined && duration < 60_000) {
    return NextResponse.json(
      { error: 'duration must be ≥ 60s when provided' },
      { status: 400 },
    );
  }

  // Idempotency: if the same (target, targetId) is already frozen, return the existing record.
  if (treasuryEmergencyService.isFrozen(target as EmergencyTarget, targetId)) {
    const existing = treasuryEmergencyService
      .listActive()
      .find((f) => f.target === target && f.targetId === targetId);
    if (existing) {
      return NextResponse.json(
        {
          error: 'Target is already frozen',
          freeze: existing,
        },
        { status: 409 },
      );
    }
  }

  const freeze = treasuryEmergencyService.freeze({
    target: target as EmergencyTarget,
    targetId,
    reason,
    duration,
    initiatedByUserId: userId,
    initiatedByEmail: actorEmail,
  });

  // Audit log (durable).
  const auditAction = `TREASURY.EMERGENCY_FREEZE_${target.toUpperCase()}`;
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: auditAction,
        resourceType: target,
        resourceId: targetId,
        result: 'SUCCESS',
        details: JSON.stringify({
          freezeId: freeze.id,
          target,
          targetId,
          reason,
          durationMs: duration ?? null,
          expiresAt: freeze.expiresAt ?? null,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ freeze }, { status: 201 });
}
