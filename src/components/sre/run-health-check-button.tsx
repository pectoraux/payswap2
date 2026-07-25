'use client';

import { useState } from 'react';
import { HeartPulse, Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface HealthSummary {
  timestamp: string;
  process: {
    nodeVersion: string;
    platform: string;
    arch: string;
    pid: number;
    uptime: string;
    uptimeSeconds: number;
    memory: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
      memoryPct: number;
      heapPct: number;
    };
    eventLoopLagMs: number;
  };
  resilience: {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    components: Array<{ name: string; healthy: boolean; details?: string }>;
    outages: Array<{ id: string; severity: string }>;
    circuits: Array<{ name: string; state: string }>;
    dlqDepth: number;
    partialSettlementsPending: number;
    lastCheckTs: number;
  };
  connectors: {
    total: number;
    healthy: number;
    degraded: number;
  };
  database: {
    events: number;
    payments: number;
    auditLogs: number;
    failedWebhookDeliveries: number;
  };
}

const OVERALL_ICON = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  unhealthy: XCircle,
} as const;

const OVERALL_TONE = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  degraded: 'text-amber-600 dark:text-amber-400',
  unhealthy: 'text-rose-600 dark:text-rose-400',
} as const;

/**
 * "Run Health Check" quick action. Opens a dialog and fetches the
 * aggregated health summary from /api/ops/sre/health-check. Shows the
 * summary inline with a per-section breakdown.
 */
export function RunHealthCheckButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<HealthSummary | null>(null);

  async function runCheck() {
    setOpen(true);
    setLoading(true);
    setSummary(null);
    try {
      const res = await fetch('/api/ops/sre/health-check', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setSummary(data as HealthSummary);
      toast.success('Health check complete');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setLoading(false);
    }
  }

  const overall = summary?.resilience.overall ?? 'healthy';
  const OverallIcon = OVERALL_ICON[overall];

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => runCheck()}
        className="gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        <HeartPulse className="h-4 w-4" />
        Run health check
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : summary ? (
                <OverallIcon className={`h-4 w-4 ${OVERALL_TONE[overall]}`} />
              ) : (
                <HeartPulse className="h-4 w-4 text-muted-foreground" />
              )}
              System health summary
            </DialogTitle>
            <DialogDescription>
              Aggregated health snapshot of the Node process, resilience layer,
              connectors and database.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running checks…
            </div>
          ) : summary ? (
            <div className="space-y-4">
              {/* Overall banner */}
              <div
                className={`rounded-lg border border-emerald-500/30 p-3 text-sm font-semibold ${OVERALL_TONE[overall]}`}
              >
                <span className="inline-flex items-center gap-2 capitalize">
                  <OverallIcon className="h-4 w-4" /> Resilience: {overall}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Process */}
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Process
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <div>
                      <span className="text-muted-foreground">Node:</span>{' '}
                      {summary.process.nodeVersion}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Uptime:</span>{' '}
                      {summary.process.uptime}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Memory:</span>{' '}
                      {summary.process.memory.rssMb} MB ({summary.process.memory.memoryPct}%)
                    </div>
                    <div>
                      <span className="text-muted-foreground">Heap:</span>{' '}
                      {summary.process.memory.heapUsedMb}/{summary.process.memory.heapTotalMb} MB
                    </div>
                    <div>
                      <span className="text-muted-foreground">Event-loop lag:</span>{' '}
                      {summary.process.eventLoopLagMs} ms
                    </div>
                  </div>
                </div>

                {/* Connectors */}
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Connectors
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <div>
                      <span className="text-muted-foreground">Total:</span>{' '}
                      {summary.connectors.total}
                    </div>
                    <div className="text-emerald-600 dark:text-emerald-400">
                      Healthy: {summary.connectors.healthy}
                    </div>
                    <div className={summary.connectors.degraded > 0 ? 'text-rose-600 dark:text-rose-400' : ''}>
                      Degraded: {summary.connectors.degraded}
                    </div>
                  </div>
                </div>

                {/* Resilience */}
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Resilience
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <div>
                      <span className="text-muted-foreground">Outages:</span>{' '}
                      {summary.resilience.outages.length}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Open circuits:</span>{' '}
                      {summary.resilience.circuits.filter((c) => c.state === 'open').length}
                    </div>
                    <div>
                      <span className="text-muted-foreground">DLQ depth:</span>{' '}
                      {summary.resilience.dlqDepth}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Partial settlements:</span>{' '}
                      {summary.resilience.partialSettlementsPending}
                    </div>
                  </div>
                </div>

                {/* Database */}
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Database
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs">
                    <div>
                      <span className="text-muted-foreground">Events:</span>{' '}
                      {summary.database.events.toLocaleString()}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Payments:</span>{' '}
                      {summary.database.payments.toLocaleString()}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Audit logs:</span>{' '}
                      {summary.database.auditLogs.toLocaleString()}
                    </div>
                    <div className={summary.database.failedWebhookDeliveries > 0 ? 'text-rose-600 dark:text-rose-400' : ''}>
                      <span className="text-muted-foreground">Failed webhooks:</span>{' '}
                      {summary.database.failedWebhookDeliveries.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-right text-[10px] text-muted-foreground">
                Generated {new Date(summary.timestamp).toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No data
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
