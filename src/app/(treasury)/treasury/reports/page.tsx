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
import {
  KpiCard,
  EmptyState,
  PageHeader,
  fmtCurrency,
  fmtNumber,
  fmtDateShort,
} from '@/components/role-ui';
import { FileBarChart, CalendarDays, Coins, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TreasuryReportsPage() {
  const session = await getServerSession(authOptions);

  // Monthly aggregates for the last 6 months
  const now = new Date();
  const monthly: {
    label: string;
    volume: number;
    fees: number;
    payments: number;
  }[] = [];

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const agg = await db.payment.aggregate({
      where: { createdAt: { gte: start, lt: end }, status: 'COMPLETED' },
      _sum: { amount: true, fee: true },
      _count: { _all: true },
    });
    monthly.push({
      label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      volume: agg._sum.amount ?? 0,
      fees: agg._sum.fee ?? 0,
      payments: agg._count._all,
    });
  }

  const totalVolume = monthly.reduce((s, m) => s + m.volume, 0);
  const totalFees = monthly.reduce((s, m) => s + m.fees, 0);
  const totalPayments = monthly.reduce((s, m) => s + m.payments, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Aggregated treasury performance over time."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="6-month volume"
          value={fmtCurrency(totalVolume, 'USD')}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="emerald"
        />
        <KpiCard
          label="6-month fees"
          value={fmtCurrency(totalFees, 'USD')}
          icon={<Coins className="h-4 w-4" />}
          tone="teal"
        />
        <KpiCard
          label="Payments"
          value={totalPayments.toString()}
          icon={<FileBarChart className="h-4 w-4" />}
          tone="cyan"
        />
        <KpiCard
          label="Avg ticket"
          value={fmtCurrency(totalPayments ? totalVolume / totalPayments : 0, 'USD')}
          icon={<CalendarDays className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly performance</CardTitle>
          <CardDescription>Completed payment volume and fees (last 6 months)</CardDescription>
        </CardHeader>
        <CardContent>
          {monthly.every((m) => m.volume === 0 && m.fees === 0) ? (
            <EmptyState
              icon={<FileBarChart className="h-6 w-6" />}
              title="No reporting data yet"
              description="Monthly aggregates will populate as payments are processed."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Avg ticket</TableHead>
                  <TableHead className="text-right">Margin (bps)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.map((m) => {
                  const avg = m.payments > 0 ? m.volume / m.payments : 0;
                  const bps = m.volume > 0 ? (m.fees / m.volume) * 10000 : 0;
                  return (
                    <TableRow key={m.label}>
                      <TableCell className="font-medium">{m.label}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtCurrency(m.volume, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmtCurrency(m.fees, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.payments}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtCurrency(avg, 'USD')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNumber(bps, 1)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
