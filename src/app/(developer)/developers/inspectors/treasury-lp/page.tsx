import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { TreasuryLpInspector } from './treasury-lp-inspector';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Treasury & LP Inspector — Developers — PaySwap' };

export default async function TreasuryLpInspectorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Treasury & LP Inspector"
        description="Treasury state (reserves by country, twin tokens, solvency) and liquidity provider network (LPs, positions, bandwidth, reputation, offers)."
      />
      <TreasuryLpInspector />
    </div>
  );
}
