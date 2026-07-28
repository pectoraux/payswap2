import Link from 'next/link';
import { pluginCatalog, CATEGORY_META } from '@/marketplace';
import { MarketplaceHeader, MarketplaceFooter } from './_components/marketplace-header';
import { MarketplaceHomeClient } from './_components/marketplace-home';
import type { PublicPlugin } from '@/marketplace';

export const dynamic = 'force-dynamic';

/**
 * Public marketplace home — accessible without login (like Stripe's app
 * marketplace). Shows:
 *   - Hero section: "Build on PaySwap — The Financial Operating System"
 *   - Featured plugins carousel
 *   - Category browser (9 categories)
 *   - Search bar
 *   - Popular plugins grid
 *   - "Publish your plugin" CTA
 */
export default async function MarketplaceHomePage() {
  const [featured, popular, newest] = await Promise.all([
    pluginCatalog.getFeatured(8).catch(() => []),
    pluginCatalog.getPopular(8).catch(() => []),
    pluginCatalog.getNewest(8).catch(() => []),
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <MarketplaceHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-border/60">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -top-32 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
            <div className="absolute top-40 right-0 h-[28rem] w-[28rem] rounded-full bg-teal-500/10 blur-3xl" />
          </div>
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              The Financial Operating System
            </div>
            <h1 className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Build on PaySwap —{' '}
              <span className="bg-gradient-to-r from-emerald-500 to-teal-400 bg-clip-text text-transparent">
                the public ecosystem marketplace
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
              Browse and install community-built settlement rails, wallets,
              compliance modules, fraud engines, AI directors and analytics
              packs. One plugin model, every capability, every corridor.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="#categories"
                className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-600 px-6 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
              >
                Browse categories
              </Link>
              <Link
                href="/developers/publish"
                className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-6 text-sm font-medium hover:bg-muted"
              >
                Publish your plugin →
              </Link>
            </div>
          </div>
        </section>

        <MarketplaceHomeClient
          featured={featured as PublicPlugin[]}
          popular={popular as PublicPlugin[]}
          newest={newest as PublicPlugin[]}
          categories={CATEGORY_META}
        />
      </main>

      <MarketplaceFooter />
    </div>
  );
}
