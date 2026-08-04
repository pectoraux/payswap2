'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Download, Puzzle, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PublicPlugin, DeveloperProfile } from '@/marketplace/types';

interface Props {
  profile: DeveloperProfile;
  plugins: PublicPlugin[];
}

export function DeveloperPageClient({ profile, plugins }: Props) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <nav className="text-xs text-muted-foreground">
        <Link href="/marketplace" className="hover:text-foreground">
          Marketplace
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">Developer</span>
      </nav>

      {/* Profile header */}
      <Card className="mt-3">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xl font-bold">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{profile.name}</h1>
                {profile.verified && (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <BadgeCheck className="h-3 w-3" /> Verified developer
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{profile.email}</p>
              {profile.bio && <p className="mt-2 text-sm">{profile.bio}</p>}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Puzzle className="h-3.5 w-3.5" />
                  {profile.pluginCount} plugin{profile.pluginCount === 1 ? '' : 's'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Download className="h-3.5 w-3.5" />
                  {profile.totalInstalls} total installs
                </span>
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  {profile.aggregateRating > 0
                    ? `${profile.aggregateRating.toFixed(1)} avg`
                    : 'No ratings'}
                </span>
                <span>
                  Joined {new Date(profile.joinedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plugins */}
      <h2 className="mt-8 text-lg font-bold">Published plugins</h2>
      {plugins.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed bg-card/50 p-10 text-center">
          <Puzzle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No published plugins yet.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((p) => (
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
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
                  <div className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    View details
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
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
