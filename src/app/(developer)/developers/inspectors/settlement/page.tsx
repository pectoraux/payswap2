import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { SettlementInspector } from './settlement-inspector';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settlement Inspector — Developers — PaySwap' };

export default async function SettlementInspectorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settlement Inspector"
        description="Settlement orchestrator actors (durable Sagas), settlement contracts (escrow lifecycle), and LP bandwidth positions."
      />
      <SettlementInspector />
    </div>
  );
}
