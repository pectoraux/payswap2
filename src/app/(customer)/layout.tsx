import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell } from '@/components/role-shell';
import { customerNav } from '@/lib/nav-config';

export const dynamic = 'force-dynamic';

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell
      roleLabel="Customer"
      navGroups={customerNav}
      basePath="/portal"
      currentRole="CUSTOMER"
    >
      {children}
    </RoleShell>
  );
}
