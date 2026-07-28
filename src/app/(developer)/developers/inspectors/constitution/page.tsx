import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { ConstitutionInspector } from './constitution-inspector';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Constitution Inspector — Developers — PaySwap' };

export default async function ConstitutionInspectorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Constitution Inspector"
        description="Economic invariants (the gate between ExecutionPlan and EventStore) and constitutional rules (immutable during runtime execution)."
      />
      <ConstitutionInspector />
    </div>
  );
}
