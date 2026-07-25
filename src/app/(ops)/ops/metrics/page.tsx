import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
} from '@/components/role-ui';
import { BarChart3, Gauge, Activity, TrendingUp } from 'lucide-react';
import { metricsRegistry } from '@/protocol/ops/metrics';
import { sloManager } from '@/protocol/ops/slos';

export const dynamic = 'force-dynamic';

interface MetricRow {
  name: string;
  type: string;
  help: string;
  sample: string;
  series: number;
}

function summariseMetric(m: any): MetricRow {
  if (m.type === 'counter' || m.type === 'gauge') {
    const entries = [...(m.values?.entries?.() ?? [])] as [string, number][];
    const sum = entries.reduce((s, [, v]) => s + (typeof v === 'number' ? v : 0), 0);
    return {
      name: m.name,
      type: m.type,
      help: m.help,
      sample: fmtNumber(sum, 0),
      series: entries.length,
    };
  }
  if (m.type === 'histogram') {
    const entries = [...(m.values?.entries?.() ?? [])] as [string, any][];
    const totalCount = entries.reduce((s, [, v]) => s + (v?.count ?? 0), 0);
    return {
      name: m.name,
      type: m.type,
      help: m.help,
      sample: `${fmtNumber(totalCount, 0)} obs`,
      series: entries.length,
    };
  }
  return { name: m.name, type: m.type, help: m.help, sample: '—', series: 0 };
}

export default async function OpsMetricsPage() {
  const session = await getServerSession(authOptions);

  const metrics = metricsRegistry.all();
  const rows = metrics.map(summariseMetric);

  const counters = rows.filter((r) => r.type === 'counter').length;
  const gauges = rows.filter((r) => r.type === 'gauge').length;
  const histograms = rows.filter((r) => r.type === 'histogram').length;
  const totalSeries = rows.reduce((s, r) => s + r.series, 0);

  const sloStatuses = sloManager.evaluate(metricsRegistry);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics"
        description="Live operational metrics and SLO posture."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Metrics"
          value={rows.length.toString()}
          hint="Registered"
          icon={<BarChart3 className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Counters"
          value={counters.toString()}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Gauges / histograms"
          value={`${gauges} / ${histograms}`}
          icon={<Gauge className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Series"
          value={totalSeries.toLocaleString()}
          hint="Label combinations"
          icon={<Activity className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metric registry</CardTitle>
          <CardDescription>
            {rows.length} metric{rows.length === 1 ? '' : 's'} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-6 w-6" />}
              title="No metrics registered"
              description="Standard operational metrics will populate here once the runtime boots."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Series</TableHead>
                  <TableHead className="text-right">Sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-mono text-xs font-semibold">{r.name}</TableCell>
                    <TableCell>
                      <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                        {r.type}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {r.help || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.series}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.sample}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLO status</CardTitle>
          <CardDescription>Service level objective evaluation</CardDescription>
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
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Good</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sloStatuses.map((s) => (
                  <TableRow key={s.slo.id}>
                    <TableCell>
                      <div className="text-sm font-semibold">{s.slo.name}</div>
                      <div className="text-[10px] text-muted-foreground">{s.slo.id}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {s.slo.metric}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(s.slo.target * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.goodCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.totalCount}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmtNumber(s.successRate * 100, 2)}%
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          s.onTrack
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {s.onTrack ? 'On track' : 'Violated'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
