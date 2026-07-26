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
  AlertTriangle,
  RefreshCw,
  AlertOctagon,
  ShieldCheck,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';

type Severity = 'low' | 'medium' | 'high';

interface Assessment {
  severity: Severity;
  title: string;
  description: string;
  recommendation: string;
}

interface AssessmentsResponse {
  assessments: Assessment[];
  cached?: boolean;
}

const SEVERITY_META: Record<
  Severity,
  {
    label: string;
    border: string;
    iconBg: string;
    iconColor: string;
    badgeClass: string;
    icon: typeof ShieldAlert;
  }
> = {
  high: {
    label: 'High severity',
    border: 'border-l-rose-500',
    iconBg: 'bg-rose-500/10',
    iconColor: 'text-rose-600 dark:text-rose-400',
    badgeClass:
      'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    icon: ShieldAlert,
  },
  medium: {
    label: 'Medium severity',
    border: 'border-l-amber-500',
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-600 dark:text-amber-400',
    badgeClass:
      'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    icon: AlertCircle,
  },
  low: {
    label: 'Low severity',
    border: 'border-l-emerald-500',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    badgeClass:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    icon: ShieldCheck,
  },
};

/**
 * TreasuryAiRiskAssessment — a self-contained card that fetches AI-generated
 * risk assessments for the treasury team from `/api/ai/treasury` and renders
 * them with severity badges and recommendations.
 *
 * States: loading skeleton, error with retry, empty, and populated.
 */
export function TreasuryAiRiskAssessment() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEmpty(false);
    try {
      const res = await fetch('/api/ai/treasury?refresh=1', {
        cache: 'no-store',
      });
      const json = (await res.json()) as AssessmentsResponse & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to load risk assessments');
      }
      const list = json.assessments ?? [];
      setAssessments(list);
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
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              AI Risk Assessment
            </CardTitle>
            <CardDescription>
              AI-generated risk assessments across reserves, backing ratio and
              alert activity.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            aria-label="Refresh AI risk assessment"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <AssessmentsSkeleton />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : empty ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {assessments.map((assessment, idx) => (
              <AssessmentRow
                key={`${assessment.title}-${idx}`}
                assessment={assessment}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssessmentRow({ assessment }: { assessment: Assessment }) {
  const meta = SEVERITY_META[assessment.severity] ?? SEVERITY_META.medium;
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
          </div>
          <h4 className="mt-1.5 text-sm font-semibold leading-snug">
            {assessment.title}
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {assessment.description}
          </p>
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-500/5 p-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-xs leading-relaxed text-foreground">
              <span className="font-medium">Recommendation: </span>
              {assessment.recommendation}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssessmentsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        </div>
      ))}
      <p className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 animate-pulse text-amber-500" />
        Assessing reserve risk…
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
        AI risk assessment temporarily unavailable
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
        <ShieldCheck className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium">No risk assessments available</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">
        Risk assessments will appear here once treasury data is available for
        analysis.
      </p>
    </div>
  );
}
