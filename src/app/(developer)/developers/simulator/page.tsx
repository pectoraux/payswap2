import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DEVELOPER_SCENARIOS } from '@/lib/developer-scenarios';
import { PageHeader } from '@/components/role-ui';
import { SimulatorConsole } from './simulator-console';

export const dynamic = 'force-dynamic';

export default async function DeveloperSimulatorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) redirect('/login');

  const scenarios = DEVELOPER_SCENARIOS.map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    category: s.category,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulator"
        description="Run pre-built scenarios through the kernel pipeline. The simulator uses the exact same code as production — what you see here is what your users get."
      />
      <SimulatorConsole scenarios={scenarios} />
    </div>
  );
}
