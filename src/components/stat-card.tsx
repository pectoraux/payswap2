import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StatTrend = 'up' | 'down' | 'neutral';
export type StatColor = 'emerald' | 'teal' | 'amber' | 'rose' | 'violet' | 'sky';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  trend?: StatTrend;
  trendValue?: string;
  color?: StatColor;
  loading?: boolean;
}

const colorMap: Record<StatColor, string> = {
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
};

/**
 * KPI stat card — label, value, optional icon, optional trend indicator.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  trendValue,
  color = 'emerald',
  loading,
}: StatCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          {loading ? (
            <div className="h-7 w-24 animate-pulse rounded bg-muted" />
          ) : (
            <div className="truncate text-2xl font-semibold tracking-tight">{value}</div>
          )}
          {(hint || trend) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {trend && trend !== 'neutral' && trendValue && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium',
                    trend === 'up'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                  )}
                >
                  {trend === 'up' ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {trendValue}
                </span>
              )}
              {hint && <span className="truncate">{hint}</span>}
            </div>
          )}
        </div>
        {icon ? (
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              colorMap[color],
            )}
          >
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
