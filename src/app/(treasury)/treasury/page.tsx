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
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface ReserveRow {
  currency: string;
  balance: number;
  backing: number;
}

export default async function TreasuryOverviewPage() {
  const session = await getServerSession(authOptions);

  // Aggregate wallet balances per currency as a proxy for reserves
  const walletAgg = await db.wallet.groupBy({
    by: ['currency'],
    _sum: { balance: true },
  });

  // Aggregate merchant bonds (treasury collateral)
  const bondAgg = await db.merchant.aggregate({ _sum: { bond: true } });
  const totalBonds = bondAgg._sum.bond ?? 0;

  // LP stake & collateral (treasury backing pool)
  const lpAgg = await db.lPProfile.aggregate({
    _sum: { stake: true, collateral: true },
  });
  const totalLpStake = lpAgg._sum.stake ?? 0;
  const totalLpCollateral = lpAgg._sum.collateral ?? 0;

  // Total payments volume (settled) — denominator for the reserve health ratio
  const paymentsAgg = await db.payment.aggregate({
    where: { status: 'COMPLETED' },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const totalPaymentsVolume = paymentsAgg._sum.amount ?? 0;
  const totalPaymentsCount = paymentsAgg._count._all ?? 0;

  const reserveRows: ReserveRow[] = walletAgg.map((w) => ({
    currency: w.currency,
    balance: w._sum.balance ?? 0,
    backing: Math.max(0, (w._sum.balance ?? 0) * 0.85),
  }));

  const totalReserves = reserveRows.reduce((s, r) => s + r.balance, 0);
  const totalBacking =
    reserveRows.reduce((s, r) => s + r.backing, 0) +
    totalBonds +
    totalLpCollateral;
  // Reserve health = wallet balances / total payments volume
  const reserveHealthPct =
    totalPaymentsVolume > 0
      ? (totalReserves / totalPaymentsVolume) * 100
      : 0;
  const backingRatio = totalReserves > 0 ? (totalBacking / totalReserves) * 100 : 0;

  // Active corridors: distinct corridor values on completed payments
  const corridorCounts = await db.payment.groupBy({
    by: ['corridor'],
    where: { status: 'COMPLETED', NOT: { corridor: null } },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: { _count: { id: 'desc' } },
    take: 8,
  });
  const activeCorridors = corridorCounts.filter((c) => c.corridor).length;

  // Open alerts (treasury-tagged AML alerts)
  const openAlerts = await db.aMLAlert.count({
    where: { status: 'OPEN', entityType: 'treasury' },
  });

  // System health (proxy: completed vs failed payments over last 24h)
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const recentPayments = await db.payment.groupBy({
    by: ['status'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const successCount =
    recentPayments.find((p) => p.status === 'COMPLETED')?._count._all ?? 0;
  const failedCount =
    recentPayments.find((p) => p.status === 'FAILED')?._count._all ?? 0;
  const total = recentPayments.reduce((s, p) => s + p._count._all, 0) || 1;
  const healthPct = Math.round((successCount / total) * 100);

  // Recent treasury-related audit log entries (covers freezes, transfers, rebalances…)
  const treasuryLogs = await db.auditLog.findMany({
    where: {
      OR: [
        { action: { contains: 'treasury', mode: 'insensitive' } },
        { action: { contains: 'reserve', mode: 'insensitive' } },
        { action: { contains: 'freeze', mode: 'insensitive' } },
        { action: { contains: 'rebalance', mode: 'insensitive' } },
        { resourceType: { equals: 'treasury', mode: 'insensitive' } },
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
                Corridors
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total reserves"
          value={fmtCurrency(totalReserves, 'USD')}
          hint={`${reserveRows.length} currencies`}
          icon={<Vault className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="Backing ratio"
          value={`${fmtNumber(backingRatio, 1)}%`}
          hint="Collateral / reserves"
          icon={<Gauge className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Active corridors"
          value={activeCorridors.toString()}
          hint={`${totalPaymentsCount.toLocaleString()} settled payments`}
          icon={<Route className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Open alerts"
          value={openAlerts.toString()}
          hint="Treasury-related"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={openAlerts > 0 ? 'rose' : 'amber'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Reserves by currency</CardTitle>
                <CardDescription>
                  Wallet balances aggregated by currency, with backing estimate
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
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Backing</TableHead>
                      <TableHead>Coverage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reserveRows.map((r) => {
                      const pct = r.balance > 0 ? Math.min(100, (r.backing / r.balance) * 100) : 0;
                      return (
                        <TableRow key={r.currency}>
                          <TableCell>
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {r.currency}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {fmtCurrency(r.balance, r.currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {fmtCurrency(r.backing, r.currency)}
                          </TableCell>
                          <TableCell className="w-40">
                            <div className="flex items-center gap-2">
                              <Progress value={pct} className="h-2" />
                              <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reserve health</CardTitle>
              <CardDescription>Reserves vs. settled volume</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">Coverage</span>
                </div>
                <StatusBadge
                  status={
                    reserveHealthPct >= 100
                      ? 'HEALTHY'
                      : reserveHealthPct >= 50
                      ? 'DEGRADED'
                      : 'CRITICAL'
                  }
                />
              </div>
              <Progress value={Math.min(100, reserveHealthPct)} className="h-2" />
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border bg-card/50 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Reserves</div>
                  <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmtCurrency(totalReserves, 'USD')}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Volume</div>
                  <div className="text-sm font-semibold tabular-nums">
                    {fmtCurrency(totalPaymentsVolume, 'USD')}
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {fmtNumber(reserveHealthPct, 1)}% of all-time settled payment volume is currently held as reserves.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Backing pool</CardTitle>
              <CardDescription>Collateral sources</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" /> Merchant bonds
                </span>
                <span className="font-semibold tabular-nums">{fmtCurrency(totalBonds, 'USD')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Vault className="h-4 w-4 text-teal-500" /> LP collateral
                </span>
                <span className="font-semibold tabular-nums">{fmtCurrency(totalLpCollateral, 'USD')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Gauge className="h-4 w-4 text-cyan-500" /> LP stake
                </span>
                <span className="font-semibold tabular-nums">{fmtCurrency(totalLpStake, 'USD')}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Top corridors</CardTitle>
            <CardDescription>Most-active settlement routes</CardDescription>
          </CardHeader>
          <CardContent>
            {corridorCounts.length === 0 ? (
              <EmptyState
                icon={<Route className="h-6 w-6" />}
                title="No corridor activity"
                description="Completed payments will populate corridor statistics here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Corridor</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corridorCounts.map((c) => (
                    <TableRow key={c.corridor}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {c.corridor}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c._count._all}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(c._sum.amount ?? 0, 'USD')}
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
            <CardTitle className="text-base">System health</CardTitle>
            <CardDescription>Last 24h payment success</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-medium">Health</span>
              </div>
              <StatusBadge status={healthPct >= 95 ? 'HEALTHY' : healthPct >= 80 ? 'DEGRADED' : 'CRITICAL'} />
            </div>
            <Progress value={healthPct} className="h-2" />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border bg-card/50 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Success</div>
                <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {successCount}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Failed</div>
                <div className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                  {failedCount}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Total</div>
                <div className="text-sm font-semibold tabular-nums">{total}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
                        {l.user?.email || (l.userId ? l.userId.slice(0, 8) : 'system')}
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
