import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TrendingUp, CreditCard, Receipt } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const userId = (session?.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  const merchantId = userRole?.merchantId;
  if (!merchantId) redirect('/unauthorized');

  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  const env = await getEnvironment();
  const payments = await db.payment.findMany({
    where: { merchantId, status: 'COMPLETED', environment: env },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const currency = merchant?.currency || 'GHS';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);

  const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
  const paymentCount = payments.length;
  const avgOrderValue = paymentCount > 0 ? totalRevenue / paymentCount : 0;

  // Build a 14-day revenue series
  const days = 14;
  const now = new Date();
  const buckets: { label: string; revenue: number; key: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const revenue = payments
      .filter((p) => p.createdAt.toISOString().slice(0, 10) === key)
      .reduce((s, p) => s + p.amount, 0);
    buckets.push({
      key,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue,
    });
  }
  const maxRevenue = Math.max(...buckets.map((b) => b.revenue), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Understand your revenue and customer behaviour.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total revenue
              </span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {fmt(totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Payments
              </span>
              <CreditCard className="h-4 w-4 text-teal-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {paymentCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Avg order value
              </span>
              <Receipt className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {fmt(avgOrderValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Currency
              </span>
              <span className="text-xs font-semibold text-teal-600 dark:text-teal-400">
                {currency}
              </span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {merchant?.country || '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue (last 14 days)</CardTitle>
          <CardDescription>Daily completed payment volume</CardDescription>
        </CardHeader>
        <CardContent>
          {totalRevenue === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <TrendingUp className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No revenue data yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Once you receive completed payments, your revenue trend will appear here.
              </p>
            </div>
          ) : (
            <div className="flex h-56 items-end gap-1.5">
              {buckets.map((b) => {
                const heightPct = (b.revenue / maxRevenue) * 100;
                return (
                  <div
                    key={b.key}
                    className="group flex flex-1 flex-col items-center gap-2"
                    title={`${b.label}: ${fmt(b.revenue)}`}
                  >
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-teal-400 transition-all group-hover:from-emerald-600 group-hover:to-teal-500"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                      />
                    </div>
                    <span className="hidden text-[9px] text-muted-foreground sm:block">
                      {b.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
