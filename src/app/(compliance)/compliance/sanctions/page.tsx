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
import { Ban, AlertTriangle, ShieldCheck, Search } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ComplianceSanctionsPage() {
  const session = await getServerSession(authOptions);

  // Sanctions-related alerts (alertType contains "SANCTION")
  const sanctions = await db.aMLAlert.findMany({
    where: { alertType: { contains: 'SANCTION' } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const open = sanctions.filter((s) => s.status === 'OPEN').length;
  const closed = sanctions.filter((s) => s.status === 'CLOSED').length;
  const highSeverity = sanctions.filter(
    (s) => s.severity === 'CRITICAL' || s.severity === 'HIGH',
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sanctions screening"
        description="Matches against global sanctions and watchlists."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total hits"
          value={sanctions.length.toString()}
          icon={<Ban className="h-4 w-4" />}
          tone={sanctions.length > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Open"
          value={open.toString()}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="High severity"
          value={highSeverity.toString()}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="rose"
        />
        <KpiCard
          label="Resolved"
          value={closed.toString()}
          icon={<Search className="h-4 w-4" />}
          tone="teal"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Screening hits</CardTitle>
          <CardDescription>
            {sanctions.length} hit{sanctions.length === 1 ? '' : 's'} recorded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sanctions.length === 0 ? (
            <EmptyState
              icon={<Ban className="h-6 w-6" />}
              title="No sanctions hits"
              description="When the screening engine matches an entity against a watchlist, the hit will appear here."
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {sanctions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          s.severity === 'CRITICAL' || s.severity === 'HIGH'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {s.severity}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{s.alertType}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.entityType}:{s.entityId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {s.score.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(s.createdAt)}
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
