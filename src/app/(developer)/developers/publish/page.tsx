import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PageHeader } from '@/components/role-ui';
import { db } from '@/lib/db';
import { parseMarketplaceMeta } from '@/marketplace';
import { PublishDashboardClient } from './publish-dashboard';
import type { PricingPlan, VerificationResult } from '@/marketplace';
import type { CapabilityDeclaration, Permission } from '@/sdk/types';

export const dynamic = 'force-dynamic';

export interface DeveloperPlugin {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  iconUrl: string | null;
  version: string;
  status: string;
  pricing: PricingPlan;
  capabilities: CapabilityDeclaration[];
  permissions: Permission[];
  tags: string[];
  verification: VerificationResult | null;
  reviewNotes: string | null;
  installCount: number;
  rating: number;
  reviewCount: number;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default async function PublishDashboardPage() {
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

  const rows = await db.extension.findMany({
    where: { developerId: userId },
    orderBy: { updatedAt: 'desc' },
  });

  // Filter to marketplace plugins only.
  const marketplaceRows = rows.filter((r) => {
    const meta = parseMarketplaceMeta(r.config);
    return meta.marketplace === true;
  });

  const plugins: DeveloperPlugin[] = marketplaceRows.map((r) => {
    const meta = parseMarketplaceMeta(r.config);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      category: r.category,
      iconUrl: r.iconUrl,
      version: r.version,
      status: r.status,
      pricing: meta.pricing ?? { model: 'free', summary: 'Free' },
      capabilities: meta.capabilities ?? [],
      permissions: (meta.permissions ?? []) as Permission[],
      tags: meta.tags ?? [],
      verification: meta.verification ?? null,
      reviewNotes: r.reviewNotes,
      installCount: r.installCount,
      rating: r.rating,
      reviewCount: r.reviewCount,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  const stats = {
    total: plugins.length,
    published: plugins.filter((p) => p.status === 'published').length,
    inReview: plugins.filter((p) =>
      ['submitted', 'static_analysis', 'security_scan', 'review', 'approved'].includes(p.status),
    ).length,
    drafts: plugins.filter((p) => p.status === 'draft').length,
    rejected: plugins.filter((p) => p.status === 'rejected').length,
    totalInstalls: plugins.reduce((s, p) => s + p.installCount, 0),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publish to Marketplace"
        description="Publish your plugins to the public PaySwap ecosystem marketplace. Anyone can browse and install them."
      />
      <PublishDashboardClient plugins={plugins} stats={stats} />
    </div>
  );
}
