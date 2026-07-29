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
import { Progress } from '@/components/ui/progress';
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
  fmtNumber,
  fmtDateShort,
} from '@/components/role-ui';
import {
  Vault,
  Gauge,
  Route,
  AlertTriangle,
  ShieldCheck,
  HeartPulse,
  ArrowRight,
  History,
  Scale,
  Snowflake,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react';
import { TreasuryAiRiskAssessment } from '@/components/treasury/ai-risk-assessment';

export const dynamic = 'force-dynamic';

interface ReserveRow {
  currency: string;
  balance: number;
  locked: number;
  pending: number;
  available: number;
  utilization: number;
}

interface CapitalFlowRow {
  id: string;
  kind: 'PAYMENT' | 'PAYOUT';
  direction: 'IN' | 'OUT';
  amount: number;
  currency: string;
  reference: string | null;
  status: string;
  createdAt: Date;
}

export default async function TreasuryOverviewPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  // Multi-currency wallet reserves.
  const walletAgg = await db.wallet.groupBy({
    by: ['currency'],
    _sum: { balance: true, pendingBalance: true, lockedBalance: true },
  });

  const reserveRows: ReserveRow[] = walletAgg.map((w) => {
    const balance = Number(w._sum.balance ?? 0);
    const locked = Number(w._sum.lockedBalance ?? 0);
    const pending = Number(w._sum.pendingBalance ?? 0);
    const available = Math.max(0, balance - locked);
    const utilization = balance > 0 ? (locked / balance) * 100 : 0;
    return {
      currency: w.currency,
      balance,
      locked,
      pending,
      available,
      utilization,
    };
  });

  const totalReserves = reserveRows.reduce((s, r) => s + r.balance, 0);
  const totalLocked = reserveRows.reduce((s, r) => s + r.locked, 0);

  // Total settled payment volume — denominator for backing ratio.
  const paymentsAgg = await db.payment.aggregate({
    where: { status: 'COMPLETED' },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const totalPaymentsVolume = Number(paymentsAgg._sum.amount ?? 0);
  const totalPaymentsCount = paymentsAgg._count._all ?? 0;

  // Backing ratio = total reserves / total payment volume.
  // HEALTHY > 1.2, DEGRADED 1.0-1.2, CRITICAL < 1.0.
  const backingRatio =
    totalPaymentsVolume > 0 ? totalReserves / totalPaymentsVolume : 0;
  const healthStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' =
    backingRatio >= 1.2
      ? 'HEALTHY'
      : backingRatio >= 1.0
        ? 'DEGRADED'
        : 'CRITICAL';

  // Active corridors: distinct corridor values on completed payments.
  const corridorCounts = await db.payment.groupBy({
    by: ['corridor'],
    where: { status: 'COMPLETED', NOT: { corridor: null } },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: { _count: { id: 'desc' } },
    take: 8,
  });
  const activeCorridors = corridorCounts.filter((c) => c.corridor).length;

  // Recent capital flows — payments (money IN) and payouts (money OUT).
  const recentPayments = await db.payment.findMany({
    where: { status: { in: ['COMPLETED', 'PENDING', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      amount: true,
      currency: true,
      reference: true,
      status: true,
      createdAt: true,
    },
  });
  const recentPayouts = await db.payout.findMany({
    where: { status: { in: ['COMPLETED', 'REQUESTED', 'FAILED'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      sourceAmount: true,
      sourceCurrency: true,
      status: true,
      reason: true,
      createdAt: true,
    },
  });

  const flows: CapitalFlowRow[] = [
    ...recentPayments.map((p) => ({
      id: p.id,
      kind: 'PAYMENT' as const,
      direction: 'IN' as const,
      amount: Number(p.amount),
      currency: p.currency,
      reference: p.reference,
      status: p.status,
      createdAt: p.createdAt,
    })),
    ...recentPayouts.map((p) => ({
      id: p.id,
      kind: 'PAYOUT' as const,
      direction: 'OUT' as const,
      amount: Number(p.sourceAmount),
      currency: p.sourceCurrency,
      reference: p.reason,
      status: p.status,
      createdAt: p.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);

  // Alert summary — open AML alerts, failed payouts, failed webhooks.
  const openAlerts = await db.aMLAlert.count({
    where: { status: 'OPEN' },
  });
  const failedPayouts = await db.payout.count({
    where: { status: 'FAILED' },
  });
  const failedWebhooks = await db.webhookDelivery.count({
    where: { status: 'FAILED' },
  });

  // Recent treasury-related audit log entries.
  const treasuryLogs = await db.auditLog.findMany({
    where: {
      OR: [
        { action: { contains: 'treasury' } },
        { action: { contains: 'reserve' } },
        { action: { contains: 'freeze' } },
        { action: { contains: 'rebalance' } },
        { action: { contains: 'corridor' } },
        { resourceType: { equals: 'treasury' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { user: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Treasury overview"
        description="Reserves, backing ratio and corridor health across the platform."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/treasury/corridors">
                <Route className="h-4 w-4" />
                View corridors
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
            >
              <Link href="/treasury/emergency">
                <Snowflake className="h-4 w-4" />
                Emergency freeze
              </Link>
            </Button>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/treasury/reserves">
                <Vault className="h-4 w-4" />
                View reserves
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* Reserve Health Card */}
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.03] to-transparent">
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-emerald-500" />
                Reserve health
              </CardTitle>
              <CardDescription>
                Reserves vs. settled payment volume — full backing requires ratio ≥ 1.0
              </CardDescription>
            </div>
            <StatusBadge status={healthStatus} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total reserves
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtCurrency(totalReserves, 'USD')}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {reserveRows.length} currencies · {fmtCurrency(totalLocked, 'USD')} locked
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Settled volume
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {fmtCurrency(Number(totalPaymentsVolume), 'USD')}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {fmtNumber(totalPaymentsCount, 0)} completed payments
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Backing ratio
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {fmtNumber(backingRatio, 3)}×
            </div>
            <div className="mt-2">
              <Progress
                value={Math.min(100, (backingRatio / 1.5) * 100)}
                className="h-1.5"
              />
            </div>
          </div>
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Health threshold
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
              <HeartPulse className="h-4 w-4 text-emerald-500" />
              {healthStatus === 'HEALTHY'
                ? '> 1.2× — well capitalised'
                : healthStatus === 'DEGRADED'
                  ? '1.0–1.2× — monitor'
                  : '< 1.0× — under-reserved'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Auto-rebalance recommended below 1.0×
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total reserves"
          value={fmtCurrency(totalReserves, 'USD')}
          hint={`${reserveRows.length} currencies`}
          icon={<Vault className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Settled volume"
          value={fmtCurrency(Number(totalPaymentsVolume), 'USD')}
          hint={`${fmtNumber(totalPaymentsCount, 0)} payments`}
          icon={<Gauge className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Active corridors"
          value={activeCorridors.toString()}
          hint="Distinct settlement routes"
          icon={<Route className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Open alerts"
          value={(openAlerts + failedPayouts + failedWebhooks).toString()}
          hint={`${openAlerts} AML · ${failedPayouts} payout fails · ${failedWebhooks} webhook fails`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={openAlerts + failedPayouts + failedWebhooks > 0 ? 'rose' : 'amber'}
        />
      </div>

      <TreasuryAiRiskAssessment />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Multi-currency Reserves Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Reserves by currency</CardTitle>
                <CardDescription>
                  Total balance, locked collateral and available reserves per currency
                </CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
                <Link href="/treasury/reserves">
                  Detail <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {reserveRows.length === 0 ? (
              <EmptyState
                icon={<Vault className="h-6 w-6" />}
                title="No reserves recorded"
                description="Once wallets are funded, reserve positions by currency will appear here."
              />
            ) : (
              <div className="max-h-96 overflow-y-auto pr-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Locked</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead>Utilisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reserveRows.map((r) => (
                      <TableRow key={r.currency}>
                        <TableCell>
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            {r.currency}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmtCurrency(r.balance, r.currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                          {fmtCurrency(r.locked, r.currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(r.available, r.currency)}
                        </TableCell>
                        <TableCell className="w-40">
                          <div className="flex items-center gap-2">
                            <Progress
                              value={Math.min(100, r.utilization)}
                              className="h-2"
                            />
                            <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                              {fmtNumber(r.utilization, 0)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alert Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Alert summary
            </CardTitle>
            <CardDescription>Open issues requiring treasury attention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-card/50 p-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-rose-500" />
                <span className="text-sm">AML alerts</span>
              </div>
              <span
                className={`text-lg font-bold tabular-nums ${
                  openAlerts > 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {openAlerts}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-card/50 p-3">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4 text-amber-500" />
                <span className="text-sm">Failed payouts</span>
              </div>
              <span
                className={`text-lg font-bold tabular-nums ${
                  failedPayouts > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {failedPayouts}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-card/50 p-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-500" />
                <span className="text-sm">Failed webhooks</span>
              </div>
              <span
                className={`text-lg font-bold tabular-nums ${
                  failedWebhooks > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {failedWebhooks}
              </span>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/treasury/reports">View full risk report</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Capital Flows */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent capital flows</CardTitle>
          <CardDescription>
            Last 10 payments (in) and payouts (out) across the platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flows.length === 0 ? (
            <EmptyState
              icon={<ArrowRight className="h-6 w-6" />}
              title="No capital flows yet"
              description="Payments and payouts will appear here as they are processed."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flows.map((f) => (
                    <TableRow key={`${f.kind}-${f.id}`}>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            f.direction === 'IN'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {f.direction === 'IN' ? (
                            <ArrowUpFromLine className="h-3 w-3" />
                          ) : (
                            <ArrowDownToLine className="h-3 w-3" />
                          )}
                          {f.direction === 'IN' ? 'In' : 'Out'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-[10px] uppercase text-muted-foreground">
                          {f.kind}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {f.reference ?? '—'}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${
                          f.direction === 'IN'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {f.direction === 'IN' ? '+' : '−'}
                        {fmtCurrency(f.amount, f.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={f.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateShort(f.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Treasury Activity Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Treasury activity</CardTitle>
              <CardDescription>
                Audit-trail entries for freezes, rebalances and reserve movements
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="-mr-2 text-emerald-600 dark:text-emerald-400">
              <Link href="/treasury/reports">
                Reports <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {treasuryLogs.length === 0 ? (
            <EmptyState
              icon={<History className="h-6 w-6" />}
              title="No treasury activity yet"
              description="Audited reserve operations — freezes, rebalances and transfers — will be recorded here as they happen."
            />
          ) : (
            <div className="max-h-80 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {treasuryLogs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.action}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.resourceType}
                        {l.resourceId ? `:${l.resourceId.slice(0, 8)}` : ''}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.user?.email ||
                          (l.userId ? l.userId.slice(0, 8) : 'system')}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={l.result} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateShort(l.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
