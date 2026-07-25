import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { ensureDbInitialized } from '@/lib/db-init';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }
  await ensureDbInitialized();
  return <AppShell role="admin">{children}</AppShell>;
}
