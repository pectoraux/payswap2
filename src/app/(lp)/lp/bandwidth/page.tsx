import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/role-ui';
import { Gauge } from 'lucide-react';
import { bandwidthEngine } from '@/runtime/liquidity';
import type { BandwidthPosition } from '@/runtime/liquidity';
import {
  BandwidthManagementViewer,
  type BandwidthPositionDTO,
} from './bandwidth-viewer';

export const dynamic = 'force-dynamic';

function serialize(p: BandwidthPosition): BandwidthPositionDTO {
  return { ...p };
}

/**
 * /lp/bandwidth — LP bandwidth management console.
 *
 * Renders the LP's bandwidth positions (capacity / reserved / used /
 * available / escrow / bond / status) and provides a "Register Bandwidth"
 * dialog. For fiat positions the debit-authorization status is shown inline.
 *
 * Initial state is loaded server-side from the runtime bandwidth engine; the
 * viewer refreshes via /api/runtime/bandwidth after each action.
 */
export default async function LpBandwidthPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;
  const lpId = lp?.id ?? 'seed-lp-1';

  const all = bandwidthEngine.listAll();
  const positions: BandwidthPositionDTO[] = all.map(serialize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bandwidth"
        description="Capacity you've committed to the settlement network — by country, asset type, and currency. Bandwidth is never a balance: it's reserved, consumed, and slashed as settlements flow."
      />

      {!lp ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Gauge className="h-6 w-6" />}
              title="No LP profile linked"
              description="Showing aggregate bandwidth data. Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : null}

      <BandwidthManagementViewer initial={positions} lpId={lpId} />
    </div>
  );
}
