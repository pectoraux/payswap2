import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { safeJson } from '@/lib/extension-catalog';
import { getFeaturedIds } from '@/lib/extension-featured';
import { Boxes } from 'lucide-react';
import { AdminExtensionsManager, type AdminExtension, type AdminDeveloper } from './extensions-manager';

export const dynamic = 'force-dynamic';

export default async function AdminExtensionsPage() {
  const session = await getServerSession(authOptions);
  const roles = ((session?.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  // Fetch every extension, newest first, joined with the developer info.
  const rows = await db.extension.findMany({
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });

  // Resolve the developer users for the extensions we loaded.
  const devIds = Array.from(new Set(rows.map((r) => r.developerId)));
  const [devUsers, installAgg, featuredSet] = await Promise.all([
    db.user.findMany({
      where: { id: { in: devIds } },
      select: { id: true, name: true, email: true },
    }),
    db.extensionInstall.groupBy({
      by: ['extensionId'],
      _count: { _all: true },
      where: { extensionId: { in: rows.map((r) => r.id) } },
    }),
    getFeaturedIds(),
  ]);
  const devMap = new Map<string, AdminDeveloper>(
    devUsers.map((u) => [u.id, { id: u.id, name: u.name ?? '—', email: u.email }]),
  );
  const installCountMap = new Map(
    installAgg.map((i) => [i.extensionId, i._count._all]),
  );

  const extensions: AdminExtension[] = rows.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    developerId: e.developerId,
    developer: devMap.get(e.developerId) ?? {
      id: e.developerId,
      name: 'Unknown',
      email: '—',
    },
    category: e.category,
    iconUrl: e.iconUrl,
    version: e.version,
    status: e.status,
    permissions: safeJson<string[]>(e.permissions) ?? [],
    pricing: e.pricing,
    price: e.price,
    config: safeJson<Record<string, unknown>>(e.config),
    changelog:
      safeJson<Array<{ version: string; date: string; changes: string }>>(e.changelog) ??
      [],
    installCount: e.installCount,
    activeInstallCount: installCountMap.get(e.id) ?? 0,
    rating: e.rating,
    reviewCount: e.reviewCount,
    featured: featuredSet.has(e.id),
    submittedAt: e.submittedAt ? e.submittedAt.toISOString() : null,
    reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
    reviewedBy: e.reviewedBy,
    reviewNotes: e.reviewNotes,
    publishedAt: e.publishedAt ? e.publishedAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }));

  // Marketplace-review tab: anything in the submission/security/review pipeline.
  const inReview = extensions.filter((e) =>
    ['submitted', 'static_analysis', 'security_scan', 'review', 'approved', 'suspended'].includes(
      e.status,
    ),
  );

  // All-extensions tab: every extension regardless of status.
  const all = extensions;

  const stats = {
    inReview: inReview.length,
    published: extensions.filter((e) => e.status === 'published').length,
    suspended: extensions.filter((e) => e.status === 'suspended').length,
    deprecated: extensions.filter((e) => e.status === 'deprecated').length,
    archived: extensions.filter((e) => e.status === 'archived').length,
    featured: extensions.filter((e) => e.featured).length,
    totalInstalls: extensions.reduce((s, e) => s + e.installCount, 0),
    total: extensions.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Extension marketplace</h1>
          <p className="text-sm text-muted-foreground">
            Review submissions, drive the lifecycle, feature or deprecate
            extensions, and moderate the catalog.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <Boxes className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            In review
          </span>
          <span className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {stats.inReview}
          </span>
        </div>
      </div>

      <AdminExtensionsManager
        extensions={all}
        inReview={inReview}
        stats={stats}
        isAdmin={isAdmin}
      />
    </div>
  );
}
