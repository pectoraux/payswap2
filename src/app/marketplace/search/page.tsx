import Link from 'next/link';
import { pluginCatalog } from '@/marketplace';
import { MarketplaceHeader, MarketplaceFooter } from '../_components/marketplace-header';
import { SearchPageClient } from '../_components/search-page';
import type { PublicPlugin } from '@/marketplace';

export const dynamic = 'force-dynamic';

/**
 * /marketplace/search?q=...
 *
 * Full-text search across plugin name, description, capabilities, tags.
 * Faceted filters via query params (rendered client-side).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; pricing?: string; minRating?: string; capabilityType?: string; free?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? '';
  const plugins = await pluginCatalog.search(q, {
    category: sp.category as any,
    pricing: sp.pricing as any,
    minRating: sp.minRating ? Number(sp.minRating) : undefined,
    capabilityType: sp.capabilityType as any,
    free: sp.free === '1',
  }).catch(() => []);

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
              <span className="text-foreground">Search</span>
            </nav>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">
              {q ? <>Results for &ldquo;{q}&rdquo;</> : 'Search the marketplace'}
            </h1>
          </div>
        </div>
        <SearchPageClient
          initialPlugins={plugins as PublicPlugin[]}
          initialQuery={q}
          initialCategory={sp.category ?? 'all'}
          initialPricing={sp.pricing ?? 'all'}
          initialMinRating={sp.minRating ?? ''}
          initialCapabilityType={sp.capabilityType ?? 'all'}
          initialFree={sp.free === '1'}
        />
      </main>
      <MarketplaceFooter />
    </div>
  );
}
