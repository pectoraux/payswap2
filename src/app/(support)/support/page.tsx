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
  fmtCurrency,
  fmtDate,
} from '@/components/role-ui';
import { QuickSearch } from '@/components/support/quick-search';
import {
  History,
  Users,
  CreditCard,
  Building2,
  Search,
  ArrowRight,
  ArrowDownToLine,
  RefreshCcw,
  Webhook,
  AlertTriangle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SupportOverviewPage() {
  const session = await getServerSession(authOptions);

  const [
    recentLogs,
    users,
    merchants,
    payments,
    payouts,
    refunds,
    failedDeliveries,
  ] = await Promise.all([
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: true },
    }),
    db.user.count({ where: { deletedAt: null } }),
    db.merchant.count(),
    db.payment.count(),
    db.payout.count(),
    db.refund.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { merchant: true },
    }),
    db.webhookDelivery.findMany({
      where: {
        OR: [{ status: 'FAILED' }, { responseStatus: { gte: 400 } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { endpoint: true },
    }),
  ]);

  const openRefunds = refunds.filter((r) => r.status === 'PENDING').length;
  const openWebhookFailures = failedDeliveries.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support overview"
        description="Search the platform and review recent activity."
        action={
          <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Link href="/support/audit">
              <History className="h-4 w-4" />
              Open audit trail
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Quick search</CardTitle>
              <CardDescription>
                Find users, payments, merchants and more across the platform.
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/support/search">
                Full search <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <QuickSearch />
          <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            Quick search runs a fast client-side lookup. For advanced filters by
            date, status or amount, use the{' '}
            <Link
              href="/support/search"
              className="font-medium text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
            >
              full search page
            </Link>
            .
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total payments"
          value={payments.toLocaleString()}
          hint="All-time"
          icon={<CreditCard className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Total payouts"
          value={payouts.toLocaleString()}
          hint="All-time"
          icon={<ArrowDownToLine className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Merchants"
          value={merchants.toLocaleString()}
          icon={<Building2 className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Users"
          value={users.toLocaleString()}
          icon={<Users className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Recent audit logs</CardTitle>
                <CardDescription>Latest platform activity</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/support/audit">
                  All <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <EmptyState
                icon={<History className="h-6 w-6" />}
                title="No audit logs yet"
                description="Audit log entries will appear here as users interact with the platform."
              />
            ) : (
              <div className="max-h-96 overflow-y-auto pr-1">
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
                    {recentLogs.map((l) => (
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
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Refunds needing attention</CardTitle>
                  <CardDescription>Latest refund requests</CardDescription>
                </div>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                  {openRefunds} open
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {refunds.length === 0 ? (
                <EmptyState
                  icon={<RefreshCcw className="h-6 w-6" />}
                  title="No recent refunds"
                  description="Refund requests will surface here for support follow-up."
                />
              ) : (
                <div className="space-y-2">
                  {refunds.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border bg-card/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">
                          {r.merchant?.name || '—'}
                        </span>
                        <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(r.amount, 'USD')}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="font-mono">{r.type}</span>
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Webhook failures</CardTitle>
                  <CardDescription>Failed or 4xx+ deliveries</CardDescription>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    openWebhookFailures > 0
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {openWebhookFailures} flagged
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {failedDeliveries.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                  <Webhook className="h-4 w-4 text-emerald-500" />
                  No webhook failures. All recent deliveries succeeded.
                </div>
              ) : (
                <div className="space-y-2">
                  {failedDeliveries.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-lg border bg-card/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {d.endpoint?.url || '—'}
                        </span>
                        <StatusBadge status={d.status} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="font-mono">{d.eventType}</span>
                        <span className="flex items-center gap-1 tabular-nums">
                          <AlertTriangle className="h-3 w-3 text-rose-500" />
                          {d.responseStatus ?? '—'} · {d.attempts}x
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
