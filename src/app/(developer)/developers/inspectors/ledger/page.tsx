import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { LedgerInspector } from './ledger-inspector';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ledger Inspector — Developers — PaySwap' };

export default async function LedgerInspectorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Economic Ledger Inspector"
        description="The canonical balance sheet — assets, liabilities, equity, solvency ratios, treasury accounts, and journal entries."
      />
      <LedgerInspector />
    </div>
  );
}
