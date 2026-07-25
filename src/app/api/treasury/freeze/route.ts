import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { emergencyFreezeEngine } from '@/protocol/treasury-v2';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TREASURY_ROLES = new Set(['TREASURY', 'ADMIN', 'SUPER_ADMIN']);

/** Map a freeze scope to its audit-log action. */
const FREEZE_AUDIT_ACTION: Record<string, string> = {
  account: 'TREASURY.FREEZE_ACCOUNT',
  asset: 'TREASURY.FREEZE_ASSET',
  corridor: 'TREASURY.FREEZE_CORRIDOR',
};

/**
 * POST /api/treasury/freeze — emergency freeze (admin only).
 *
 * Auth posture:
 *   - No session → 401 Unauthorized
 *   - Session but not ADMIN/SUPER_ADMIN → 403 Forbidden
 *
 * Body: { scope: 'account'|'asset'|'corridor'; target; reason; initiatedBy; durationMs? }
 *
 * In addition to invoking the in-memory EmergencyFreezeEngine, this handler
 * persists a TREASURY.FREEZE_* AuditLog entry so the freeze survives process
 * restarts and can be queried from the Treasury console.
 */
export async function POST(req: NextRequest) {
  // 1. Must be authenticated.
  const session = await requireSession();
  if (!session) return unauthorized();

  // 2. Must hold an admin role.
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  const body = await req.json();
  const { scope, target, reason, initiatedBy, durationMs } = body;
  let result;
  if (scope === 'account') {
    result = emergencyFreezeEngine.freezeAccount(
      target,
      reason,
      initiatedBy,
      durationMs,
    );
  } else if (scope === 'asset') {
    result = emergencyFreezeEngine.freezeAsset(target, reason, initiatedBy);
  } else if (scope === 'corridor') {
    result = emergencyFreezeEngine.freezeCorridor(
      { from: target.from, to: target.to },
      reason,
      initiatedBy,
    );
  } else {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  }

  // Persist to AuditLog so the freeze is durable + queryable.
  const auditAction = FREEZE_AUDIT_ACTION[scope] ?? 'TREASURY.FREEZE';
  const resourceTarget =
    scope === 'corridor'
      ? `${target?.from ?? ''}→${target?.to ?? ''}`
      : String(target ?? '');
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: auditAction,
        resourceType: scope,
        resourceId: resourceTarget || result.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          freezeId: result.id,
          scope,
          target: resourceTarget,
          reason,
          initiatedBy,
          actorEmail: actorEmail ?? null,
          durationMs: durationMs ?? null,
          expiresAt: result.expiresAt ?? null,
          active: true,
        }),
      },
    });
  } catch {
    // best-effort — the freeze itself has already been recorded in-memory.
  }

  return NextResponse.json({ freeze: result });
}

/** GET /api/treasury/freeze — list active freezes (admin only). */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  // Merge the in-memory active freezes with the AuditLog-persisted record so
  // the console sees freezes that may have been issued by a prior process.
  const inMemory = emergencyFreezeEngine.activeFreezes();

  const auditFreezes = await db.auditLog.findMany({
    where: {
      action: {
        in: [
          'TREASURY.FREEZE_ACCOUNT',
          'TREASURY.FREEZE_ASSET',
          'TREASURY.FREEZE_CORRIDOR',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: true },
  });

  // Find any TREASURY.UNFREEZE entries to filter out lifted freezes.
  const unfreezeLogs = await db.auditLog.findMany({
    where: { action: 'TREASURY.UNFREEZE' },
    select: { details: true, createdAt: true },
  });
  const liftedFreezeIds = new Set<string>();
  for (const l of unfreezeLogs) {
    try {
      const d = JSON.parse(l.details ?? '{}');
      if (typeof d.freezeId === 'string') liftedFreezeIds.add(d.freezeId);
    } catch {
      /* ignore */
    }
  }

  type ActiveFreeze = {
    id: string;
    scope: string;
    target: string;
    reason: string;
    initiatedBy: string;
    initiatedAt: number;
    expiresAt?: number;
    source: 'memory' | 'audit';
    actorEmail?: string;
    createdAt?: string;
  };

  const active: ActiveFreeze[] = [];
  const seen = new Set<string>();

  for (const f of inMemory) {
    if (liftedFreezeIds.has(f.id)) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    active.push({
      id: f.id,
      scope: f.scope,
      target: f.target,
      reason: f.reason,
      initiatedBy: f.initiatedBy,
      initiatedAt: f.initiatedAt,
      expiresAt: f.expiresAt,
      source: 'memory',
    });
  }
  for (const l of auditFreezes) {
    let d: any = {};
    try {
      d = JSON.parse(l.details ?? '{}');
    } catch {
      d = {};
    }
    const freezeId = d.freezeId ?? l.id;
    if (liftedFreezeIds.has(freezeId)) continue;
    if (seen.has(freezeId)) continue;
    seen.add(freezeId);
    active.push({
      id: freezeId,
      scope: d.scope ?? l.resourceType,
      target: d.target ?? l.resourceId ?? '',
      reason: d.reason ?? '',
      initiatedBy: d.initiatedBy ?? l.user?.email ?? '',
      initiatedAt: d.expiresAt
        ? new Date(l.createdAt).getTime()
        : new Date(l.createdAt).getTime(),
      expiresAt: d.expiresAt,
      source: 'audit',
      actorEmail: d.actorEmail,
      createdAt: l.createdAt.toISOString(),
    });
  }

  return NextResponse.json({ freezes: active });
}

/**
 * DELETE /api/treasury/freeze — lift an active freeze (admin / treasury).
 *
 * Body: { freezeId: string }
 *
 * Lifts the in-memory freeze (if still present) AND records a
 * TREASURY.UNFREEZE AuditLog entry so the lift survives process restarts.
 * The treasury role is permitted for unfreeze (lifts) even though freezes
 * themselves require admin — this matches the Treasury console's "Unfreeze"
 * UX where treasury operators can release holds they can see.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => TREASURY_ROLES.has(r))) {
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
  const freezeId =
    typeof body?.freezeId === 'string' ? body.freezeId.trim() : '';
  if (!freezeId) {
    return NextResponse.json(
      { error: 'freezeId is required' },
      { status: 400 },
    );
  }

  // Lift the in-memory freeze (idempotent — returns the existing record if
  // already lifted, or undefined if it was never in-memory).
  const lifted = emergencyFreezeEngine.lift(freezeId);

  // Persist an UNFREEZE entry — this is the durable record that the freeze
  // is no longer active, even if the original freeze was created in a prior
  // process and isn't in the current in-memory engine.
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'TREASURY.UNFREEZE',
        resourceType: lifted?.scope ?? 'freeze',
        resourceId: lifted?.target ?? freezeId,
        result: 'SUCCESS',
        details: JSON.stringify({
          freezeId,
          scope: lifted?.scope ?? null,
          target: lifted?.target ?? null,
          actorEmail: actorEmail ?? null,
          source: lifted ? 'memory' : 'audit',
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    freezeId,
    lifted: true,
    wasInMemory: lifted !== undefined,
  });
}
