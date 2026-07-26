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
  Lightbulb,
  RefreshCw,
  AlertOctagon,
  ArrowUp,
  Minus,
  ArrowDown,
} from 'lucide-react';

type Impact = 'high' | 'medium' | 'low';

interface Recommendation {
  title: string;
  description: string;
  impact: Impact;
}

interface RecommendationsResponse {
  recommendations: Recommendation[];
  cached?: boolean;
}

const IMPACT_META: Record<
  Impact,
  {
    label: string;
    badgeClass: string;
    dotClass: string;
    icon: typeof ArrowUp;
  }
> = {
  high: {
    label: 'High impact',
    badgeClass:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    dotClass: 'bg-emerald-500',
    icon: ArrowUp,
  },
  medium: {
    label: 'Medium impact',
    badgeClass:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dotClass: 'bg-amber-500',
    icon: Minus,
  },
  low: {
    label: 'Low impact',
    badgeClass:
      'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    dotClass: 'bg-sky-500',
    icon: ArrowDown,
  },
};

/**
 * LpAiRecommendations — a self-contained card that fetches AI-generated
 * optimization recommendations for the LP from `/api/ai/lp-recommendations`
 * and renders them with impact badges.
 *
 * States: loading skeleton, error with retry, empty, and populated.
 */
export function LpAiRecommendations() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmpty(false);
    try {
      const res = await fetch('/api/ai/lp-recommendations?refresh=1', {
        cache: 'no-store',
      });
      const json = (await res.json()) as RecommendationsResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load recommendations');
      }
      const list = json.recommendations ?? [];
      setRecommendations(list);
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
    <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.03] to-transparent">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-emerald-500" />
              AI Recommendations
            </CardTitle>
            <CardDescription>
              Optimization suggestions for your liquidity business, generated
              from your positions and settlement activity.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            aria-label="Refresh AI recommendations"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <RecommendationsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : empty ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec, idx) => (
              <RecommendationRow key={`${rec.title}-${idx}`} recommendation={rec} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationRow({ recommendation }: { recommendation: Recommendation }) {
  const meta = IMPACT_META[recommendation.impact] ?? IMPACT_META.medium;
  const Icon = meta.icon;

  return (
    <div className="rounded-lg border bg-card/50 p-4 transition-colors hover:bg-accent/40">
      <div className="flex items-start gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        >
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`h-5 gap-1 px-1.5 text-[10px] font-medium uppercase tracking-wide ${meta.badgeClass}`}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </Badge>
          </div>
          <h4 className="mt-1.5 text-sm font-semibold leading-snug">
            {recommendation.title}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {recommendation.description}
          </p>
        </div>
      </div>
    </div>
  );
}

function RecommendationsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
      <p className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5 animate-pulse text-emerald-500" />
        Analyzing your liquidity position…
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
        AI recommendations temporarily unavailable
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
        <Lightbulb className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium">No recommendations yet</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Once your LP position has activity, AI recommendations will appear here
        to help optimize your liquidity business.
      </p>
    </div>
  );
}
