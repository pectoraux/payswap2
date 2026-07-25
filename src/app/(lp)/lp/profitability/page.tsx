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
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
} from '@/components/role-ui';
import { TrendingUp, Percent, Star, Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';

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

  const settlements = lp
    ? await db.payment.findMany({
        where: { lpId: lp.id, status: 'COMPLETED' },
      })
    : [];

  const totalVolume = settlements.reduce((s, p) => s + p.amount, 0);
  const totalFees = settlements.reduce((s, p) => s + p.fee, 0);
  const netRevenue = settlements.reduce((s, p) => s + p.netAmount, 0);
  const margin = totalVolume > 0 ? (totalFees / totalVolume) * 100 : 0;
  const apy =
    lp && lp.stake > 0 ? (totalFees / lp.stake) * 100 : 0;

  // Last 6 months buckets
  const months: { label: string; fees: number; volume: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-US', { month: 'short' });
    const inMonth = settlements.filter(
      (s) =>
        s.settledAt &&
        s.settledAt.getMonth() === d.getMonth() &&
        s.settledAt.getFullYear() === d.getFullYear(),
    );
    months.push({
      label,
      fees: inMonth.reduce((s, p) => s + p.fee, 0),
      volume: inMonth.reduce((s, p) => s + p.amount, 0),
    });
  }
  const maxFees = Math.max(...months.map((m) => m.fees), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profitability"
        description="Fees, margin and yield on your posted liquidity."
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

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Fee revenue (6 months)</CardTitle>
                <CardDescription>Monthly fee earnings</CardDescription>
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
                      <div key={m.label} className="flex flex-1 flex-col items-center gap-2">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-teal-400"
                            style={{ height: `${(m.fees / maxFees) * 100}%`, minHeight: '4px' }}
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
                <CardTitle className="text-base">Volume metrics</CardTitle>
                <CardDescription>Lifetime activity</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Settled volume</span>
                  <span className="font-semibold tabular-nums">
                    {fmtCurrency(totalVolume, 'USD')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Settlements</span>
                  <span className="font-semibold tabular-nums">{settlements.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Avg ticket</span>
                  <span className="font-semibold tabular-nums">
                    {fmtCurrency(settlements.length ? totalVolume / settlements.length : 0, 'USD')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Stake</span>
                  <span className="font-semibold tabular-nums">
                    {fmtCurrency(lp.stake, 'USD')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Reputation</span>
                  <span className="font-semibold tabular-nums">
                    {fmtNumber(lp.reputation, 2)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
