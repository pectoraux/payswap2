import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { parseMarketplaceMeta } from '@/marketplace';
import { AnalyticsView } from './analytics-view';
import type { PricingPlan } from '@/marketplace';

export const dynamic = 'force-dynamic';

export default async function PluginAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
  const userId = (session.user as any)?.id as string;
  if (!userId) redirect('/login');

  const { id } = await params;
  const row = await db.extension.findUnique({ where: { id } });
  if (!row || row.developerId !== userId) {
    redirect('/developers/publish');
  }
  const meta = parseMarketplaceMeta(row.config);

  return (
    <AnalyticsView
      plugin={{
        id: row.id,
        slug: row.slug,
        name: row.name,
        status: row.status,
        pricing: (meta.pricing ?? { model: 'free', summary: 'Free' }) as PricingPlan,
      }}
    />
  );
}
