import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import {
  LayoutDashboard,
  Vault,
  Route,
  FileBarChart,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/treasury', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Treasury',
    items: [
      { label: 'Reserves', href: '/treasury/reserves', icon: <Vault className="h-4 w-4" /> },
      { label: 'Corridors', href: '/treasury/corridors', icon: <Route className="h-4 w-4" /> },
      { label: 'Reports', href: '/treasury/reports', icon: <FileBarChart className="h-4 w-4" /> },
    ],
  },
];

export default async function TreasuryLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['TREASURY', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="Treasury" navGroups={navGroups} basePath="/treasury">
      {children}
    </RoleShell>
  );
}
