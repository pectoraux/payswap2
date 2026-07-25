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
import {
  ShieldAlert,
  UserCheck,
  Ban,
  FolderOpen,
  AlertTriangle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ComplianceOverviewPage() {
  const session = await getServerSession(authOptions);

  const [openAlerts, pendingKyc, sanctionsHits, openCases, recentAlerts, pendingKycReviews] =
    await Promise.all([
      db.aMLAlert.count({ where: { status: 'OPEN' } }),
      db.complianceReview.count({
        where: { status: 'PENDING', type: 'KYC' },
      }),
      db.aMLAlert.count({
        where: { alertType: { contains: 'SANCTION', mode: 'insensitive' } },
      }),
      db.sAR.count({ where: { status: { in: ['DRAFT', 'FILED'] } } }),
      db.aMLAlert.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.complianceReview.findMany({
        where: { status: 'PENDING', type: 'KYC' },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance overview"
        description="Active alerts, KYC queue and case pipeline."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open alerts"
          value={openAlerts.toString()}
          hint="AML / risk"
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={openAlerts > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Pending KYC"
          value={pendingKyc.toString()}
          hint="Awaiting review"
          icon={<UserCheck className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Sanctions hits"
          value={sanctionsHits.toString()}
          hint="All-time"
          icon={<Ban className="h-4 w-4" />}
          tone={sanctionsHits > 0 ? 'rose' : 'teal'}
        />
        <KpiCard
          label="Open cases"
          value={openCases.toString()}
          hint="SARs in flight"
          icon={<FolderOpen className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent AML alerts</CardTitle>
            <CardDescription>Latest open alerts requiring review</CardDescription>
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-6 w-6" />}
                title="No open alerts"
                description="When the risk engine flags suspicious activity, alerts will appear here."
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
                  {recentAlerts.map((a) => (
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending KYC reviews</CardTitle>
            <CardDescription>Oldest first</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingKycReviews.length === 0 ? (
              <EmptyState
                icon={<UserCheck className="h-6 w-6" />}
                title="KYC queue empty"
                description="New KYC submissions will appear here for review."
              />
            ) : (
              <div className="space-y-3">
                {pendingKycReviews.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border bg-card/50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {r.entityType}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {r.entityId.slice(0, 10)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{fmtDate(r.createdAt)}</span>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <div className="text-sm font-semibold">Compliance framework</div>
              <p className="mt-1 text-xs text-muted-foreground">
                The compliance module surfaces AML alerts, sanctions screening hits, KYC
                reviews and SAR cases. All actions are recorded in the audit trail for
                regulator review.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
