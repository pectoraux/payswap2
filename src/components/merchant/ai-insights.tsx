'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  RefreshCw,
  AlertOctagon,
  TrendingUp,
  AlertTriangle,
  Rocket,
  ShieldAlert,
} from 'lucide-react';

type InsightType = 'positive' | 'warning' | 'opportunity' | 'risk';

interface Insight {
  type: InsightType;
  title: string;
  description: string;
  metric?: string;
}

interface InsightsResponse {
  insights: Insight[];
  cached?: boolean;
}

const TYPE_META: Record<
  InsightType,
  {
    label: string;
    /** Color-coded left border + icon tint. */
    border: string;
    iconBg: string;
    iconColor: string;
    badgeClass: string;
    icon: typeof TrendingUp;
  }
> = {
  positive: {
    label: 'Positive',
    border: 'border-l-emerald-500',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    badgeClass:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    icon: TrendingUp,
  },
  warning: {
    label: 'Warning',
    border: 'border-l-amber-500',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
    badgeClass:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    icon: AlertTriangle,
  },
  opportunity: {
    label: 'Opportunity',
    border: 'border-l-sky-500',
    iconBg: 'bg-sky-500/10',
    iconColor: 'text-sky-600 dark:text-sky-400',
    badgeClass:
      'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    icon: Rocket,
  },
  risk: {
    label: 'Risk',
    border: 'border-l-rose-500',
    iconBg: 'bg-rose-500/10',
    iconColor: 'text-rose-600 dark:text-rose-400',
    badgeClass:
      'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    icon: ShieldAlert,
  },
};

/**
 * AiInsights — a self-contained card that fetches AI-generated, data-driven
 * insights for the merchant from `/api/ai/insights` and renders them as
 * color-coded rows.
 *
 * States: loading skeleton, error with retry, empty, and populated. The
 * Refresh button forces a cache-busting refetch.
 */
export function AiInsights() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmpty(false);
    try {
      const res = await fetch('/api/ai/insights?refresh=1', { cache: 'no-store' });
      const json = (await res.json()) as InsightsResponse & { error?: string };
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load AI insights');
      }
      const list = json.insights ?? [];
      setInsights(list);
      setEmpty(list.length === 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-emerald-500" />
              AI Insights
            </CardTitle>
            <CardDescription>
              Data-driven observations and recommendations for your merchant
              account.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            aria-label="Refresh AI insights"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <InsightsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : empty ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {insights.map((insight, idx) => (
              <InsightRow key={`${insight.title}-${idx}`} insight={insight} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const meta = TYPE_META[insight.type] ?? TYPE_META.opportunity;
  const Icon = meta.icon;

  return (
    <div
      className={`rounded-lg border border-l-4 ${meta.border} bg-card/50 p-4 transition-colors hover:bg-accent/40`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${meta.iconBg}`}
          aria-hidden
        >
          <Icon className={`h-4 w-4 ${meta.iconColor}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`h-5 px-1.5 text-[10px] font-medium uppercase tracking-wide ${meta.badgeClass}`}
            >
              {meta.label}
            </Badge>
            {insight.metric && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-semibold tabular-nums"
              >
                {insight.metric}
              </Badge>
            )}
          </div>
          <h4 className="mt-1.5 text-sm font-semibold leading-snug">
            {insight.title}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {insight.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-3">
        <Skeleton className="h-8 w-8 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <p className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 animate-pulse text-emerald-500" />
        Analyzing your data…
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <AlertOctagon className="mb-2 h-8 w-8 text-rose-500" />
      <p className="text-sm font-medium">
        AI insights temporarily unavailable
      </p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-3"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <Sparkles className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium">No insights yet</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Make some payments to get started — AI insights appear once there is
        activity to analyze.
      </p>
    </div>
  );
}
