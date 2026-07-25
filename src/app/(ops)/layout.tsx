import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import {
  LayoutDashboard,
  HeartPulse,
  Plug,
  BarChart3,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/ops', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Health', href: '/ops/health', icon: <HeartPulse className="h-4 w-4" /> },
      { label: 'Connectors', href: '/ops/connectors', icon: <Plug className="h-4 w-4" /> },
      { label: 'Metrics', href: '/ops/metrics', icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
];

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="Operations" navGroups={navGroups} basePath="/ops">
      {children}
    </RoleShell>
  );
}
