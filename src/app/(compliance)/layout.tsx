import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell, type NavGroup } from '@/components/role-shell';
import {
  LayoutDashboard,
  ShieldAlert,
  Ban,
  FolderOpen,
  UserCheck,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Overview', href: '/compliance', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: 'Investigations',
    items: [
      { label: 'AML Alerts', href: '/compliance/alerts', icon: <ShieldAlert className="h-4 w-4" /> },
      { label: 'Sanctions', href: '/compliance/sanctions', icon: <Ban className="h-4 w-4" /> },
      { label: 'Cases', href: '/compliance/cases', icon: <FolderOpen className="h-4 w-4" /> },
      { label: 'KYC Review', href: '/compliance/kyc', icon: <UserCheck className="h-4 w-4" /> },
    ],
  },
];

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell roleLabel="Compliance" navGroups={navGroups} basePath="/compliance">
      {children}
    </RoleShell>
  );
}
