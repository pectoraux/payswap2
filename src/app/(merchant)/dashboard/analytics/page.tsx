import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/stat-card';
import {
  DollarSign, CreditCard, Users, TrendingUp, Activity,
} from 'lucide-react';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { formatCurrency, formatNumber } from '@/lib/format';
import {
  AnalyticsCharts,
  type RevenuePoint,
  type MethodSlice,
  type TopCustomer,
} from '@/components/merchant/analytics-charts';

export const dynamic = 'force-dynamic';

const RANGE_DAYS = 30;

export default async function AnalyticsPage() {
  const { merchant } = await requireMerchant();
  const currency = merchant.currency || 'USD';
  const since = new Date(Date.now() - RANGE_DAYS * 24 * 60 * 60 * 1000);

  const [
    completedAgg,
    failedCount,
    avgAgg,
    methodBreakdown,
    recentCompleted,
    topCustomerRows,
  ] = await Promise.all([
    db.payment.aggregate({
      where: { merchantId: merchant.id, status: 'COMPLETED' },
      _sum: { amount: true, fee: true },
      _count: { _all: true },
    }),
    db.payment.count({ where: { merchantId: merchant.id, status: 'FAILED' } }),
    db.payment.aggregate({
      where: { merchantId: merchant.id, status: 'COMPLETED' },
      _avg: { amount: true },
    }),
    db.payment.groupBy({
      by: ['method'],
      where: { merchantId: merchant.id, status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    db.payment.findMany({
      where: {
        merchantId: merchant.id,
        status: 'COMPLETED',
        createdAt: { gte: since },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.customerRecord.findMany({
      where: { merchantId: merchant.id, deletedAt: null },
      orderBy: { totalSpent: 'desc' },
      take: 8,
      select: { name: true, totalSpent: true },
    }),
  ]);

  // Build per-day revenue series
  const dayMap = new Map<string, number>();
  for (let i = RANGE_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    dayMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const p of recentCompleted) {
    const k = new Date(p.createdAt).toISOString().slice(0, 10);
    if (dayMap.has(k)) dayMap.set(k, (dayMap.get(k) ?? 0) + Number(p.amount));
  }
  const revenueSeries: RevenuePoint[] = Array.from(dayMap.entries()).map(([date, total]) => ({
    date: date.slice(5), // MM-DD for compactness
    total,
  }));

  const methods: MethodSlice[] = methodBreakdown
    .filter((m) => !!m.method)
    .map((m) => ({ method: m.method as string, total: Number(m._sum.amount ?? 0) }))
    .sort((a, b) => b.total - a.total);

  const topCustomers: TopCustomer[] = topCustomerRows.map((c) => ({
    name: c.name,
    totalSpent: Number(c.totalSpent),
  }));

  const totalRevenue = Number(completedAgg._sum.amount ?? 0);
  const totalFees = Number(completedAgg._sum.fee ?? 0);
  const avgTicket = Number(avgAgg._avg.amount ?? 0);
  const completedCount = completedAgg._count._all;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={`Performance over the last ${RANGE_DAYS} days · ${currency}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Gross revenue"
          value={formatCurrency(totalRevenue, currency)}
          icon={<DollarSign className="h-5 w-5" />}
          hint="All completed payments"
          color="emerald"
        />
        <StatCard
          label="Net revenue"
          value={formatCurrency(totalRevenue - totalFees, currency)}
          icon={<TrendingUp className="h-5 w-5" />}
          hint={`${formatCurrency(totalFees, currency)} fees`}
          color="teal"
        />
        <StatCard
          label="Avg ticket"
          value={formatCurrency(avgTicket, currency)}
          icon={<Activity className="h-5 w-5" />}
          hint={`${formatNumber(completedCount)} payments`}
          color="sky"
        />
        <StatCard
          label="Failed"
          value={formatNumber(failedCount)}
          icon={<CreditCard className="h-5 w-5" />}
          hint="Needs attention"
          color={failedCount > 0 ? 'rose' : 'emerald'}
        />
      </div>

      <AnalyticsCharts
        revenueSeries={revenueSeries}
        methods={methods}
        topCustomers={topCustomers}
        currency={currency}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer reach</CardTitle>
          <CardDescription>Quick stats on paying customers</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Unique customers</div>
            <div className="mt-1 flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-500" />
              <span className="text-xl font-semibold">{formatNumber(topCustomers.length)}</span>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Top method</div>
            <div className="mt-1 text-xl font-semibold">
              {methods[0]?.method?.replace(/_/g, ' ') ?? '—'}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Top customer</div>
            <div className="mt-1 truncate text-xl font-semibold">
              {topCustomers[0]?.name ?? '—'}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
