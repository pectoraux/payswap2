import { NextResponse } from 'next/server';
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
 * GET /api/treasury/emergency/status
 *
 * Returns all active freezes plus the recent freeze history (active, lifted,
 * expired). Used by the Treasury Emergency console to render the active
 * freezes table and audit trail.
 *
 * Auth: TREASURY / ADMIN / SUPER_ADMIN.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  if (!roles.some((r) => TREASURY_ROLES.has(r))) {
    return forbidden();
  }

  // Sweep expired freezes (so they're correctly marked before listing).
  // We don't mutate the records in-store here; instead, we compute status
  // dynamically when serializing.
  const now = Date.now();
  const all = treasuryEmergencyService.list();
  const active = all.filter(
    (f) =>
      f.status === 'active' &&
      (f.expiresAt === undefined || f.expiresAt > now),
  );
  const expired = all.filter(
    (f) =>
      f.status === 'active' &&
      f.expiresAt !== undefined &&
      f.expiresAt <= now,
  );
  const lifted = all.filter((f) => f.status === 'lifted');

  // Also pull recent freeze/unfreeze audit-log entries to surface historic
  // freezes from prior process lifetimes.
  let auditTrail: Array<{
    id: string;
    action: string;
    target?: string;
    targetId?: string;
    reason?: string;
    actorEmail?: string;
    createdAt: string;
  }> = [];
  try {
    const logs = await db.auditLog.findMany({
      where: {
        OR: [
          { action: { startsWith: 'TREASURY.EMERGENCY_FREEZE_' } },
          { action: 'TREASURY.EMERGENCY_UNFREEZE' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    });
    auditTrail = logs.map((l) => {
      let d: any = {};
      try {
        d = JSON.parse(l.details ?? '{}');
      } catch {
        d = {};
      }
      return {
        id: l.id,
        action: l.action,
        target: d.target ?? l.resourceType,
        targetId: d.targetId ?? l.resourceId,
        reason: d.reason,
        actorEmail: d.actorEmail ?? l.user?.email ?? undefined,
        createdAt: l.createdAt.toISOString(),
      };
    });
  } catch {
    // ignore
  }

  const serialize = (f: (typeof all)[number]) => ({
    ...f,
    frozenAt: new Date(f.frozenAt).toISOString(),
    expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
    liftedAt: f.liftedAt ? new Date(f.liftedAt).toISOString() : null,
    durationMs: f.durationMs ?? null,
  });

  return NextResponse.json({
    active: active.map(serialize),
    expired: expired.map(serialize),
    lifted: lifted.map(serialize),
    auditTrail,
    summary: {
      active: active.length,
      expired: expired.length,
      lifted: lifted.length,
    },
  });
}
