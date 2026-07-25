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
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtNumber,
} from '@/components/role-ui';
import { Plug, Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { productionConnectorRegistry } from '@/protocol/connectors-v2/registry';

export const dynamic = 'force-dynamic';

export default async function OpsConnectorsPage() {
  const session = await getServerSession(authOptions);

  const connectors = productionConnectorRegistry.all();
  const healthReport = productionConnectorRegistry.healthReport();
  const metricsReport = productionConnectorRegistry.metricsReport();

  const healthyCount = healthReport.filter((h) => h.healthy).length;
  const totalRequests = metricsReport.reduce((s, m) => s + m.requestsTotal, 0);
  const totalSuccess = metricsReport.reduce((s, m) => s + m.requestsSuccess, 0);
  const totalFailed = metricsReport.reduce((s, m) => s + m.requestsFailed, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectors"
        description="Registered production connectors with live health and metrics."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Registered"
          value={connectors.length.toString()}
          icon={<Plug className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Healthy"
          value={healthyCount.toString()}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Total requests"
          value={totalRequests.toLocaleString()}
          hint="All-time"
          icon={<Activity className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Failed requests"
          value={totalFailed.toLocaleString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={totalFailed > 0 ? 'rose' : 'amber'}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connector registry</CardTitle>
          <CardDescription>
            {connectors.length} connector{connectors.length === 1 ? '' : 's'} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connectors.length === 0 ? (
            <EmptyState
              icon={<Plug className="h-6 w-6" />}
              title="No connectors registered"
              description="Production connectors are auto-registered at boot. If you see this, the registry failed to initialise."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Timeout</TableHead>
                  <TableHead className="text-right">RPS limit</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map((c) => {
                  const cfg = c.getConfig();
                  const health = healthReport.find((h) => h.id === cfg.id);
                  return (
                    <TableRow key={cfg.id}>
                      <TableCell>
                        <div className="text-sm font-semibold">{cfg.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{cfg.id}</div>
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-400">
                          {cfg.type}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate font-mono text-[10px] text-muted-foreground">
                        {cfg.endpoint}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(cfg.timeout, 0)} ms
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {cfg.rateLimitRps}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={
                            health
                              ? health.healthy
                                ? 'HEALTHY'
                                : 'DEGRADED'
                              : 'PENDING'
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connector metrics</CardTitle>
          <CardDescription>Per-connector request counters</CardDescription>
        </CardHeader>
        <CardContent>
          {metricsReport.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No metrics yet"
              description="Connector metrics will populate as requests flow through the runtime."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connector</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Retried</TableHead>
                  <TableHead className="text-right">Success rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricsReport.map((m) => {
                  const rate = m.requestsTotal > 0 ? (m.requestsSuccess / m.requestsTotal) * 100 : 0;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs font-semibold">{m.id}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.requestsTotal}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {m.requestsSuccess}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                        {m.requestsFailed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.requestsRetried}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtNumber(rate, 2)}%
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
