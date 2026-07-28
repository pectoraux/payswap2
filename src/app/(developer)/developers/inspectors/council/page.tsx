import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { CouncilInspector } from './council-inspector';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Council Inspector — Developers — PaySwap' };

export default async function CouncilInspectorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Council Inspector"
        description="The Economic Council coordinates all directors through debate + consensus. Each decision goes through opinions, counter-proposals, weighted consensus, and constitutional review."
      />
      <CouncilInspector />
    </div>
  );
}
