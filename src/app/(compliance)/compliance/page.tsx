import Link from 'next/link';
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
  Gauge,
  Send,
  Plane,
  ScrollText,
  Activity,
} from 'lucide-react';
import { ComplianceAiPrioritization } from '@/components/compliance/ai-prioritization';
import { getTrustOverview, amlPipeline } from '@/trust';

export const dynamic = 'force-dynamic';

/**
 * Compliance overview — driven by the Trust Engine.
 *
 * Surfaces: active alerts by severity, pending KYC queue, SARs status,
 * travel-rule backlog, risk-score distribution, recent audit events
 * and live monitoring stats.
 */
export default async function ComplianceOverviewPage() {
  const overview = await getTrustOverview();
  const recentAlerts = (await amlPipeline
    .listAlerts({ status: 'open' }))
    .slice(0, 10);

  const severityBuckets = (
    ['critical', 'high', 'medium', 'low'] as const
  ).map((sev) => ({ severity: sev, count: overview.alerts.bySeverity[sev] }));
  const totalSeverity = severityBuckets.reduce((s, b) => s + b.count, 0) || 1;
  const criticalCount =
    overview.alerts.bySeverity.critical + overview.alerts.bySeverity.high;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trust & Compliance OS"
        description="Risk scoring, AML pipeline, sanctions, KYC/KYB, SARs, travel rule and audit — unified."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/compliance/risk">
                <Gauge className="h-4 w-4" />
                Risk scores
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
          value={overview.alerts.open}
          hint={`${criticalCount} critical / high`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={overview.alerts.open > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Pending KYC"
          value={overview.kyc.pending + overview.kyc.inReview}
          hint={`${overview.kyc.inReview} in review`}
          icon={<UserCheck className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="SARs filed"
          value={overview.sars.filed + overview.sars.acknowledged}
          hint={`${overview.sars.draft} draft`}
          icon={<Send className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Avg risk score"
          value={overview.risk.averageScore.toFixed(1)}
          hint={`${overview.risk.critical} critical · ${overview.risk.high} high`}
          icon={<Gauge className="h-4 w-4" />}
          tone={overview.risk.averageScore >= 50 ? 'rose' : 'emerald'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Sanctions pending"
          value={overview.sanctions.pending}
          hint={`${overview.sanctions.truePositives} true positive`}
          icon={<Ban className="h-4 w-4" />}
          tone={overview.sanctions.pending > 0 ? 'rose' : 'teal'}
        />
        <KpiCard
          label="Travel rule pending"
          value={overview.travelRule.pending}
          hint={`${overview.travelRule.transmitted} transmitted`}
          icon={<Plane className="h-4 w-4" />}
          tone={overview.travelRule.pending > 0 ? 'amber' : 'emerald'}
        />
        <KpiCard
          label="Txn monitored"
          value={overview.monitoring.totalEvaluated}
          hint={`${overview.monitoring.blocked} blocked`}
          icon={<Activity className="h-4 w-4" />}
          tone="violet"
        />
        <KpiCard
          label="Open cases"
          value={overview.alerts.investigating + overview.alerts.escalated}
          hint={`${overview.alerts.escalated} escalated`}
          icon={<FolderOpen className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <ComplianceAiPrioritization />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Open AML alerts</CardTitle>
                <CardDescription>Latest alerts from the AML pipeline</CardDescription>
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
                description="When the AML pipeline flags suspicious activity, alerts will appear here."
              />
            ) : (
              <div className="max-h-96 overflow-y-auto pr-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Raised</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentAlerts.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <SeverityBadge severity={a.severity} />
                        </TableCell>
                        <TableCell className="text-xs">{a.ruleName}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {a.entityType}:{a.entityId.slice(0, 8)}
                        </TableCell>
                        <TableCell>
                          <StatusPill status={a.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(new Date(a.createdAt))}
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
              {totalSeverity === 1 && criticalCount === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                  <Flame className="h-4 w-4 text-emerald-500" />
                  No open alerts. The risk engine is calm.
                </div>
              ) : (
                <div className="space-y-3">
                  {severityBuckets.map((b) => {
                    const pct = (b.count / totalSeverity) * 100;
                    const tone =
                      b.severity === 'critical' || b.severity === 'high'
                        ? 'bg-rose-500'
                        : b.severity === 'medium'
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
                    {overview.alerts.closed + overview.alerts.sarFiled} alert
                    {(overview.alerts.closed + overview.alerts.sarFiled) === 1
                      ? ''
                      : 's'}{' '}
                    closed all-time.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Risk distribution</CardTitle>
              <CardDescription>Entities by risk level</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(['critical', 'high', 'medium', 'low'] as const).map((lvl) => (
                  <Link
                    key={lvl}
                    href={`/compliance/risk?level=${lvl}`}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2 text-xs transition-colors hover:bg-accent/40"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          lvl === 'critical'
                            ? 'bg-rose-500'
                            : lvl === 'high'
                            ? 'bg-amber-500'
                            : lvl === 'medium'
                            ? 'bg-teal-500'
                            : 'bg-emerald-500'
                        }`}
                      />
                      <span className="font-medium uppercase tracking-wide text-muted-foreground">
                        {lvl}
                      </span>
                    </span>
                    <span className="tabular-nums font-semibold">
                      {overview.risk[lvl]}
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="h-4 w-4 text-emerald-500" />
                Recent compliance audit
              </CardTitle>
              <CardDescription>
                Last 10 trust-engine events — every disposition, decision and filing.
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/compliance/audit">
                Full trail <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {overview.recentAudit.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="h-6 w-6" />}
              title="No audit events yet"
              description="As compliance actions are taken, the audit trail will populate here."
            />
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.recentAudit.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.action}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.actorId.slice(0, 12)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.entityType}:{e.entityId.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            e.result === 'success'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : e.result === 'denied'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {e.result}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(e.createdAt))}
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
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <Scale className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <div className="text-sm font-semibold">Trust Engine framework</div>
              <p className="mt-1 text-xs text-muted-foreground">
                The Trust Engine unifies risk scoring, AML rules, sanctions
                screening, KYC/KYB, SAR management, the FATF travel rule and a
                full audit trail. Every action is recorded for regulator review.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/compliance/sanctions">
                    <Ban className="h-3.5 w-3.5" /> Sanctions log
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/compliance/sars">
                    <Send className="h-3.5 w-3.5" /> SARs
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/compliance/travel-rule">
                    <Plane className="h-3.5 w-3.5" /> Travel rule
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

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === 'critical' || severity === 'high'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : severity === 'medium'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {severity}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'closed' || status === 'sar_filed'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : status === 'escalated'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : status === 'investigating'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'bg-teal-500/10 text-teal-600 dark:text-teal-400';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
    >
      {status}
    </span>
  );
}
