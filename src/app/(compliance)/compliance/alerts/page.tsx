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
import { ShieldAlert, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ComplianceAlertsPage() {
  const session = await getServerSession(authOptions);

  const alerts = await db.aMLAlert.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const open = alerts.filter((a) => a.status === 'OPEN').length;
  const closed = alerts.filter((a) => a.status === 'CLOSED').length;
  const critical = alerts.filter(
    (a) => a.severity === 'CRITICAL' || a.severity === 'HIGH',
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AML alerts"
        description="Risk engine alerts requiring compliance review."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open"
          value={open.toString()}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={open > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Critical / high"
          value={critical.toString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Closed"
          value={closed.toString()}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Total"
          value={alerts.length.toString()}
          icon={<XCircle className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All alerts</CardTitle>
          <CardDescription>
            {alerts.length} alert{alerts.length === 1 ? '' : 's'} recorded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-6 w-6" />}
              title="No alerts"
              description="When the risk engine flags suspicious activity, alerts will appear here for review."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Raised</TableHead>
                  <TableHead>Closed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          a.severity === 'CRITICAL' || a.severity === 'HIGH'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : a.severity === 'MEDIUM'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {a.severity}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{a.alertType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.entityType}:{a.entityId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {a.score.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(a.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(a.closedAt)}
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
