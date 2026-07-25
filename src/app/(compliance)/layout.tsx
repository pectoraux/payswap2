import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell } from '@/components/role-shell';
import { complianceNav } from '@/lib/nav-config';

export const dynamic = 'force-dynamic';

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell
      roleLabel="Compliance"
      navGroups={complianceNav}
      basePath="/compliance"
      currentRole="COMPLIANCE"
    >
      {children}
    </RoleShell>
  );
}
