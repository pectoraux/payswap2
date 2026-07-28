import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  settlementOrderService,
  lockedStablecoinService,
  overviewForLp,
  type SettlementOrder,
  type LockedStablecoin,
} from '@/lp/settlement-store';
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
 * GET /api/lp/settlement-orders
 *
 * Returns:
 *   - pending settlement orders that need LP bandwidth (claimable now)
 *   - locked stablecoins for the authenticated LP
 *   - matched orders (this LP claimed — settlement in flight)
 *   - settled history (this LP)
 *   - overview KPIs
 *
 * Auth: LP / ADMIN / SUPER_ADMIN.
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!hasLpRole((session.user as any)?.roles)) return forbidden();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();

  // Resolve the LP profile (if any). When there's no LP profile yet, fall
  // back to the seeded LP id so the demo console still has content.
  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lpId: string = account?.lpProfile?.id ?? 'seed-lp-1';

  const pendingOrders = settlementOrderService.listPending();
  const matchedOrders = lpId
    ? settlementOrderService.listMatchedByLp(lpId)
    : [];
  const settledOrders = lpId
    ? settlementOrderService.listSettledByLp(lpId)
    : [];
  const lockedStablecoins = lpId
    ? lockedStablecoinService.listByLp(lpId).filter((l) => l.status === 'locked')
    : [];
  const unlockHistory = lpId
    ? lockedStablecoinService
        .listByLp(lpId)
        .filter((l) => l.status === 'unlocked')
    : [];

  const overview = lpId ? overviewForLp(lpId) : null;

  const serialize = (o: SettlementOrder) => ({
    ...o,
    createdAt: new Date(o.createdAt).toISOString(),
    deadlineAt: new Date(o.deadlineAt).toISOString(),
    claimedAt: o.claimedAt ? new Date(o.claimedAt).toISOString() : null,
    settledAt: o.settledAt ? new Date(o.settledAt).toISOString() : null,
  });
  const serializeLock = (l: LockedStablecoin) => ({
    ...l,
    lockedAt: new Date(l.lockedAt).toISOString(),
    unlockedAt: l.unlockedAt ? new Date(l.unlockedAt).toISOString() : null,
  });

  return NextResponse.json({
    pendingOrders: pendingOrders.map(serialize),
    matchedOrders: matchedOrders.map(serialize),
    settledOrders: settledOrders.map(serialize),
    lockedStablecoins: lockedStablecoins.map(serializeLock),
    unlockHistory: unlockHistory.map(serializeLock),
    overview,
    lpId: lpId ?? null,
  });
}
