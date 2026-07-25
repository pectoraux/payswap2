import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import {
  LayoutDashboard,
  Briefcase,
  ArrowLeftRight,
  TrendingUp,
  Settings,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/lp', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Liquidity',
    items: [
      { label: 'Positions', href: '/lp/positions', icon: <Briefcase className="h-4 w-4" /> },
      { label: 'Settlements', href: '/lp/settlements', icon: <ArrowLeftRight className="h-4 w-4" /> },
      { label: 'Profitability', href: '/lp/profitability', icon: <TrendingUp className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Settings', href: '/lp/settings', icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

export default async function LpLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="LP" navGroups={navGroups} basePath="/lp">
      {children}
    </RoleShell>
  );
}
