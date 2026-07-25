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
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtNumber,
} from '@/components/role-ui';
import {
  HeartPulse,
  Plug,
  Activity,
  Gauge,
  Cpu,
  MemoryStick,
  Clock,
} from 'lucide-react';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';
import { metricsRegistry } from '@/protocol/ops/metrics';
import { sloManager } from '@/protocol/ops/slos';

export const dynamic = 'force-dynamic';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function OpsOverviewPage() {
  const session = await getServerSession(authOptions);

  // System stats from the Node process
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptimeSec = process.uptime();
  const memUsedMb = mem.rss / 1024 / 1024;
  const memTotalMb = 1024; // nominal ceiling for visualisation
  const memPct = Math.min(100, (memUsedMb / memTotalMb) * 100);

  // Connector status
  const connectors = productionConnectorRegistry.all();
  const healthReport = productionConnectorRegistry.healthReport();
  const healthyCount = healthReport.filter((h) => h.healthy).length;

  // SLO evaluation
  const sloStatuses = sloManager.evaluate(metricsRegistry);
  const onTrack = sloStatuses.filter((s) => s.onTrack).length;

  // Recent events (proxy: payments created in last hour)
  const since = new Date(Date.now() - 3600 * 1000);
  const eventCount = await db.payment.count({ where: { createdAt: { gte: since } } });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description="System health, connector status and SLO posture."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="System health"
          value={`${Math.round((healthyCount / Math.max(1, connectors.length)) * 100)}%`}
          hint={`${healthyCount}/${connectors.length} connectors healthy`}
          icon={<HeartPulse className="h-4 w-4" />}
          tone={healthyCount === connectors.length ? 'emerald' : 'amber'}
        />
        <KpiCard
          label="Connectors"
          value={connectors.length.toString()}
          hint="Registered"
          icon={<Plug className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Events (1h)"
          value={eventCount.toLocaleString()}
          hint="Payments in last hour"
          icon={<Activity className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="SLOs on track"
          value={`${onTrack}/${sloStatuses.length}`}
          hint="Error budget"
          icon={<Gauge className="h-4 w-4" />}
          tone={onTrack === sloStatuses.length ? 'emerald' : 'rose'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">System health</CardTitle>
            <CardDescription>Process resource usage</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Cpu className="h-3.5 w-3.5" /> CPU
                  </span>
                  <span className="text-[10px] text-muted-foreground">user+system</span>
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums">
                  {fmtNumber((cpu.user + cpu.system) / 1000, 1)} ms
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <MemoryStick className="h-3.5 w-3.5" /> Memory
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {fmtNumber(memUsedMb, 0)} MB
                  </span>
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums">{fmtNumber(memPct, 1)}%</div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> Uptime
                  </span>
                </div>
                <div className="mt-2 text-lg font-bold tabular-nums">
                  {formatUptime(uptimeSec)}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Memory utilisation</span>
                <span className="tabular-nums">{fmtNumber(memPct, 1)}%</span>
              </div>
              <Progress value={memPct} className="h-2" />
            </div>
            <div className="rounded-lg border bg-card/50 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Node.js {process.version}</span>
              {' · '}platform {process.platform}{' · '}arch {process.arch}{' · '}pid {process.pid}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connector status</CardTitle>
            <CardDescription>Live health probes</CardDescription>
          </CardHeader>
          <CardContent>
            {connectors.length === 0 ? (
              <EmptyState
                icon={<Plug className="h-6 w-6" />}
                title="No connectors"
                description="Connectors will appear here once registered with the runtime."
              />
            ) : (
              <div className="space-y-2">
                {connectors.map((c) => {
                  const cfg = c.getConfig();
                  const health = healthReport.find((h) => h.id === cfg.id);
                  const healthy = health?.healthy ?? false;
                  return (
                    <div
                      key={cfg.id}
                      className="flex items-center justify-between rounded-lg border bg-card/50 p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{cfg.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {cfg.type} · {cfg.id}
                        </div>
                      </div>
                      <StatusBadge status={healthy ? 'HEALTHY' : 'DEGRADED'} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLO status</CardTitle>
          <CardDescription>Error budget posture</CardDescription>
        </CardHeader>
        <CardContent>
          {sloStatuses.length === 0 ? (
            <EmptyState
              icon={<Gauge className="h-6 w-6" />}
              title="No SLOs registered"
              description="SLOs will appear here once the operations runtime registers them."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SLO</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">Good</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sloStatuses.map((s) => {
                  const successPct = s.successRate * 100;
                  return (
                    <TableRow key={s.slo.id}>
                      <TableCell>
                        <div className="text-sm font-semibold">{s.slo.name}</div>
                        <div className="text-[10px] text-muted-foreground">{s.slo.id}</div>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {(s.slo.target * 100).toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.goodCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.totalCount}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtNumber(successPct, 2)}%
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.onTrack ? 'HEALTHY' : 'CRITICAL'} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
