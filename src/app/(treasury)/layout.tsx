import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell } from '@/components/role-shell';
import { treasuryNav } from '@/lib/nav-config';

export const dynamic = 'force-dynamic';

export default async function TreasuryLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['TREASURY', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell
      roleLabel="Treasury"
      navGroups={treasuryNav}
      basePath="/treasury"
      currentRole="TREASURY"
    >
      {children}
    </RoleShell>
  );
}
