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
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/status-badge';
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
} from '@/components/role-ui';
import { TreasuryReportsExportButton } from '@/components/treasury/treasury-reports-export-button';
import {
  FileBarChart,
  TrendingUp,
  Coins,
  Scale,
  ShieldAlert,
  ArrowDownToLine,
  Gauge,
  Activity,
  Award,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface DailyRow {
  date: string;
  reserves: number;
  volume: number;
  fees: number;
  net: number;
}

export default async function TreasuryReportsPage() {
  const session = await getServerSession(authOptions);

  // --- Total reserves (current snapshot) ---------------------------------
  const walletAgg = await db.wallet.groupBy({
    by: ['currency'],
    _sum: { balance: true },
  });
  const totalReserves = walletAgg.reduce(
    (s, w) => s + Number(w._sum.balance ?? 0),
    0,
  );

  // --- Daily treasury report (last 14 days) ------------------------------
  const now = new Date();
  const dailyRows: DailyRow[] = [];
  for (let i = 13; i >= 0; i--) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const agg = await db.payment.aggregate({
      where: {
        createdAt: { gte: start, lt: end },
        status: 'COMPLETED',
      },
      _sum: { amount: true, fee: true },
      _count: { _all: true },
    });
    const volume = Number(agg._sum.amount ?? 0);
    const fees = Number(agg._sum.fee ?? 0);
    dailyRows.push({
      date: start.toISOString().slice(0, 10),
      // Reserves are reported as the current snapshot — we don't have
      // historical reserve snapshots in this iteration.
      reserves: totalReserves,
      volume,
      fees,
      net: volume - fees,
    });
  }

  const totalVolume = dailyRows.reduce((s, d) => s + d.volume, 0);
  const totalFees = dailyRows.reduce((s, d) => s + d.fees, 0);

  // --- Settlement summary ------------------------------------------------
  const paymentStatusAgg = await db.payment.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const statusMap = new Map<string, number>();
  for (const s of paymentStatusAgg) {
    statusMap.set(s.status, s._count._all);
  }
  const totalPayments = [...statusMap.values()].reduce((s, n) => s + n, 0);
  const completedPayments = statusMap.get('COMPLETED') ?? 0;
  const failedPayments = statusMap.get('FAILED') ?? 0;
  const successRate =
    totalPayments > 0 ? (completedPayments / totalPayments) * 100 : 0;

  // Average settlement time across completed payments with settledAt.
  const settledPayments = await db.payment.findMany({
    where: { status: 'COMPLETED', settledAt: { not: null } },
    select: { createdAt: true, settledAt: true },
    take: 5000,
    orderBy: { createdAt: 'desc' },
  });
  let avgSettleMs: number | null = null;
  if (settledPayments.length > 0) {
    const sum = settledPayments.reduce((s, p) => {
      if (!p.settledAt) return s;
      const ms = p.settledAt.getTime() - p.createdAt.getTime();
      return Number.isFinite(ms) && ms >= 0 ? s + ms : s;
    }, 0);
    avgSettleMs = sum / settledPayments.length;
  }

  // --- LP summary --------------------------------------------------------
  // LP revenue = sum of fees on completed payments that have an lpId.
  const lpRevenueAgg = await db.payment.aggregate({
    where: { status: 'COMPLETED', NOT: { lpId: null } },
    _sum: { fee: true },
  });
  const lpRevenue = Number(lpRevenueAgg._sum.fee ?? 0);

  // Top LPs by volume (last 30 days).
  const since30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const lpVolumeAgg = await db.payment.groupBy({
    by: ['lpId'],
    where: {
      status: 'COMPLETED',
      NOT: { lpId: null },
      createdAt: { gte: since30d },
    },
    _sum: { amount: true, fee: true },
    orderBy: { _sum: { amount: 'desc' } },
    take: 5,
  });
  const lpIds = lpVolumeAgg
    .map((l) => l.lpId)
    .filter((id): id is string => !!id);
  const lpProfiles = await db.lPProfile.findMany({
    where: { id: { in: lpIds } },
    select: { id: true, name: true },
  });
  const lpNameMap = new Map(lpProfiles.map((l) => [l.id, l.name]));
  const topLps = lpVolumeAgg
    .filter((l) => !!l.lpId)
    .map((l) => ({
      lpId: l.lpId as string,
      name: lpNameMap.get(l.lpId as string) ?? 'Unknown LP',
      volume: Number(l._sum.amount ?? 0),
      revenue: Number(l._sum.fee ?? 0),
    }));

  // --- Risk summary ------------------------------------------------------
  const openAlerts = await db.aMLAlert.count({
    where: { status: 'OPEN' },
  });
  const failedPayouts = await db.payout.count({
    where: { status: 'FAILED' },
  });
  const openDisputes = await db.refund.count({
    where: { status: 'PENDING' },
  });

  // For CSV export.
  const csvRows = dailyRows.map((d) => ({
    date: d.date,
    reserves: d.reserves,
    volume: d.volume,
    fees: d.fees,
    net: d.net,
  }));
  const csvSummary = {
    totalPayments,
    completedPayments,
    failedPayments,
    successRate,
    avgSettleMs,
    lpRevenue,
    openAlerts,
    failedPayouts,
    openDisputes,
    totalReserves,
    totalVolume,
    totalFees,
  };
  const csvTopLps = topLps.map((l) => ({
    lpId: l.lpId,
    volume: l.volume,
    revenue: l.revenue,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Daily treasury performance, settlement health, LP activity and risk exposure."
        action={
          <TreasuryReportsExportButton
            rows={csvRows}
            summary={csvSummary}
            topLps={csvTopLps}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total reserves"
          value={fmtCurrency(totalReserves, 'USD')}
          icon={<Scale className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="14-day volume"
          value={fmtCurrency(totalVolume, 'USD')}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="14-day fees"
          value={fmtCurrency(totalFees, 'USD')}
          icon={<Coins className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Net position"
          value={fmtCurrency(totalVolume - totalFees, 'USD')}
          hint="Volume − fees"
          icon={<Gauge className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      {/* Daily Treasury Report */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileBarChart className="h-4 w-4 text-emerald-500" />
            Daily treasury report
          </CardTitle>
          <CardDescription>
            Reserves, volume, fees and net position over the last 14 days
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dailyRows.every((d) => d.volume === 0 && d.fees === 0) ? (
            <EmptyState
              icon={<FileBarChart className="h-6 w-6" />}
              title="No reporting data yet"
              description="Daily aggregates will populate as payments are processed."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Reserves</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead className="text-right">Net position</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyRows.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="font-medium">{d.date}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {fmtCurrency(d.reserves, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(d.volume, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmtCurrency(d.fees, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(d.net, 'USD')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settlement Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-teal-500" />
              Settlement summary
            </CardTitle>
            <CardDescription>
              Payment outcomes and settlement speed across the platform
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Total
                </div>
                <div className="text-lg font-bold tabular-nums">
                  {fmtNumber(totalPayments, 0)}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Completed
                </div>
                <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtNumber(completedPayments, 0)}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Failed
                </div>
                <div className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
                  {fmtNumber(failedPayments, 0)}
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Success rate</span>
                <span
                  className={`font-semibold tabular-nums ${
                    successRate >= 95
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : successRate >= 80
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {fmtNumber(successRate, 2)}%
                </span>
              </div>
              <Progress value={successRate} className="h-2" />
            </div>
            <div className="flex items-center justify-between rounded-lg border bg-card/50 p-3">
              <span className="text-sm text-muted-foreground">
                Avg settlement time
              </span>
              <span className="font-semibold tabular-nums">
                {avgSettleMs !== null
                  ? `${fmtNumber(avgSettleMs, 0)} ms`
                  : '—'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* LP Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4 text-emerald-500" />
              LP summary
            </CardTitle>
            <CardDescription>
              Total LP revenue and top liquidity providers by volume (30d)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Total LP revenue
                </div>
                <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtCurrency(Number(lpRevenue), 'USD')}
                </div>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Active LPs (30d)
                </div>
                <div className="text-lg font-bold tabular-nums">
                  {topLps.length}
                </div>
              </div>
            </div>
            {topLps.length === 0 ? (
              <EmptyState
                icon={<Award className="h-6 w-6" />}
                title="No LP activity"
                description="LPs will appear here once they route completed payments through PaySwap."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>LP</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topLps.map((lp) => (
                    <TableRow key={lp.lpId}>
                      <TableCell className="text-xs">
                        <div className="font-semibold">{lp.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {lp.lpId.slice(0, 12)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(Number(lp.volume), 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmtCurrency(Number(lp.revenue), 'USD')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk Summary */}
      <Card className="border-rose-500/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-rose-500" />
            Risk summary
          </CardTitle>
          <CardDescription>
            Open compliance, payout and dispute exposure across the platform
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-lg border bg-card/50 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-500" />
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Open AML alerts
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    openAlerts > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {openAlerts}
                </div>
              </div>
            </div>
            <StatusBadge status={openAlerts > 0 ? 'CRITICAL' : 'HEALTHY'} />
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-card/50 p-4">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Failed payouts
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    failedPayouts > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {failedPayouts}
                </div>
              </div>
            </div>
            <StatusBadge status={failedPayouts > 0 ? 'DEGRADED' : 'HEALTHY'} />
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-card/50 p-4">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-amber-500" />
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Open disputes
                </div>
                <div
                  className={`text-2xl font-bold tabular-nums ${
                    openDisputes > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {openDisputes}
                </div>
              </div>
            </div>
            <StatusBadge status={openDisputes > 0 ? 'DEGRADED' : 'HEALTHY'} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
