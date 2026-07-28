import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { CommandExplorer } from './command-explorer';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Command Explorer — Developers — PaySwap' };

export default async function CommandExplorerPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Explorer"
        description="Every command type the runtime dispatcher accepts — schema, description, events emitted, and recent invocations."
      />
      <CommandExplorer />
    </div>
  );
}
