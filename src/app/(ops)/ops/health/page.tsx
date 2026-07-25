import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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
  fmtDate,
} from '@/components/role-ui';
import {
  HeartPulse,
  Cpu,
  MemoryStick,
  Clock,
  Server,
  Activity,
} from 'lucide-react';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';
import { metricsRegistry } from '@/protocol/ops/metrics';
import { sloManager } from '@/protocol/ops/slos';
import { RebuildProjectionsButton } from '@/components/ops/rebuild-projections-button';

export const dynamic = 'force-dynamic';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function OpsHealthPage() {
  const session = await getServerSession(authOptions);

  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptimeSec = process.uptime();
  const memUsedMb = mem.rss / 1024 / 1024;
  const heapUsedMb = mem.heapUsed / 1024 / 1024;
  const heapTotalMb = mem.heapTotal / 1024 / 1024;
  const memPct = Math.min(100, (memUsedMb / 1024) * 100);
  const heapPct = heapTotalMb > 0 ? (heapUsedMb / heapTotalMb) * 100 : 0;

  const healthReport = productionConnectorRegistry.healthReport();
  const healthyCount = healthReport.filter((h) => h.healthy).length;
  const degradedCount = healthReport.length - healthyCount;

  const sloStatuses = sloManager.evaluate(metricsRegistry);
  const onTrack = sloStatuses.filter((s) => s.onTrack).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Health"
        description="Process, memory and connector health checks."
        action={<RebuildProjectionsButton />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Uptime"
          value={formatUptime(uptimeSec)}
          icon={<Clock className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Memory"
          value={`${fmtNumber(memUsedMb, 0)} MB`}
          hint={`${fmtNumber(memPct, 1)}% of 1 GB`}
          icon={<MemoryStick className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Healthy connectors"
          value={`${healthyCount}/${healthReport.length}`}
          icon={<HeartPulse className="h-4 w-4" />}
          tone={degradedCount === 0 ? 'emerald' : 'rose'}
        />
        <KpiCard
          label="SLOs on track"
          value={`${onTrack}/${sloStatuses.length}`}
          icon={<Activity className="h-4 w-4" />}
          tone={onTrack === sloStatuses.length ? 'emerald' : 'amber'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Process resources</CardTitle>
            <CardDescription>Node.js runtime metrics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" /> CPU user
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {fmtNumber(cpu.user / 1000, 1)} ms
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Cpu className="h-3.5 w-3.5" /> CPU system
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {fmtNumber(cpu.system / 1000, 1)} ms
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
                  <Server className="h-3.5 w-3.5" /> Heap total
                </div>
                <div className="mt-1 text-lg font-bold tabular-nums">
                  {fmtNumber(heapTotalMb, 1)} MB
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
            <div className="rounded-lg border bg-card/50 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Node.js {process.version}</span>
              {' · '}platform {process.platform}{' · '}arch {process.arch}
              {' · '}pid {process.pid}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connector health</CardTitle>
            <CardDescription>Latest probe results</CardDescription>
          </CardHeader>
          <CardContent>
            {healthReport.length === 0 ? (
              <EmptyState
                icon={<HeartPulse className="h-6 w-6" />}
                title="No health data"
                description="Connector health probes will appear here once connectors are registered."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Connector</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead className="text-right">Failures</TableHead>
                    <TableHead>Last check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthReport.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono text-xs font-semibold">{h.id}</TableCell>
                      <TableCell>
                        <StatusBadge status={h.healthy ? 'HEALTHY' : 'DEGRADED'} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(h.latencyMs, 0)} ms
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            h.consecutiveFailures > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted-foreground'
                          }
                        >
                          {h.consecutiveFailures}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {h.lastCheckTs ? fmtDate(new Date(h.lastCheckTs)) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
