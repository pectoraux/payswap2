import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { ReplayExplorer } from './replay-explorer';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Replay Explorer — Developers — PaySwap' };

export default async function ReplayExplorerPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Replay Explorer"
        description="Reconstruct the system state at any point in time. Drag the slider to any sequence number and see the balance sheet, solvency, and event counts at that point."
      />
      <ReplayExplorer />
    </div>
  );
}
