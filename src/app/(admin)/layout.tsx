import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { getUserOrganizations } from '@/lib/org-context';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }

  const userId = (session.user as any)?.id;
  const organizations = userId ? await getUserOrganizations(userId) : [];

  return <AppShell role="admin" organizations={organizations as any}>{children}</AppShell>;
}
