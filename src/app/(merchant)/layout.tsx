import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { db } from '@/lib/db';

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  // Fetch organizations — wrapped in try/catch so a DB issue doesn't crash the page
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
    // Organizations not available — continue without the switcher
    console.error('[merchant-layout] Failed to load organizations:', e);
  }

  return <AppShell role="merchant" organizations={organizations}>{children}</AppShell>;
}
