'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Search,
  Star,
  Download,
  Sparkles,
  Globe2,
  Route as RouteIcon,
  Fingerprint,
  ShieldCheck,
  Wallet,
  ShieldAlert,
  Network,
  BarChart3,
  Puzzle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PublicPlugin, CategoryMeta } from '@/marketplace/types';

const ICONS: Record<string, LucideIcon> = {
  Globe2,
  Route: RouteIcon,
  Fingerprint,
  ShieldCheck,
  Wallet,
  ShieldAlert,
  Sparkles,
  Network,
  BarChart3,
  Puzzle,
};

interface Props {
  featured: PublicPlugin[];
  popular: PublicPlugin[];
  newest: PublicPlugin[];
  categories: CategoryMeta[];
}

export function MarketplaceHomeClient({ featured, popular, newest, categories }: Props) {
  const router = useRouter();
  const [q, setQ] = React.useState('');

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) {
      router.push(`/marketplace/search?q=${encodeURIComponent(q.trim())}`);
    }
  };

  return (
    <>
      {/* Search bar */}
      <section className="border-b border-border/60 bg-muted/20">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <form onSubmit={onSearch}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, capability or tag — e.g. 'MTN MoMo', 'OFAC', 'treasury AI'"
                className="h-12 bg-background pl-11 text-base"
                autoFocus
              />
            </div>
          </form>
        </div>
      </section>

      {/* Featured */}
      {featured.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <SectionHeader
            title="Featured plugins"
            description="Hand-picked by the PaySwap team."
            href="/marketplace/search"
          />
          <PluginCarousel plugins={featured} />
        </section>
      )}

      {/* Category browser */}
      <section id="categories" className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <SectionHeader title="Browse by category" description="Nine capability categories. One plugin model." />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => {
              const Icon = ICONS[c.icon] ?? Puzzle;
              return (
                <Link
                  key={c.key}
                  href={`/marketplace/category/${c.key}`}
                  className="group rounded-xl border bg-card p-5 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/5"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 flex items-center gap-1.5 text-sm font-semibold">
                    {c.label}
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-500" />
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Popular */}
      {popular.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <SectionHeader
            title="Popular plugins"
            description="Most-installed across the marketplace."
            href="/marketplace/search?sort=popular"
          />
          <PluginGrid plugins={popular} />
        </section>
      )}

      {/* Newest */}
      {newest.length > 0 && (
        <section className="border-t border-border/60 bg-muted/20">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
            <SectionHeader
              title="New on the marketplace"
              description="Fresh off the press."
              href="/marketplace/search?sort=newest"
            />
            <PluginGrid plugins={newest} />
          </div>
        </section>
      )}

      {/* Publish CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 text-center">
          <Sparkles className="mx-auto h-10 w-10 text-emerald-500" />
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Built a plugin? Publish it to the world.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Package your settlement rail, wallet, compliance module or AI
            director with the Capability SDK and reach every PaySwap merchant
            in a single click.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/developers/publish">
                Publish your plugin <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11">
              <Link href="/developers/docs">Read the SDK docs</Link>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {[
              'Schema validation',
              'Security scan',
              'Sandbox test',
              'Capability check',
            ].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeader({
  title,
  description,
  href,
}: {
  title: string;
  description?: string;
  href?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-sm font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
        >
          View all →
        </Link>
      )}
    </div>
  );
}

function PluginCarousel({ plugins }: { plugins: PublicPlugin[] }) {
  return (
    <div className="mt-6 flex gap-4 overflow-x-auto pb-4 [-ms-overflow-style:none] [scrollbar-width:thin]">
      {plugins.map((p) => (
        <PluginCard key={p.id} plugin={p} compact />
      ))}
    </div>
  );
}

function PluginGrid({ plugins }: { plugins: PublicPlugin[] }) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plugins.map((p) => (
        <PluginCard key={p.id} plugin={p} />
      ))}
    </div>
  );
}

function PluginCard({ plugin, compact }: { plugin: PublicPlugin; compact?: boolean }) {
  return (
    <Link
      href={`/marketplace/plugin/${plugin.slug}`}
      className={`group block rounded-xl border bg-card transition-all hover:border-emerald-500/40 hover:shadow-md ${
        compact ? 'w-72 shrink-0' : ''
      }`}
    >
      <Card className="h-full border-0">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Puzzle className="h-5 w-5" />
            </div>
            {plugin.featured && (
              <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Sparkles className="h-3 w-3" /> Featured
              </Badge>
            )}
          </div>
          <CardTitle className="mt-2 text-base font-semibold leading-tight">
            {plugin.name}
          </CardTitle>
          <CardDescription className="line-clamp-2 text-xs">
            {plugin.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-amber-500" />
              {plugin.rating > 0 ? plugin.rating.toFixed(1) : 'New'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Download className="h-3.5 w-3.5" />
              {plugin.installCount}
            </span>
            <Badge variant="outline" className="ml-auto text-[10px]">
              {plugin.pricing.summary}
            </Badge>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            by {plugin.developerName}
            {plugin.developerVerified && (
              <ShieldCheck className="ml-1 inline h-3 w-3 text-emerald-500" />
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
