import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/role-ui';
import { ArrowLeftRight } from 'lucide-react';
import {
  settlementOrderService,
  lockedStablecoinService,
  overviewForLp,
  type SettlementOrder,
  type LockedStablecoin,
} from '@/lp/settlement-store';
import {
  LpSettlementsConsole,
  type SettlementOrderDTO,
  type LockedStablecoinDTO,
} from '@/components/lp/lp-settlements-console';

export const dynamic = 'force-dynamic';

function serializeOrder(o: SettlementOrder): SettlementOrderDTO {
  return {
    ...o,
    createdAt: new Date(o.createdAt).toISOString(),
    deadlineAt: new Date(o.deadlineAt).toISOString(),
    claimedAt: o.claimedAt ? new Date(o.claimedAt).toISOString() : null,
    settledAt: o.settledAt ? new Date(o.settledAt).toISOString() : null,
  };
}

function serializeLock(l: LockedStablecoin): LockedStablecoinDTO {
  return {
    ...l,
    lockedAt: new Date(l.lockedAt).toISOString(),
    unlockedAt: l.unlockedAt ? new Date(l.unlockedAt).toISOString() : null,
  };
}

/**
 * LP Settlements page.
 *
 * Combines three views into one page:
 *   1. Pending settlement orders that need LP bandwidth (claimable).
 *   2. Locked stablecoins (held during incomplete transfers) + unlock action.
 *   3. In-flight (matched) + settled history for this LP.
 *
 * Server-side data is fetched from the in-memory LP settlement store and
 * passed to the client console which handles claim + unlock interactions.
 */
export default async function LpSettlementsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;
  // When the user has no LP profile yet (e.g. an admin previewing the LP
  // console), fall back to the seeded LP id so the page still shows data.
  const lpId = lp?.id ?? 'seed-lp-1';

  const pendingOrders = settlementOrderService
    .listPending()
    .map(serializeOrder);
  const matchedOrders = settlementOrderService
    .listMatchedByLp(lpId)
    .map(serializeOrder);
  const settledOrders = settlementOrderService
    .listSettledByLp(lpId)
    .map(serializeOrder);

  const lockedStablecoins = lockedStablecoinService
    .listByLp(lpId)
    .filter((l) => l.status === 'locked')
    .map(serializeLock);
  const unlockHistory = lockedStablecoinService
    .listByLp(lpId)
    .filter((l) => l.status === 'unlocked')
    .map(serializeLock);

  const overview = overviewForLp(lpId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlements"
        description="Claim settlement orders needing bandwidth, unlock stablecoins locked in incomplete transfers, and review your settlement history."
      />

      {!lp ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ArrowLeftRight className="h-6 w-6" />}
              title="No LP profile linked"
              description="Showing demo data. Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : null}

      <LpSettlementsConsole
        initial={{
          pendingOrders,
          matchedOrders,
          settledOrders,
          lockedStablecoins,
          unlockHistory,
          overview,
          lpId,
        }}
      />
    </div>
  );
}
