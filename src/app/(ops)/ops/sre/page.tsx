import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtNumber,
  fmtDate,
} from '@/components/role-ui';
import {
  Terminal,
  Cpu,
  MemoryStick,
  Clock,
  Activity,
  Plug,
  AlertOctagon,
  Gauge,
} from 'lucide-react';
import { ReplayFailedWebhooksButton } from '@/components/sre/replay-failed-webhooks-button';
import { ClearEventStoreButton } from '@/components/sre/clear-event-store-button';
import { RunHealthCheckButton } from '@/components/sre/run-health-check-button';

export const dynamic = 'force-dynamic';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function SreConsolePage() {
  const session = await getServerSession(authOptions);
  const roles = (session?.user as any)?.roles as string[] | undefined;
  const isAdmin =
    !!roles && roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r));

  // ── Process metrics ────────────────────────────────────────────────────
  const mem = process.memoryUsage();
  const uptimeSec = process.uptime();
  const memUsedMb = mem.rss / 1024 / 1024;
  const heapUsedMb = mem.heapUsed / 1024 / 1024;
  const heapTotalMb = mem.heapTotal / 1024 / 1024;
  const memPct = Math.min(100, (memUsedMb / 1024) * 100);
  const heapPct = heapTotalMb > 0 ? (heapUsedMb / heapTotalMb) * 100 : 0;

  // Event-loop lag is a client-visible concept (compute it on the client in
  // the Run Health Check dialog). For the static console we leave a static
  // informational note.
  const eventLoopLagNote = 'Live sample captured by “Run health check”';

  // ── Connector health (webhook endpoints + recent deliveries) ───────────
  const endpoints = await db.webhookEndpoint.findMany({
    where: { status: 'ACTIVE' },
    take: 50,
    orderBy: { createdAt: 'desc' },
    include: {
      deliveries: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { status: true },
      },
    },
  });

  const endpointRows = endpoints.map((e) => {
    const total = e.deliveries.length;
    const success = e.deliveries.filter(
      (d) => d.status === 'DELIVERED' || d.status === 'SUCCESS',
    ).length;
    const failed = e.deliveries.filter((d) => d.status === 'FAILED').length;
    const rate = total > 0 ? (success / total) * 100 : 100;
    return {
      id: e.id,
      url: e.url,
      total,
      success,
      failed,
      rate,
    };
  });

  // ── Recent errors ──────────────────────────────────────────────────────
  const recentErrors = await db.auditLog.findMany({
    where: { result: 'ERROR' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { user: true },
  });

  // ── Event store row count (for the clear dialog) ───────────────────────
  const eventCount = await db.eventRecord.count();

  // ── Aggregate metrics for KPIs ─────────────────────────────────────────
  const failedDeliveriesTotal = endpointRows.reduce((s, r) => s + r.failed, 0);
  const avgRate =
    endpointRows.length > 0
      ? endpointRows.reduce((s, r) => s + r.rate, 0) / endpointRows.length
      : 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title="SRE console"
        description="Runtime metrics, connector health and quick operator actions."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ReplayFailedWebhooksButton />
            <ClearEventStoreButton isAdmin={isAdmin} rowCount={eventCount} />
            <RunHealthCheckButton />
          </div>
        }
      />

      {/* Quick action callout */}
      <Card className="border-teal-500/30 bg-teal-500/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <div>
              <div className="text-sm font-semibold">Quick actions</div>
              <div className="text-[10px] text-muted-foreground">
                Replay failed webhooks · clear the event store (admin) · run an
                on-demand health check.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Uptime"
          value={formatUptime(uptimeSec)}
          hint={`Node ${process.version}`}
          icon={<Clock className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Memory (RSS)"
          value={`${fmtNumber(memUsedMb, 0)} MB`}
          hint={`${fmtNumber(memPct, 1)}% of 1 GB`}
          icon={<MemoryStick className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Webhook endpoints"
          value={endpointRows.length.toString()}
          hint={`${fmtNumber(avgRate, 1)}% avg success`}
          icon={<Plug className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Recent errors"
          value={recentErrors.length.toString()}
          hint={`${failedDeliveriesTotal} failed webhook deliveries (last 100 each)`}
          icon={<AlertOctagon className="h-4 w-4" />}
          tone={recentErrors.length > 0 ? 'rose' : 'amber'}
        />
      </div>

      {/* System metrics */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <div>
                <CardTitle className="text-base">System metrics</CardTitle>
                <CardDescription>Node.js runtime process</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" /> CPU user
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {fmtNumber(process.cpuUsage().user / 1000, 1)} ms
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" /> CPU system
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {fmtNumber(process.cpuUsage().system / 1000, 1)} ms
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <MemoryStick className="h-3.5 w-3.5" /> Heap used
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {fmtNumber(heapUsedMb, 1)} MB
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Uptime
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {formatUptime(uptimeSec)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">RSS memory</span>
                <span className="tabular-nums">{fmtNumber(memPct, 1)}%</span>
              </div>
              <Progress value={memPct} className="h-2" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Heap utilisation</span>
                <span className="tabular-nums">{fmtNumber(heapPct, 1)}%</span>
              </div>
              <Progress value={heapPct} className="h-2" />
            </div>

            <div className="rounded-lg border bg-card/50 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <Activity className="h-3.5 w-3.5" /> Event-loop lag estimate
                </span>
                <span className="text-muted-foreground">{eventLoopLagNote}</span>
              </div>
            </div>

            <div className="rounded-lg border bg-card/50 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Node.js {process.version}</span>
              {' · '}platform {process.platform}{' · '}arch {process.arch}{' · '}pid {process.pid}
            </div>
          </CardContent>
        </Card>

        {/* Recent errors */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <div>
                <CardTitle className="text-base">Recent errors</CardTitle>
                <CardDescription>
                  Last 20 audit-log entries with result=ERROR
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {recentErrors.length === 0 ? (
              <EmptyState
                icon={<AlertOctagon className="h-6 w-6" />}
                title="No recent errors"
                description="Audit-log entries with result=ERROR will appear here when the platform encounters failures."
              />
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentErrors.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">
                            {l.action}
                          </div>
                          <div className="max-w-[14rem] truncate text-[10px] text-muted-foreground">
                            {l.details ?? l.resourceType}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.user?.email ?? l.userId?.slice(0, 10) ?? 'system'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(l.createdAt)}
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

      {/* Connector health */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <CardTitle className="text-base">Connector health</CardTitle>
              <CardDescription>
                Webhook endpoints with recent delivery success rate (last 100 deliveries each)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {endpointRows.length === 0 ? (
            <EmptyState
              icon={<Plug className="h-6 w-6" />}
              title="No webhook endpoints"
              description="Active webhook endpoints will appear here once merchants register them."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Endpoint URL</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="w-32">Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpointRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[18rem] truncate font-mono text-xs">
                        {r.url}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.total}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {r.success}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                        {r.failed}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtNumber(r.rate, 2)}%
                      </TableCell>
                      <TableCell>
                        <Progress
                          value={r.rate}
                          className={`h-1.5 ${
                            r.rate >= 95
                              ? '[&>div]:bg-emerald-500'
                              : r.rate >= 80
                              ? '[&>div]:bg-amber-500'
                              : '[&>div]:bg-rose-500'
                          }`}
                        />
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
