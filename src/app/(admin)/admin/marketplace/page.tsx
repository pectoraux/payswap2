import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pluginCatalog } from '@/marketplace';
import { Boxes, ShieldCheck } from 'lucide-react';
import { MarketplaceReviewClient } from './marketplace-review';
import type { PublicPlugin } from '@/marketplace';

export const dynamic = 'force-dynamic';

/**
 * Admin marketplace review dashboard.
 *
 * Lists submitted plugins pending review, lets the admin run the verification
 * pipeline, approve/reject, and feature/unfeature.
 */
export default async function AdminMarketplacePage() {
  const session = await getServerSession(authOptions);
  const roles = ((session?.user as any)?.roles as string[] | undefined) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  const [pending, all] = await Promise.all([
    pluginCatalog.listPendingReview().catch(() => []),
    pluginCatalog.listAllForAdmin().catch(() => []),
  ]);

  const stats = {
    pending: pending.length,
    published: all.filter((p) => p.status === 'published').length,
    rejected: all.filter((p) => p.status === 'rejected').length,
    suspended: all.filter((p) => p.status === 'suspended').length,
    featured: all.filter((p) => p.featured).length,
    total: all.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketplace review</h1>
          <p className="text-sm text-muted-foreground">
            Review third-party plugin submissions, run verification, approve or
            reject, and curate the featured carousel.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pending
          </span>
          <span className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {stats.pending}
          </span>
        </div>
      </div>

      <MarketplaceReviewClient
        pending={pending as PublicPlugin[]}
        all={all as PublicPlugin[]}
        stats={stats}
        isAdmin={isAdmin}
      />
    </div>
  );
}
