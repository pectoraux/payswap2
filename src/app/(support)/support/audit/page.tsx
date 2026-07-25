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
  fmtDate,
} from '@/components/role-ui';
import { History, Activity, ShieldCheck, AlertTriangle, Webhook } from 'lucide-react';
import { ReplayWebhookButton } from '@/components/support/replay-webhook-button';

export const dynamic = 'force-dynamic';

export default async function SupportAuditPage() {
  const session = await getServerSession(authOptions);

  const [logs, total, successCount, failCount, deliveries] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: true },
    }),
    db.auditLog.count(),
    db.auditLog.count({ where: { result: 'SUCCESS' } }),
    db.auditLog.count({ where: { result: { not: 'SUCCESS' } } }),
    db.webhookDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { endpoint: true },
    }),
  ]);

  // Delivery stats computed from the fetched slice (best-effort — these
  // describe the visible rows, not the entire table).
  const deliveriesDelivered = deliveries.filter(
    (d) => d.status.toUpperCase() === 'DELIVERED',
  ).length;
  const deliveriesFailed = deliveries.filter((d) =>
    ['FAILED', 'RETRYING', 'PENDING'].includes(d.status.toUpperCase()),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        description="Immutable record of every action taken on the platform, plus webhook delivery replay controls."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total entries"
          value={total.toLocaleString()}
          icon={<History className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Successful"
          value={successCount.toLocaleString()}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Failed"
          value={failCount.toLocaleString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={failCount > 0 ? 'rose' : 'amber'}
        />
        <KpiCard
          label="Shown"
          value={logs.length.toString()}
          hint="Latest 100"
          icon={<Activity className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Webhook deliveries</CardTitle>
              <CardDescription>
                Replay any delivery to re-send its payload to the configured
                endpoint. A new delivery row is recorded for each replay.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                {deliveriesDelivered} delivered
              </span>
              <span className="rounded bg-rose-500/10 px-1.5 py-0.5 font-medium text-rose-600 dark:text-rose-400">
                {deliveriesFailed} pending/failed
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <EmptyState
              icon={<Webhook className="h-6 w-6" />}
              title="No webhook deliveries"
              description="When the platform fires a webhook event, deliveries will appear here for replay."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Response</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">
                      {d.eventType}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate font-mono text-[10px] text-muted-foreground">
                      {d.endpoint?.url ?? d.endpointId}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.attempts}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.responseStatus ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(d.deliveredAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ReplayWebhookButton deliveryId={d.id} compact />
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
          <CardTitle className="text-base">Audit log</CardTitle>
          <CardDescription>
            {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} shown
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title="No audit entries"
              description="Audit log entries will appear here as users interact with the platform."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {l.resourceType}
                      {l.resourceId ? `:${l.resourceId.slice(0, 8)}` : ''}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.user?.email || (l.userId ? l.userId.slice(0, 8) : 'system')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.result} />
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {l.ip || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(l.createdAt)}
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
