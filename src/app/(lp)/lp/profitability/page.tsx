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
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
  fmtDateShort,
} from '@/components/role-ui';
import {
  TrendingUp,
  Percent,
  Star,
  Activity,
  Clock,
  CheckCircle2,
  Users,
  Route as RouteIcon,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface MerchantAgg {
  merchantId: string;
  merchantName: string;
  volume: number;
  fees: number;
  count: number;
}

interface CorridorAgg {
  corridor: string;
  volume: number;
  fees: number;
  count: number;
}

export default async function LpProfitabilityPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;

  const account = userId
    ? await db.account.findFirst({
        where: { userId, type: 'LP' },
        include: { lpProfile: true },
      })
    : null;

  const lp = account?.lpProfile ?? null;

  // Pull ALL payments routed through this LP — we compute everything from
  // these records locally so we can compute deltas, success rates, and
  // corridor/merchant breakdowns in a single round-trip.
  const allPayments = lp
    ? await db.payment.findMany({
        where: { lpId: lp.id },
        orderBy: { createdAt: 'asc' },
        include: { merchant: { select: { id: true, name: true } } },
      })
    : [];

  const completed = allPayments.filter((p) => p.status === 'COMPLETED');
  const failed = allPayments.filter((p) =>
    ['FAILED', 'REJECTED', 'CANCELED', 'CANCELLED', 'EXPIRED', 'DECLINED'].includes(p.status),
  );
  const totalVolume = completed.reduce((s, p) => s + Number(p.amount), 0);
  const totalFees = completed.reduce((s, p) => s + Number(p.fee), 0);
  const netRevenue = completed.reduce((s, p) => s + Number(p.netAmount), 0);
  const margin = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;
  const apy = lp && Number(lp.stake) > 0 ? (totalFees / Number(lp.stake)) * 100 : 0;

  // Success rate = completed / (completed + failed).
  const terminal = completed.length + failed.length;
  const successRate = terminal > 0 ? (completed.length / terminal) * 100 : 0;

  // Average settlement time = mean(settledAt − createdAt) over completed payments.
  const settleTimesMs = completed
    .filter((p) => p.settledAt)
    .map((p) => p.settledAt!.getTime() - p.createdAt.getTime())
    .filter((d) => d >= 0);
  const avgSettleMs =
    settleTimesMs.length > 0
      ? settleTimesMs.reduce((s, d) => s + d, 0) / settleTimesMs.length
      : 0;

  // Last 6 months buckets for revenue + volume chart.
  const months: { label: string; fees: number; volume: number; key: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-US', { month: 'short' });
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const inMonth = completed.filter(
      (s) => s.settledAt && `${s.settledAt.getFullYear()}-${s.settledAt.getMonth()}` === key,
    );
    months.push({
      label,
      key,
      fees: inMonth.reduce((s, p) => s + Number(p.fee), 0),
      volume: inMonth.reduce((s, p) => s + Number(p.amount), 0),
    });
  }
  const maxFees = Math.max(...months.map((m) => m.fees), 1);
  const maxVolume = Math.max(...months.map((m) => m.volume), 1);

  // Top merchants by volume.
  const merchantMap = new Map<string, MerchantAgg>();
  for (const p of completed) {
    const id = p.merchant?.id ?? 'unknown';
    const name = p.merchant?.name ?? 'Unknown merchant';
    const cur = merchantMap.get(id) ?? { merchantId: id, merchantName: name, volume: 0, fees: 0, count: 0 };
    cur.volume += Number(p.amount);
    cur.fees += Number(p.fee);
    cur.count += 1;
    merchantMap.set(id, cur);
  }
  const topMerchants = Array.from(merchantMap.values())
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8);

  // Corridor breakdown by revenue.
  const corridorMap = new Map<string, CorridorAgg>();
  for (const p of completed) {
    const key = p.corridor ?? 'Unknown';
    const cur = corridorMap.get(key) ?? { corridor: key, volume: 0, fees: 0, count: 0 };
    cur.volume += Number(p.amount);
    cur.fees += Number(p.fee);
    cur.count += 1;
    corridorMap.set(key, cur);
  }
  const corridors = Array.from(corridorMap.values()).sort((a, b) => b.fees - a.fees);
  const maxCorridorFees = Math.max(...corridors.map((c) => c.fees), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profitability"
        description="Real analytics on fees, volume, settlement quality, and corridor performance."
      />

      {!lp ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              title="No LP profile linked"
              description="Contact the treasury team to onboard your liquidity provider account."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Fee revenue"
              value={fmtCurrency(totalFees, 'USD')}
              hint="All-time"
              icon={<TrendingUp className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Net revenue"
              value={fmtCurrency(netRevenue, 'USD')}
              hint="After fees"
              icon={<Activity className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Margin"
              value={`${fmtNumber(margin, 2)}%`}
              hint="Fees / volume"
              icon={<Percent className="h-4 w-4" />}
              tone="amber"
            />
            <KpiCard
              label="Yield on stake"
              value={`${fmtNumber(apy, 2)}%`}
              hint="Annualised"
              icon={<Star className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Settlement success"
              value={`${fmtNumber(successRate, 1)}%`}
              hint={`${completed.length} of ${terminal} terminal`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone="emerald"
            />
            <KpiCard
              label="Avg settlement time"
              value={
                avgSettleMs > 0 ? `${fmtNumber(avgSettleMs / 1000, 2)}s` : '—'
              }
              hint="createdAt → settledAt"
              icon={<Clock className="h-4 w-4" />}
              tone="teal"
            />
            <KpiCard
              label="Settled volume"
              value={fmtCurrency(totalVolume, 'USD')}
              hint={`${completed.length} settlements`}
              icon={<Activity className="h-4 w-4" />}
              tone="amber"
            />
            <KpiCard
              label="Avg ticket"
              value={fmtCurrency(completed.length ? totalVolume / completed.length : 0, 'USD')}
              hint="Per settlement"
              icon={<TrendingUp className="h-4 w-4" />}
              tone="cyan"
            />
          </div>

          {/* Revenue + Volume chart */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fee revenue (6 months)</CardTitle>
                <CardDescription>Monthly fee earnings from settled payments</CardDescription>
              </CardHeader>
              <CardContent>
                {months.every((m) => m.fees === 0) ? (
                  <EmptyState
                    icon={<TrendingUp className="h-6 w-6" />}
                    title="No fee data yet"
                    description="Fee revenue will be tracked here once settlements start routing through your liquidity."
                  />
                ) : (
                  <div className="flex h-56 items-end gap-3">
                    {months.map((m) => (
                      <div key={m.key} className="flex flex-1 flex-col items-center gap-2">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-teal-400 transition-all"
                            style={{ height: `${(m.fees / maxFees) * 100}%`, minHeight: '4px' }}
                            title={`${fmtCurrency(m.fees, 'USD')}`}
                          />
                        </div>
                        <div className="text-[10px] font-medium text-muted-foreground">
                          {m.label}
                        </div>
                        <div className="text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtCurrency(m.fees, 'USD')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Volume processed (6 months)</CardTitle>
                <CardDescription>Settled notional per month</CardDescription>
              </CardHeader>
              <CardContent>
                {months.every((m) => m.volume === 0) ? (
                  <EmptyState
                    icon={<Activity className="h-6 w-6" />}
                    title="No volume data yet"
                    description="Processed volume will be tracked here once settlements start."
                  />
                ) : (
                  <div className="flex h-56 items-end gap-3">
                    {months.map((m) => (
                      <div key={m.key} className="flex flex-1 flex-col items-center gap-2">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-teal-500 to-cyan-400 transition-all"
                            style={{ height: `${(m.volume / maxVolume) * 100}%`, minHeight: '4px' }}
                            title={`${fmtCurrency(m.volume, 'USD')}`}
                          />
                        </div>
                        <div className="text-[10px] font-medium text-muted-foreground">
                          {m.label}
                        </div>
                        <div className="text-[10px] tabular-nums text-teal-600 dark:text-teal-400">
                          {fmtCurrency(m.volume, 'USD')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Top merchants by volume */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Top merchants by volume
                </CardTitle>
                <CardDescription>
                  Where your settled flow is coming from.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topMerchants.length === 0 ? (
                  <EmptyState
                    icon={<Users className="h-6 w-6" />}
                    title="No merchant data yet"
                    description="Merchants will appear here once settlements are routed through your liquidity."
                  />
                ) : (
                  <div className="max-h-80 overflow-y-auto pr-1">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Merchant</TableHead>
                          <TableHead className="text-right">Volume</TableHead>
                          <TableHead className="text-right">Fees</TableHead>
                          <TableHead className="text-right">Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topMerchants.map((m) => (
                          <TableRow key={m.merchantId}>
                            <TableCell className="text-xs font-medium">
                              {m.merchantName}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums font-semibold">
                              {fmtCurrency(m.volume, 'USD')}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                              {fmtCurrency(m.fees, 'USD')}
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                              {m.count}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Corridor breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RouteIcon className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  Corridor revenue breakdown
                </CardTitle>
                <CardDescription>
                  Fee earnings per currency pair.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {corridors.length === 0 ? (
                  <EmptyState
                    icon={<RouteIcon className="h-6 w-6" />}
                    title="No corridor data yet"
                    description="Corridor performance will appear here once settlements are routed through your liquidity."
                  />
                ) : (
                  <div className="space-y-3">
                    {corridors.map((c) => (
                      <div key={c.corridor} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                              {c.corridor}
                            </span>
                            <span className="text-muted-foreground">
                              {c.count} settle{c.count === 1 ? '' : 's'} · {fmtCurrency(c.volume, 'USD')}
                            </span>
                          </div>
                          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {fmtCurrency(c.fees, 'USD')}
                          </span>
                        </div>
                        <Progress
                          value={(c.fees / maxCorridorFees) * 100}
                          className="h-1.5"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Lifetime summary footer */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lifetime summary</CardTitle>
              <CardDescription>
                All-time activity for this LP, computed from real settlement records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Total payments routed
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums">
                    {fmtNumber(allPayments.length)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Settled volume
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmtCurrency(totalVolume, 'USD')}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Active stake
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums">
                    {fmtCurrency(Number(lp.stake), 'USD')}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    First settlement
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {completed.length > 0
                      ? fmtDateShort(
                          completed.reduce(
                            (min, p) => (p.settledAt && p.settledAt < min ? p.settledAt : min),
                            completed[0].settledAt ?? new Date(),
                          ),
                        )
                      : '—'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
