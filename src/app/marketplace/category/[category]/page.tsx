import { notFound } from 'next/navigation';
import Link from 'next/link';
import { pluginCatalog, categoryMeta, isValidMarketplaceCategory } from '@/marketplace';
import { MarketplaceHeader, MarketplaceFooter } from '../../_components/marketplace-header';
import { CategoryPageClient } from '../../_components/category-page';
import type { PublicPlugin } from '@/marketplace';

export const dynamic = 'force-dynamic';

/**
 * /marketplace/category/[category]
 *
 * Lists all plugins in a category, with sort + filter controls (rendered
 * client-side).
 */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!isValidMarketplaceCategory(category)) {
    notFound();
  }
  const meta = categoryMeta(category);
  const plugins = await pluginCatalog.getByCategory(category, 200).catch(() => []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <MarketplaceHeader />
      <main className="flex-1">
        <div className="border-b border-border/60 bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
            <nav className="text-xs text-muted-foreground">
              <Link href="/marketplace" className="hover:text-foreground">
                Marketplace
              </Link>
              <span className="mx-1.5">/</span>
              <span className="text-foreground">{meta.label}</span>
            </nav>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{meta.label}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {meta.description}
            </p>
          </div>
        </div>
        <CategoryPageClient plugins={plugins as PublicPlugin[]} categoryKey={category} categoryLabel={meta.label} />
      </main>
      <MarketplaceFooter />
    </div>
  );
}
