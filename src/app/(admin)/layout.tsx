import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r))) {
    redirect('/unauthorized');
  }

  let organizations: any[] = [];
  try {
    const userId = (session.user as any)?.id;
    if (userId) {
      const memberships = await db.organizationMember.findMany({
        where: { userId, status: 'active' },
        include: { organization: true },
      });
      organizations = memberships.map(m => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        type: m.organization.type,
        role: m.role,
        logoUrl: m.organization.logoUrl ?? undefined,
      }));
    }
  } catch (e) {
    console.error('[admin-layout] Failed to load organizations:', e);
  }

  return <AppShell role="admin" organizations={organizations}>{children}</AppShell>;
}
