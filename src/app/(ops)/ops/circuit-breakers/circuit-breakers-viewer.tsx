'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Radio,
  RefreshCcw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

export interface CircuitBreakerStatsDTO {
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  successCount: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

const STATE_STYLES: Record<CircuitBreakerStatsDTO['state'], string> = {
  CLOSED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  OPEN: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  HALF_OPEN: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

function fmtDate(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Ops: Circuit Breakers console.
 *
 * Lists every circuit breaker the runtime is tracking. The "Reset All"
 * action force-closes every breaker so calls start flowing again after an
 * outage. Initial state is rendered server-side.
 */
export function CircuitBreakersViewer({
  initial,
}: {
  initial: CircuitBreakerStatsDTO[];
}) {
  const [breakers, setBreakers] = React.useState<CircuitBreakerStatsDTO[]>(initial);
  const [loading, setLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/circuit-breakers', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      setBreakers((data.breakers ?? []) as CircuitBreakerStatsDTO[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, []);

  async function resetAll() {
    setResetting(true);
    try {
      const res = await fetch('/api/ops/circuit-breakers', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed (${res.status})`);
      }
      toast.success(data?.message || 'All circuit breakers reset');
      setOpen(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  const openCount = breakers.filter((b) => b.state === 'OPEN').length;
  const halfOpenCount = breakers.filter((b) => b.state === 'HALF_OPEN').length;
  const closedCount = breakers.filter((b) => b.state === 'CLOSED').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Breakers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{breakers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Closed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {closedCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Half-Open</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {halfOpenCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {openCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4" />
                Circuit Breakers
              </CardTitle>
              <CardDescription>
                Each external service has a breaker that opens after repeated
                failures. Open breakers fail fast — reset them once the
                underlying service is healthy.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
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
              <AlertDialog open={open} onOpenChange={setOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    Reset All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all circuit breakers?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This force-closes every circuit breaker in the runtime so
                      calls start flowing again immediately. Use it only when
                      you are confident the underlying services have recovered.
                      {openCount + halfOpenCount > 0
                        ? ` ${openCount + halfOpenCount} breaker${
                            openCount + halfOpenCount === 1 ? ' is' : 's are'
                          } currently not closed.`
                        : ' No breakers are currently open or half-open.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={resetting}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        void resetAll();
                      }}
                      disabled={resetting}
                      className="bg-amber-600 text-white hover:bg-amber-700"
                    >
                      {resetting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting…
                        </>
                      ) : (
                        'Reset all breakers'
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {breakers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No breakers registered</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Circuit breakers are created lazily the first time an external
                service is called. They will appear here after the runtime has
                dispatched at least one call.
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Service</TableHead>
                    <TableHead className="w-[110px]">State</TableHead>
                    <TableHead className="text-right">Failures</TableHead>
                    <TableHead className="text-right">Successes</TableHead>
                    <TableHead className="text-right">Total Calls</TableHead>
                    <TableHead>Last Failure</TableHead>
                    <TableHead>Last Success</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakers.map((b) => (
                    <TableRow key={b.name}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {b.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-medium ${STATE_STYLES[b.state]}`}
                        >
                          {b.state === 'CLOSED' && (
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                          )}
                          {b.state === 'OPEN' && (
                            <XCircle className="mr-1 h-3 w-3" />
                          )}
                          {b.state === 'HALF_OPEN' && (
                            <AlertCircle className="mr-1 h-3 w-3" />
                          )}
                          {b.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            b.failureCount > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {b.failureCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            b.successCount > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {b.successCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {b.totalCalls.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(b.lastFailureAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(b.lastSuccessAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
