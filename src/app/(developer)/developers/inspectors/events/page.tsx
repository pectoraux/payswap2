import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { EventExplorer } from './event-explorer';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Event Explorer — Developers — PaySwap' };

export default async function EventExplorerPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Event Explorer"
        description="Every domain event in the runtime event store — sequence, type, aggregate, version, payload."
      />
      <EventExplorer />
    </div>
  );
}
