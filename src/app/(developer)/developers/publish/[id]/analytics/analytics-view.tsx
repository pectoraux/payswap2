'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  DollarSign,
  Download,
  Loader2,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { PricingPlan } from '@/marketplace';

interface PluginInfo {
  id: string;
  slug: string;
  name: string;
  status: string;
  pricing: PricingPlan;
}

interface Analytics {
  pluginId: string;
  pluginName: string;
  installCount: number;
  activeInstalls: number;
  rating: number;
  reviewCount: number;
  estimatedRevenue: number;
  currency: string;
  installsByDay: Array<{ date: string; count: number }>;
  ratingTrend: Array<{ week: string; avg: number }>;
  reviewBreakdown: Array<{ stars: number; count: number }>;
}

export function AnalyticsView({ plugin }: { plugin: PluginInfo }) {
  const [analytics, setAnalytics] = React.useState<Analytics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/developer/publish/${plugin.id}/analytics`);
        const json = await res.json();
        if (!cancelled) {
          if (res.ok && json.ok) {
            setAnalytics(json.analytics);
          } else {
            setError(json.error ?? 'Failed to load analytics');
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plugin.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/developers/publish"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Back to dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {plugin.name} · Analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Badge className="mr-2 bg-muted text-muted-foreground">
              {plugin.status}
            </Badge>
            <span className="text-xs">slug: {plugin.slug}</span>
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {analytics && !loading && (
        <>
          {/* Top stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Download}
              label="Total installs"
              value={String(analytics.installCount)}
            />
            <StatCard
              icon={Users}
              label="Active installs"
              value={String(analytics.activeInstalls)}
              tone="text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              icon={Star}
              label="Rating"
              value={analytics.rating > 0 ? analytics.rating.toFixed(1) : '—'}
              sub={`${analytics.reviewCount} review${analytics.reviewCount === 1 ? '' : 's'}`}
            />
            <StatCard
              icon={DollarSign}
              label="Estimated revenue"
              value={`$${analytics.estimatedRevenue.toLocaleString()}`}
              sub={analytics.currency}
              tone="text-emerald-600 dark:text-emerald-400"
            />
          </div>

          {/* Installs chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Installs (last 30 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BarsChart
                data={analytics.installsByDay.map((d) => ({
                  label: d.date.slice(5),
                  value: d.count,
                }))}
                color="bg-emerald-500"
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Rating trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4" /> Rating trend (4 weeks)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BarsChart
                  data={analytics.ratingTrend.map((d) => ({
                    label: d.week,
                    value: d.avg,
                  }))}
                  color="bg-amber-500"
                  max={5}
                />
              </CardContent>
            </Card>

            {/* Review breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Review breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analytics.reviewBreakdown.map((r) => {
                    const max = Math.max(
                      ...analytics.reviewBreakdown.map((x) => x.count),
                      1,
                    );
                    return (
                      <li key={r.stars} className="flex items-center gap-2 text-sm">
                        <span className="w-12 text-xs text-muted-foreground">
                          {r.stars} ★
                        </span>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${(r.count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-xs tabular-nums">
                          {r.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Star;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className={`mt-2 text-2xl font-bold tabular-nums ${tone ?? ''}`}>
          {value}
        </div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function BarsChart({
  data,
  color,
  max,
}: {
  data: Array<{ label: string; value: number }>;
  color: string;
  max?: number;
}) {
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-32 items-end gap-0.5">
      {data.map((d, i) => (
        <div
          key={i}
          className="group relative flex-1"
          title={`${d.label}: ${d.value}`}
        >
          <div
            className={`w-full rounded-t ${color} opacity-80 transition-opacity group-hover:opacity-100`}
            style={{ height: `${Math.max((d.value / top) * 100, 2)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
