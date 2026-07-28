import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  pluginCatalog,
  categoryMeta,
  toPublicPlugin,
} from '@/marketplace';
import { MarketplaceHeader, MarketplaceFooter } from '../../_components/marketplace-header';
import { PluginDetailClient } from '../../_components/plugin-detail';
import { db } from '@/lib/db';
import { getFeaturedIds } from '@/lib/extension-featured';
import type { PublicPlugin, PluginReview } from '@/marketplace';

export const dynamic = 'force-dynamic';

/**
 * /marketplace/plugin/[slug]
 *
 * Full plugin detail page (no auth required).
 */
export default async function PluginDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const plugin = await pluginCatalog.getPlugin(slug);
  if (!plugin) notFound();

  const meta = categoryMeta(plugin.category);

  // Fetch reviews (top 50).
  const reviews = await pluginCatalog.getReviews(plugin.id).catch(() => []);

  // Resolve the install state for the calling merchant (best-effort — if
  // unauthenticated, installState is null).
  let installState: { status: string; installId: string } | null = null;
  try {
    const { requireMerchantId } = await import('@/lib/api-auth');
    const merchantId = await requireMerchantId();
    if (merchantId) {
      const install = await db.extensionInstall.findUnique({
        where: { extensionId_merchantId: { extensionId: plugin.id, merchantId } },
        select: { id: true, status: true },
      });
      if (install) {
        installState = { status: install.status, installId: install.id };
      }
    }
  } catch {
    // ignore — anonymous browse
  }

  // Fetch dependencies (resolve each slug to a published plugin).
  const depSlugs = plugin.dependencies.map((d) => d.slug);
  let deps: PublicPlugin[] = [];
  if (depSlugs.length > 0) {
    const rows = await db.extension.findMany({
      where: { slug: { in: depSlugs }, status: 'published' },
    });
    const featuredSet = await getFeaturedIds();
    const devIds = Array.from(new Set(rows.map((r) => r.developerId)));
    const devUsers = await db.user.findMany({
      where: { id: { in: devIds } },
      select: { id: true, name: true, email: true },
    });
    const devMap = new Map(devUsers.map((u) => [u.id, u]));
    deps = rows.map((r) => {
      const dev = devMap.get(r.developerId);
      return toPublicPlugin(r, {
        devName: dev?.name ?? dev?.email ?? 'Unknown',
        featuredSet,
      });
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <MarketplaceHeader />
      <main className="flex-1">
        <div className="border-b border-border/60 bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <nav className="text-xs text-muted-foreground">
              <Link href="/marketplace" className="hover:text-foreground">
                Marketplace
              </Link>
              <span className="mx-1.5">/</span>
              <Link
                href={`/marketplace/category/${plugin.category}`}
                className="hover:text-foreground"
              >
                {meta.label}
              </Link>
              <span className="mx-1.5">/</span>
              <span className="text-foreground">{plugin.name}</span>
            </nav>
          </div>
        </div>
        <PluginDetailClient
          plugin={plugin as PublicPlugin}
          reviews={reviews as PluginReview[]}
          dependencies={deps as PublicPlugin[]}
          installState={installState}
        />
      </main>
      <MarketplaceFooter />
    </div>
  );
}
