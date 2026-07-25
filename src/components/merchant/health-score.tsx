'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  HeartPulse,
  Lightbulb,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type FactorStatus = 'good' | 'warn' | 'bad';

interface Factor {
  name: string;
  value: number;
  display: string;
  hint: string;
  max: number;
  status: FactorStatus;
}

interface HealthResponse {
  score: number;
  status: FactorStatus;
  factors: Factor[];
  recommendations: string[];
}

const STATUS_META: Record<
  FactorStatus,
  {
    label: string;
    ring: string;
    text: string;
    bar: string;
    icon: typeof CheckCircle2;
  }
> = {
  good: {
    label: 'Healthy',
    ring: 'stroke-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-gradient-to-r from-emerald-500 to-teal-400',
    icon: CheckCircle2,
  },
  warn: {
    label: 'Needs attention',
    ring: 'stroke-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-gradient-to-r from-amber-500 to-yellow-400',
    icon: AlertTriangle,
  },
  bad: {
    label: 'At risk',
    ring: 'stroke-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
    bar: 'bg-gradient-to-r from-rose-500 to-red-400',
    icon: AlertOctagon,
  },
};

/**
 * HealthScore — a self-contained card that fetches the merchant's health
 * score from /api/merchant/health and renders an overall gauge, a factor
 * breakdown, and actionable recommendations.
 */
export function HealthScore() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/merchant/health', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load health score');
      }
      setData(json as HealthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartPulse className="h-4 w-4 text-emerald-500" />
              Merchant Health Score
            </CardTitle>
            <CardDescription>
              A real-time snapshot of your account&apos;s payment, refund, and
              integration health.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            aria-label="Refresh health score"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <HealthSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertOctagon className="h-8 w-8 text-rose-500 mb-2" />
            <p className="text-sm font-medium">Couldn&apos;t load health score</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={load}
              className="mt-3"
            >
              Try again
            </Button>
          </div>
        ) : (
          <HealthBody data={data!} />
        )}
      </CardContent>
    </Card>
  );
}

function HealthBody({ data }: { data: HealthResponse }) {
  const meta = STATUS_META[data.status];
  const ScoreIcon = meta.icon;

  return (
    <div className="space-y-6">
      {/* Top row: gauge + summary */}
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <ScoreGauge score={data.score} status={data.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ScoreIcon className={`h-5 w-5 ${meta.text}`} />
            <span className={`text-lg font-bold ${meta.text}`}>
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Your health score is{' '}
            <span className="font-semibold text-foreground">{data.score}</span>
            /100.{' '}
            {data.status === 'good'
              ? 'All systems are performing well.'
              : data.status === 'warn'
                ? 'A few areas could use attention.'
                : 'Several areas need immediate attention.'}
          </p>
        </div>
      </div>

      {/* Factor bars */}
      <div className="space-y-3.5">
        {data.factors.map((f) => (
          <FactorRow key={f.name} factor={f} />
        ))}
      </div>

      {/* Recommendations */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recommendations
          </span>
        </div>
        <ul className="space-y-1.5">
          {data.recommendations.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">{r}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FactorRow({ factor }: { factor: Factor }) {
  const m = STATUS_META[factor.status];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">{factor.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {factor.display}
          </span>
          <Badge
            variant="secondary"
            className={`h-5 px-1.5 text-[9px] font-medium ${m.text}`}
          >
            {factor.value}
          </Badge>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${m.bar}`}
          style={{ width: `${Math.max(factor.value, 2)}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{factor.hint}</p>
    </div>
  );
}

/** Circular SVG gauge that renders the 0–100 score. */
function ScoreGauge({
  score,
  status,
}: {
  score: number;
  status: FactorStatus;
}) {
  const m = STATUS_META[status];
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
      <svg
        className="h-32 w-32 -rotate-90"
        viewBox="0 0 112 112"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="56"
          cy="56"
          r={radius}
          className="stroke-muted"
          strokeWidth="9"
        />
        <circle
          cx="56"
          cy="56"
          r={radius}
          className={`${m.ring} transition-[stroke-dashoffset] duration-700 ease-out`}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold tabular-nums ${m.text}`}>
          {score}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          / 100
        </span>
      </div>
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <Skeleton className="h-32 w-32 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <Skeleton className="h-4 w-2/3 max-w-xs" />
        </div>
      </div>
      <div className="space-y-3.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className="mb-1 flex justify-between">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
