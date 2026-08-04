'use client';

import * as React from 'react';
import Link from 'next/link';
import { Star, Download, Puzzle, ShieldCheck, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PublicPlugin } from '@/marketplace/types';

interface Props {
  plugins: PublicPlugin[];
  categoryKey: string;
  categoryLabel: string;
}

type SortKey = 'popular' | 'newest' | 'rating' | 'name';
type PriceFilter = 'all' | 'free' | 'paid';

export function CategoryPageClient({ plugins, categoryKey, categoryLabel }: Props) {
  const [sort, setSort] = React.useState<SortKey>('popular');
  const [price, setPrice] = React.useState<PriceFilter>('all');

  const filtered = React.useMemo(() => {
    let list = plugins;
    if (price === 'free') list = list.filter((p) => p.pricing.model === 'free');
    if (price === 'paid') list = list.filter((p) => p.pricing.model !== 'free');

    const sorted = [...list];
    if (sort === 'newest') {
      sorted.sort(
        (a, b) =>
          new Date(b.publishedAt ?? b.createdAt).getTime() -
          new Date(a.publishedAt ?? a.createdAt).getTime(),
      );
    } else if (sort === 'rating') {
      sorted.sort((a, b) => b.rating - a.rating);
    } else if (sort === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => b.installCount - a.installCount);
    }
    return sorted;
  }, [plugins, sort, price]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {filtered.length} plugin{filtered.length === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={price} onValueChange={(v) => setPrice(v as PriceFilter)}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All prices</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Most popular</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="rating">Top rated</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
          <Puzzle className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold">No plugins yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Be the first to publish a {categoryLabel} plugin.
          </p>
          <Button asChild size="sm" className="mt-4 bg-emerald-600 text-white hover:bg-emerald-700">
            <Link href="/developers/publish">
              Publish a plugin <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  <CardDescription className="line-clamp-2 text-xs">
                    {p.description}
                  </CardDescription>
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
  );
}
