import Link from 'next/link';
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
import { Badge } from '@/components/ui/badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtDate,
} from '@/components/role-ui';
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { AlertTrustActions } from '@/components/compliance/alert-trust-actions';
import { OpenCaseDialog } from '@/components/compliance/open-case-dialog';
import { amlPipeline } from '@/trust';

export const dynamic = 'force-dynamic';

/**
 * AML alerts page — driven by the Trust Engine's AML pipeline.
 *
 * Shows every alert with the rule that fired, the evidence the rule
 * contributed, the entity's risk score (snapshot at time of alert) and the
 * action buttons (investigate / escalate / close / file SAR).
 */
export default async function ComplianceAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status as any;
  const severityFilter = sp.severity as any;

  const alerts = await amlPipeline.listAlerts({
    status: statusFilter,
    severity: severityFilter,
  });
  const rules = amlPipeline.listRules();

  const open = alerts.filter((a) => a.status === 'open').length;
  const closed = alerts.filter((a) => a.status === 'closed').length;
  const critical = alerts.filter(
    (a) => a.severity === 'critical' || a.severity === 'high',
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AML alerts"
        description="Real-time alerts from the Trust Engine's AML pipeline."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Open"
          value={open}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={open > 0 ? 'rose' : 'emerald'}
        />
        <KpiCard
          label="Critical / high"
          value={critical}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
        />
        <KpiCard
          label="Closed"
          value={closed}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Total"
          value={alerts.length}
          icon={<XCircle className="h-4 w-4" />}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">All alerts</CardTitle>
              <CardDescription>
                {alerts.length} alert{alerts.length === 1 ? '' : 's'} ·{' '}
                {rules.length} active rules
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip
                href="/compliance/alerts"
                label="All"
                active={!statusFilter}
              />
              <FilterChip
                href="/compliance/alerts?status=open"
                label="Open"
                active={statusFilter === 'open'}
              />
              <FilterChip
                href="/compliance/alerts?status=investigating"
                label="Investigating"
                active={statusFilter === 'investigating'}
              />
              <FilterChip
                href="/compliance/alerts?status=escalated"
                label="Escalated"
                active={statusFilter === 'escalated'}
              />
              <OpenCaseDialog triggerLabel="Open Case" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-6 w-6" />}
              title="No alerts"
              description="When the AML pipeline flags suspicious activity, alerts will appear here for review."
            />
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Raised</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <SeverityBadge severity={a.severity} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold">{a.ruleName}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {a.ruleId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {a.entityType}:{a.entityId.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        {a.riskScore !== undefined ? (
                          <span className="tabular-nums font-semibold">
                            {a.riskScore.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={a.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(new Date(a.createdAt))}
                      </TableCell>
                      <TableCell>
                        <AlertTrustActions
                          alertId={a.id}
                          status={a.status}
                        />
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
          <CardTitle className="text-base">AML rule library</CardTitle>
          <CardDescription>
            Built-in rules evaluated on every transaction
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold">{r.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {r.id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={r.severity} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {r.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-border text-muted-foreground hover:bg-accent/40'
      }`}
    >
      {label}
    </Link>
  );
}
