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
import { Button } from '@/components/ui/button';
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
  ArrowRight,
  Scale,
  Flame,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface SeverityBucket {
  severity: string;
  count: number;
}

export default async function ComplianceOverviewPage() {
  const session = await getServerSession(authOptions);

  const [
    openAlerts,
    pendingKyc,
    sanctionsHits,
    openCases,
    recentAlerts,
    pendingKycReviews,
    severityAggRaw,
    closedAlerts,
  ] = await Promise.all([
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
    db.aMLAlert.groupBy({
      by: ['severity'],
      where: { status: 'OPEN' },
      _count: { _all: true },
      orderBy: { severity: 'asc' },
    }),
    db.aMLAlert.count({ where: { status: 'CLOSED' } }),
  ]);

  const severityBuckets: SeverityBucket[] = severityAggRaw.map((b) => ({
    severity: b.severity,
    count: b._count._all,
  }));
  const totalSeverity = severityBuckets.reduce((s, b) => s + b.count, 0) || 1;
  const criticalCount =
    severityBuckets
      .filter((b) => b.severity === 'CRITICAL' || b.severity === 'HIGH')
      .reduce((s, b) => s + b.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance overview"
        description="Active alerts, KYC queue and case pipeline."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/compliance/kyc">
                <UserCheck className="h-4 w-4" />
                KYC queue
              </Link>
            </Button>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/compliance/alerts">
                <ShieldAlert className="h-4 w-4" />
                Review alerts
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open alerts"
          value={openAlerts.toString()}
          hint={`${criticalCount} critical / high`}
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
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Recent AML alerts</CardTitle>
                <CardDescription>Latest open alerts requiring review</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/compliance/alerts">
                  All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-6 w-6" />}
                title="No open alerts"
                description="When the risk engine flags suspicious activity, alerts will appear here."
              />
            ) : (
              <div className="max-h-96 overflow-y-auto pr-1">
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
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alert severity mix</CardTitle>
              <CardDescription>Open alerts by severity</CardDescription>
            </CardHeader>
            <CardContent>
              {severityBuckets.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                  <Flame className="h-4 w-4 text-emerald-500" />
                  No open alerts. The risk engine is calm.
                </div>
              ) : (
                <div className="space-y-3">
                  {severityBuckets.map((b) => {
                    const pct = (b.count / totalSeverity) * 100;
                    const tone =
                      b.severity === 'CRITICAL' || b.severity === 'HIGH'
                        ? 'bg-rose-500'
                        : b.severity === 'MEDIUM'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500';
                    return (
                      <div key={b.severity} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium uppercase tracking-wide text-muted-foreground">
                            {b.severity}
                          </span>
                          <span className="tabular-nums font-semibold">{b.count}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${tone}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t pt-2 text-[10px] text-muted-foreground">
                    {closedAlerts.toLocaleString()} alert{closedAlerts === 1 ? '' : 's'} closed all-time.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Pending KYC reviews</CardTitle>
                  <CardDescription>Oldest first</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                  <Link href="/compliance/kyc">
                    All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
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
      </div>

      <Card>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <Scale className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <div className="text-sm font-semibold">Compliance framework</div>
              <p className="mt-1 text-xs text-muted-foreground">
                The compliance module surfaces AML alerts, sanctions screening hits, KYC
                reviews and SAR cases. All actions are recorded in the audit trail for
                regulator review.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/compliance/sanctions">
                    <Ban className="h-3.5 w-3.5" /> Sanctions log
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/compliance/cases">
                    <FolderOpen className="h-3.5 w-3.5" /> Case files
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
