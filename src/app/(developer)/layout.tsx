import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { RoleShell } from '@/components/role-shell';
import { developerNav } from '@/lib/nav-config';

export const dynamic = 'force-dynamic';

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (
    !roles ||
    !roles.some((r) =>
      ['DEVELOPER', 'ADMIN', 'SUPER_ADMIN', 'MERCHANT', 'MERCHANT_STAFF'].includes(r),
    )
  ) {
    redirect('/unauthorized');
  }
  return (
    <RoleShell
      roleLabel="Developer"
      navGroups={developerNav}
      basePath="/developers"
      currentRole="DEVELOPER"
    >
      {children}
    </RoleShell>
  );
}
