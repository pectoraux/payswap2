'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCcw, Activity } from 'lucide-react';
import { ExecutionTraceViewer } from '@/components/admin/planner/execution-trace-viewer';
import type {
  ExecutionProfile,
  ExecutionTrace,
} from '@/runtime/planner';

interface PlannerStats {
  totalTraced: number;
  byProfile: Record<ExecutionProfile, number>;
  byStatus: Record<string, number>;
  avgDurationMs: number;
  p95DurationMs: number;
}

interface PlannerTelemetry {
  stats: PlannerStats;
  recentTraces: ExecutionTrace[];
  profiles: Array<{
    profile: ExecutionProfile;
    description: string;
    stages: string[];
    invokeCouncil: boolean;
    invokeTwin: boolean;
    invokeSettlement: boolean;
    invokeCoordinator: boolean;
    timeoutMs: number;
  }>;
}

/**
 * Wraps `ExecutionTraceViewer` with a fetch-on-mount + manual-refresh data
 * source for /api/runtime/planner. Used on the admin runtime console so the
 * planner telemetry lives next to the simulator.
 */
export function PlannerTelemetryPanel() {
  const [data, setData] = React.useState<PlannerTelemetry | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/runtime/planner', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || `Failed (${res.status})`);
      }
      setData(json as PlannerTelemetry);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load telemetry');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Execution Planner Telemetry</CardTitle>
              <p className="text-xs text-muted-foreground">
                Recent execution traces, profile distribution, and timing
                percentiles from the runtime execution planner.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading planner telemetry…
          </div>
        ) : (
          <ExecutionTraceViewer
            traces={data.recentTraces ?? []}
            stats={data.stats}
          />
        )}
      </CardContent>
    </Card>
  );
}
