'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Download,
  Puzzle,
  Search,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CATEGORY_META, type PublicPlugin } from '@/marketplace';

interface Props {
  initialPlugins: PublicPlugin[];
  initialQuery: string;
  initialCategory: string;
  initialPricing: string;
  initialMinRating: string;
  initialCapabilityType: string;
  initialFree: boolean;
}

const CAPABILITY_TYPES = [
  'settlement-rail',
  'wallet',
  'compliance',
  'identity',
  'analytics',
  'fraud-detection',
  'corridor-optimizer',
  'pricing-engine',
  'country',
  'stablecoin',
  'twin-token',
  'marketplace-algorithm',
  'ai-director',
  'notification',
  'custom',
];

export function SearchPageClient({
  initialPlugins,
  initialQuery,
  initialCategory,
  initialPricing,
  initialMinRating,
  initialCapabilityType,
  initialFree,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(initialQuery);
  const [category, setCategory] = React.useState(initialCategory);
  const [pricing, setPricing] = React.useState(initialPricing);
  const [minRating, setMinRating] = React.useState(initialMinRating);
  const [capabilityType, setCapabilityType] = React.useState(initialCapabilityType);
  const [free, setFree] = React.useState(initialFree);

  // Debounced URL sync.
  React.useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category && category !== 'all') params.set('category', category);
      if (pricing && pricing !== 'all') params.set('pricing', pricing);
      if (minRating) params.set('minRating', minRating);
      if (capabilityType && capabilityType !== 'all') params.set('capabilityType', capabilityType);
      if (free) params.set('free', '1');
      router.replace(`/marketplace/search?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
  }, [q, category, pricing, minRating, capabilityType, free, router]);

  // Client-side filter (in addition to the server-side filter, since the
  // server applies the same filters but we also want instant UI feedback
  // when the user toggles a facet without waiting for the debounce).
  const filtered = React.useMemo(() => {
    let list = initialPlugins;
    if (category && category !== 'all') list = list.filter((p) => p.category === category);
    if (pricing && pricing !== 'all') {
      list = list.filter((p) =>
        pricing === 'free' ? p.pricing.model === 'free' : p.pricing.model === pricing,
      );
    }
    if (free) list = list.filter((p) => p.pricing.model === 'free');
    if (minRating) {
      const r = Number(minRating);
      if (!Number.isNaN(r)) list = list.filter((p) => p.rating >= r);
    }
    if (capabilityType && capabilityType !== 'all') {
      list = list.filter((p) => p.capabilityTypes.includes(capabilityType as any));
    }
    return list;
  }, [initialPlugins, category, pricing, free, minRating, capabilityType]);

  const hasFilters =
    (category && category !== 'all') ||
    (pricing && pricing !== 'all') ||
    minRating ||
    (capabilityType && capabilityType !== 'all') ||
    free;

  const clearFilters = () => {
    setCategory('all');
    setPricing('all');
    setMinRating('');
    setCapabilityType('all');
    setFree(false);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Facets */}
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs font-medium">Category</label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {CATEGORY_META.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Pricing</label>
                <Select value={pricing} onValueChange={setPricing}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All prices</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="one-time">One-time</SelectItem>
                    <SelectItem value="subscription">Subscription</SelectItem>
                    <SelectItem value="usage-based">Usage-based</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Min rating</label>
                <Select value={minRating || 'all'} onValueChange={setMinRating}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any rating</SelectItem>
                    <SelectItem value="3">3+ stars</SelectItem>
                    <SelectItem value="4">4+ stars</SelectItem>
                    <SelectItem value="4.5">4.5+ stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Capability type</label>
                <Select value={capabilityType} onValueChange={setCapabilityType}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {CAPABILITY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  checked={free}
                  onChange={(e) => setFree(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span className="text-xs">Free only</span>
              </label>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="w-full"
                >
                  <X className="h-3.5 w-3.5" /> Clear filters
                </Button>
              )}
            </CardContent>
          </Card>
        </aside>

        {/* Results */}
        <div>
          {/* Search bar */}
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search plugins…"
              className="h-10 pl-10"
            />
          </div>

          <div className="mb-3 text-sm text-muted-foreground">
            {filtered.length} result{filtered.length === 1 ? '' : 's'}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
              <Puzzle className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-3 text-base font-semibold">No plugins found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different query or clear your filters.
              </p>
              {hasFilters && (
                <Button onClick={clearFilters} size="sm" variant="outline" className="mt-4">
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <Link
                  key={p.id}
                  href={`/marketplace/plugin/${p.slug}`}
                  className="group block rounded-xl border bg-card transition-all hover:border-emerald-500/40 hover:shadow-md"
                >
                  <Card className="h-full border-0">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <Puzzle className="h-5 w-5" />
                        </div>
                        {p.featured && (
                          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            Featured
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="mt-2 text-base font-semibold leading-tight">
                        {p.name}
                      </CardTitle>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-1">
                        {p.capabilityTypes.slice(0, 3).map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-amber-500" />
                          {p.rating > 0 ? p.rating.toFixed(1) : 'New'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Download className="h-3.5 w-3.5" />
                          {p.installCount}
                        </span>
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          {p.pricing.summary}
                        </Badge>
                      </div>
                      <div className="mt-2 text-[10px] text-muted-foreground">
                        by {p.developerName}
                        {p.developerVerified && (
                          <ShieldCheck className="ml-1 inline h-3 w-3 text-emerald-500" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
