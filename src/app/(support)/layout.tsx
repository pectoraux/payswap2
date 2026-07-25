import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import { LayoutDashboard, Search, History } from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/support', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Search', href: '/support/search', icon: <Search className="h-4 w-4" /> },
      { label: 'Audit Trail', href: '/support/audit', icon: <History className="h-4 w-4" /> },
    ],
  },
];

export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="Support" navGroups={navGroups} basePath="/support">
      {children}
    </RoleShell>
  );
}
