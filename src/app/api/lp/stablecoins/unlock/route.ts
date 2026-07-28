import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { lockedStablecoinService } from '@/lp/settlement-store';
import {
  requireSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

/**
 * POST /api/lp/stablecoins/unlock
 *
 * An LP unlocks previously-locked stablecoins (held during a transfer that
 * didn't complete). The locked record transitions `locked → unlocked` and
 * the funds are conceptually released back to the LP's available balance.
 *
 * Body: { lockId: string, reason?: string }
 *
 * Auth: LP / ADMIN / SUPER_ADMIN.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!hasLpRole((session.user as any)?.roles)) return forbidden();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();
  const actorEmail = (session.user as any)?.email as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lockId = typeof body?.lockId === 'string' ? body.lockId.trim() : '';
  const reason =
    typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!lockId) {
    return NextResponse.json(
      { error: 'lockId is required' },
      { status: 400 },
    );
  }

  // Resolve the LP profile.
  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lpId = account?.lpProfile?.id ?? 'seed-lp-1';
  const lpName = account?.lpProfile?.name ?? 'LP';

  // Look up the locked stablecoin.
  const lock = lockedStablecoinService.get(lockId);
  if (!lock) {
    return NextResponse.json(
      { error: 'Locked stablecoin record not found' },
      { status: 404 },
    );
  }

  // Ownership check — the lock must belong to the authenticated LP. Admins
  // can unlock any LP's locks (they bypass this check).
  const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
  if (!isAdmin && lock.lpId !== lpId) {
    return NextResponse.json(
      { error: 'This lock does not belong to your LP account' },
      { status: 403 },
    );
  }

  if (lock.status !== 'locked') {
    return NextResponse.json(
      {
        error: `Lock is not in "locked" state (current: ${lock.status})`,
        status: lock.status,
      },
      { status: 409 },
    );
  }

  const unlocked = lockedStablecoinService.unlock(lockId, actorEmail ?? `lp:${lpId}`);
  if (!unlocked) {
    return NextResponse.json(
      { error: 'Failed to unlock — record may have been modified concurrently' },
      { status: 500 },
    );
  }

  // Audit the unlock.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'LP_STABLECOIN_UNLOCKED',
        resourceType: 'LockedStablecoin',
        resourceId: unlocked.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          lockId: unlocked.id,
          lpId: unlocked.lpId,
          lpName,
          amount: unlocked.amount,
          currency: unlocked.currency,
          originalReason: unlocked.reason,
          unlockReason: reason || null,
          actorEmail: actorEmail ?? null,
          transferReference: unlocked.transferReference ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    lock: {
      ...unlocked,
      lockedAt: new Date(unlocked.lockedAt).toISOString(),
      unlockedAt: unlocked.unlockedAt
        ? new Date(unlocked.unlockedAt).toISOString()
        : null,
    },
    status: 'unlocked',
  });
}
