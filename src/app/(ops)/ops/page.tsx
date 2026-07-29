import Link from 'next/link';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Plug,
  Gauge,
  Cpu,
  MemoryStick,
  Clock,
  ArrowRight,
  FlaskConical,
  Users,
  CreditCard,
  Zap,
  AlertTriangle,
  CalendarDays,
  Wrench,
  ScrollText,
  Landmark,
  Repeat2,
  Database,
  UserCheck,
} from 'lucide-react';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';
import { metricsRegistry } from '@/protocol/ops/metrics';
import { sloManager } from '@/protocol/ops/slos';
import { opsEngine } from '@/ops';
import type {
  OpsIncident,
  OnCallSchedule,
  MaintenanceWindow,
  TreasuryOperation,
  SettlementOperation,
} from '@/ops/types';

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
  const healthReport = await productionConnectorRegistry.healthReport();
  const healthyCount = healthReport.filter((h) => h.healthy).length;

  // SLO evaluation
  const sloStatuses = sloManager.evaluate(metricsRegistry);
  const onTrack = sloStatuses.filter((s) => s.onTrack).length;

  // Real platform metrics from the DB
  const [totalEvents, totalPayments, totalUsers, recentSimRuns, recentEventRate] =
    await Promise.all([
      db.eventRecord.count(),
      db.payment.count(),
      db.user.count({ where: { deletedAt: null } }),
      db.simulationRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.payment.count({
        where: { createdAt: { gte: new Date(Date.now() - 3600 * 1000) } },
      }),
    ]);

  const systemHealthPct =
    connectors.length > 0
      ? Math.round((healthyCount / connectors.length) * 100)
      : 100;

  // ─── M-OPS-42 Operations OS snapshot ────────────────────────────────────
  // Pull the active incidents, on-call roster, upcoming maintenance, pending
  // treasury / settlement ops and active migration so the dashboard surfaces
  // the operational surface in one place. Each call is best-effort — a
  // failure in one domain must not break the page.
  const [
    activeIncidents,
    incidentStats,
    onCallRoster,
    upcomingMaintenance,
    activeMaintenance,
    pendingTreasuryOps,
    pendingSettlementOps,
    activeMigration,
  ] = await Promise.all([
    opsEngine.incidents
      .list({ status: 'open' })
      .catch((): OpsIncident[] => []),
    opsEngine.incidents
      .getStats()
      .catch(() => ({ total: 0, open: 0, bySeverity: {} as Record<string, number>, avgResolutionTimeMs: 0 })),
    opsEngine.onCall
      .getActiveRoster()
      .catch(() => ({} as { primary?: OnCallSchedule; secondary?: OnCallSchedule; manager?: OnCallSchedule })),
    opsEngine.maintenance.getUpcoming().catch((): MaintenanceWindow[] => []),
    opsEngine.maintenance.getActive().catch(() => null),
    opsEngine.treasury
      .getPending()
      .catch((): TreasuryOperation[] => []),
    opsEngine.settlement
      .list({ status: 'pending' })
      .catch((): SettlementOperation[] => []),
    opsEngine.migrations.getActive().catch(() => null),
  ]);

  const pendingOpsCount =
    pendingTreasuryOps.length + pendingSettlementOps.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description="System health, connector status and SLO posture."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/ops/connectors">
                <Plug className="h-4 w-4" />
                Connectors
              </Link>
            </Button>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/ops/health">
                <HeartPulse className="h-4 w-4" />
                System health
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Uptime"
          value={formatUptime(uptimeSec)}
          hint={`Node ${process.version}`}
          icon={<Clock className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Total events"
          value={totalEvents.toLocaleString()}
          hint={`${recentEventRate.toLocaleString()} in last hour`}
          icon={<Zap className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Total payments"
          value={totalPayments.toLocaleString()}
          hint="All-time"
          icon={<CreditCard className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Users"
          value={totalUsers.toLocaleString()}
          hint="Active accounts"
          icon={<Users className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      {/* ─── M-OPS-42 Operations OS row ─────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Active incidents"
          value={incidentStats.open.toString()}
          hint={`SEV1: ${incidentStats.bySeverity.SEV1 ?? 0} · SEV2: ${incidentStats.bySeverity.SEV2 ?? 0} · SEV3: ${incidentStats.bySeverity.SEV3 ?? 0} · SEV4: ${incidentStats.bySeverity.SEV4 ?? 0}`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={incidentStats.bySeverity.SEV1 ? 'rose' : incidentStats.bySeverity.SEV2 ? 'amber' : 'emerald'}
        />
        <KpiCard
          label="Pending ops"
          value={pendingOpsCount.toString()}
          hint={`${pendingTreasuryOps.length} treasury · ${pendingSettlementOps.length} settlement`}
          icon={<Wrench className="h-4 w-4" />}
          tone={pendingOpsCount > 0 ? 'amber' : 'emerald'}
        />
        <KpiCard
          label="Upcoming maintenance"
          value={upcomingMaintenance.length.toString()}
          hint={activeMaintenance ? `Active: ${activeMaintenance.title}` : 'No active window'}
          icon={<CalendarDays className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="On-call primary"
          value={onCallRoster.primary?.userName ?? '—'}
          hint={onCallRoster.secondary ? `Secondary: ${onCallRoster.secondary.userName}` : undefined}
          icon={<UserCheck className="h-4 w-4" />}
          tone="teal"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">System health</CardTitle>
                <CardDescription>Process resource usage</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={
                    systemHealthPct === 100
                      ? 'HEALTHY'
                      : systemHealthPct >= 80
                      ? 'DEGRADED'
                      : 'CRITICAL'
                  }
                />
                <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                  <Link href="/ops/health">
                    Detail <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
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
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Connector status</CardTitle>
                <CardDescription>Live health probes</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/ops/connectors">
                  All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
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
                  const cfg = c.config;
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

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Recent simulation runs</CardTitle>
                <CardDescription>
                  Latest deterministic kernel simulations across scenarios
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/ops/metrics">
                  Metrics <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentSimRuns.length === 0 ? (
              <EmptyState
                icon={<FlaskConical className="h-6 w-6" />}
                title="No simulation runs"
                description="Deterministic kernel simulations will be recorded here as the ops harness exercises the platform."
              />
            ) : (
              <div className="max-h-80 overflow-y-auto pr-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scenario</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Risk</TableHead>
                      <TableHead className="text-right">Conf.</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentSimRuns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="text-xs font-semibold">{r.scenarioName}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {r.runId.slice(0, 12)} · v{r.kernelVersion}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.settled ? 'SETTLED' : r.result.toUpperCase()} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(Number(r.costPercent), 2)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(Number(r.riskScore), 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(Number(r.confidence), 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtNumber(r.settlementMs, 0)} ms
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(r.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLO status</CardTitle>
            <CardDescription>
              {onTrack}/{sloStatuses.length} on track
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sloStatuses.length === 0 ? (
              <EmptyState
                icon={<Gauge className="h-6 w-6" />}
                title="No SLOs registered"
                description="SLOs will appear here once the operations runtime registers them."
              />
            ) : (
              <div className="space-y-3">
                {sloStatuses.map((s) => {
                  const successPct = s.currentValue * 100;
                  const tone =
                    s.onTrack
                      ? 'bg-emerald-500'
                      : 'bg-rose-500';
                  return (
                    <div key={s.slo.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{s.slo.name}</span>
                        <span className="tabular-nums">
                          {fmtNumber(successPct, 2)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${tone}`}
                          style={{ width: `${Math.min(100, successPct)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>target {fmtNumber(s.slo.target * 100, 2)}%</span>
                        <span>
                          {fmtNumber(s.currentValue, 0)}/{fmtNumber(s.target, 0)} good
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── M-OPS-42 Operations OS panels ───────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active incidents */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Active incidents</CardTitle>
                <CardDescription>
                  {activeIncidents.length} open incident
                  {activeIncidents.length === 1 ? '' : 's'} (SEV* notation)
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/ops/incidents">
                  All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {activeIncidents.length === 0 ? (
              <EmptyState
                icon={<AlertTriangle className="h-6 w-6" />}
                title="No active incidents"
                description="All clear — no open incidents in the Operations OS."
              />
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {activeIncidents.slice(0, 8).map((inc) => (
                  <Link
                    key={inc.id}
                    href={`/ops/incidents/${inc.id}`}
                    className="block rounded-lg border bg-card/50 p-3 transition hover:border-emerald-500/40 hover:bg-emerald-500/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {inc.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] font-semibold uppercase ${
                          inc.severity === 'SEV1'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : inc.severity === 'SEV2'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : inc.severity === 'SEV3'
                                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                : 'bg-gray-500/15 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {inc.severity}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="rounded bg-teal-500/10 px-1.5 py-0.5 font-medium capitalize text-teal-600 dark:text-teal-400">
                        {inc.component}
                      </span>
                      <span className="capitalize">{inc.status}</span>
                      <span>·</span>
                      <span>{fmtDate(new Date(inc.createdAt))}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* On-call roster */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">On-call roster</CardTitle>
                <CardDescription>Current rotation</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/ops/oncall">
                  Detail <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(['primary', 'secondary', 'manager'] as const).map((role) => {
              const s = onCallRoster[role];
              return (
                <div
                  key={role}
                  className="flex items-center justify-between rounded-lg border bg-card/50 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] font-semibold uppercase ${
                        role === 'primary'
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          : role === 'secondary'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                      }`}
                    >
                      {role}
                    </Badge>
                    <span className="text-sm font-medium">
                      {s?.userName ?? '—'}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {s ? `until ${fmtDate(new Date(s.endAt))}` : 'unassigned'}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming maintenance */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Upcoming maintenance</CardTitle>
                <CardDescription>Scheduled windows</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/ops/maintenance">
                  All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingMaintenance.length === 0 ? (
              <EmptyState
                icon={<CalendarDays className="h-6 w-6" />}
                title="Nothing scheduled"
                description="No maintenance windows are currently scheduled."
              />
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {upcomingMaintenance.slice(0, 6).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border bg-card/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {m.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] font-medium capitalize ${
                          m.impact === 'outage'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : m.impact === 'major'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : m.impact === 'minor'
                                ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {m.impact}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {m.component} · starts {fmtDate(new Date(m.startAt))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending treasury + settlement ops */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Pending ops</CardTitle>
                <CardDescription>
                  {pendingOpsCount} awaiting approval/execution
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                  <Link href="/ops/treasury-ops">
                    <Landmark className="mr-1 h-3.5 w-3.5" /> Treasury
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                  <Link href="/ops/settlement-ops">
                    <Repeat2 className="mr-1 h-3.5 w-3.5" /> Settlement
                  </Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingOpsCount === 0 ? (
              <EmptyState
                icon={<Wrench className="h-6 w-6" />}
                title="Nothing pending"
                description="No treasury or settlement operations are awaiting action."
              />
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {pendingTreasuryOps.slice(0, 3).map((op) => (
                  <div
                    key={op.id}
                    className="rounded-lg border bg-card/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold">
                        {op.type.replace(/_/g, ' ')} · {op.country} {op.currency}
                      </span>
                      <span className="text-xs tabular-nums">
                        {fmtNumber(op.amount, 0)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Treasury · {fmtDate(new Date(op.createdAt))}
                    </div>
                  </div>
                ))}
                {pendingSettlementOps.slice(0, 3).map((op) => (
                  <div
                    key={op.id}
                    className="rounded-lg border bg-card/50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold">
                        {op.type.replace(/_/g, ' ')} · {op.transactionId}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Settlement · {fmtDate(new Date(op.createdAt))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active migration + ops quick links */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operations quick links</CardTitle>
            <CardDescription>
              {activeMigration
                ? `Active: ${activeMigration.name}`
                : 'No active migration'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {[
              { href: '/ops/runbooks', icon: ScrollText, label: 'Runbooks' },
              { href: '/ops/investigations', icon: FlaskConical, label: 'Investigations' },
              { href: '/ops/migrations', icon: Database, label: 'Migrations' },
              { href: '/ops/status', icon: Gauge, label: 'Status' },
            ].map(({ href, icon: Icon, label }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-2 rounded-lg border bg-card/50 p-3 text-sm font-medium transition hover:border-emerald-500/40 hover:bg-emerald-500/5"
              >
                <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                {label}
                <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
