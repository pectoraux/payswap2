'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, MinusCircle, Clock, Zap, Shield, FlaskConical, Crown, AlertTriangle } from 'lucide-react';
import type { ExecutionProfile, ExecutionTrace, TraceStep } from '@/runtime/planner';

const PROFILE_ICONS: Record<ExecutionProfile, React.ElementType> = {
  FAST: Zap, SAFE: Shield, SIMULATION: FlaskConical, STRATEGIC: Crown, EMERGENCY: AlertTriangle,
};

const PROFILE_COLORS: Record<ExecutionProfile, string> = {
  FAST: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  SAFE: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  SIMULATION: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  STRATEGIC: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  EMERGENCY: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

const STEP_ICONS: Record<string, React.ElementType> = {
  success: CheckCircle2, failed: XCircle, skipped: MinusCircle,
};

export function ExecutionTraceViewer({ traces, stats }: {
  traces: ExecutionTrace[];
  stats?: {
    totalTraced: number;
    byProfile: Record<ExecutionProfile, number>;
    byStatus: Record<string, number>;
    avgDurationMs: number;
    p95DurationMs: number;
  };
}) {
  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total Traced</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalTraced}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Avg Duration</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.avgDurationMs}ms</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">P95 Duration</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.p95DurationMs}ms</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Success Rate</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalTraced > 0 ? Math.round(((stats.byStatus['completed'] ?? 0) / stats.totalTraced) * 100) : 0}%</div></CardContent></Card>
        </div>
      )}

      {stats && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Profile Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(stats.byProfile) as [ExecutionProfile, number][]).map(([profile, count]) => {
                const Icon = PROFILE_ICONS[profile];
                return (
                  <Badge key={profile} className={PROFILE_COLORS[profile]} variant="secondary">
                    <Icon className="mr-1 h-3 w-3" />{profile}: {count}
                  </Badge>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Execution Traces</CardTitle>
          <CardDescription>Each transaction's pipeline stages with timing</CardDescription>
        </CardHeader>
        <CardContent>
          {traces.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No traces yet. Execute a transaction to see the pipeline.</div>
          ) : (
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-3">
                {traces.map((trace) => <TraceCard key={trace.transactionId} trace={trace} />)}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TraceCard({ trace }: { trace: ExecutionTrace }) {
  const [expanded, setExpanded] = React.useState(false);
  const Icon = PROFILE_ICONS[trace.profile];
  return (
    <div className="rounded-lg border bg-card/50">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 p-3 text-left">
        <Badge className={PROFILE_COLORS[trace.profile]} variant="secondary"><Icon className="mr-1 h-3 w-3" />{trace.profile}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{trace.transactionId}</span>
        <span className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className={trace.finalStatus === 'completed' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'}>{trace.finalStatus}</Badge>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{trace.totalDurationMs}ms</span>
        </span>
      </button>
      {expanded && (
        <div className="border-t p-3">
          <div className="space-y-1">
            {trace.steps.map((step, i) => <StepRow key={i} step={step} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: TraceStep }) {
  const Icon = STEP_ICONS[step.result] ?? MinusCircle;
  const color = step.result === 'success' ? 'text-emerald-500' : step.result === 'failed' ? 'text-rose-500' : 'text-muted-foreground';
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
      <span className="w-32 shrink-0 font-medium">{step.stage}</span>
      <span className={`shrink-0 ${color}`}>{step.result}</span>
      <span className="shrink-0 text-muted-foreground">{step.durationMs}ms</span>
      {step.detail && <span className="truncate text-muted-foreground">— {step.detail}</span>}
    </div>
  );
}
