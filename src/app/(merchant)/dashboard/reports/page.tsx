import { redirect } from 'next/navigation';
import { requireMerchant } from '@/lib/auth-guards';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Receipt, Coins, ArrowDownToLine, TrendingUp, Wallet } from 'lucide-react';
import { ReportsExportButton } from './reports-export-button';

export const dynamic = 'force-dynamic';

interface Summary {
  totalRevenue: number;
  totalFees: number;
  totalRefunds: number;
  netRevenue: number;
  paymentCount: number;
  averageOrderValue: number;
}

interface PaymentRow {
  id: string;
  reference: string | null;
  amount: number;
  currency: string;
  fee: number;
  netAmount: number;
  status: string;
  method: string | null;
  description: string | null;
  createdAt: string;
  settledAt: string | null;
}

function fmtMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export default async function ReportsPage() {
  // Validates session + merchant role.
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

  const env = await getEnvironment();
  const merchantCurrency = merchant?.currency || 'GHS';

  // Completed payments for revenue + fee totals.
  const completedPayments = await db.payment.findMany({
    where: {
      merchantId,
      environment: env,
      status: 'COMPLETED',
    },
    select: {
      id: true,
      reference: true,
      amount: true,
      currency: true,
      fee: true,
      netAmount: true,
      status: true,
      method: true,
      description: true,
      createdAt: true,
      settledAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  // All refunds (regardless of payment status) for the refund total.
  const refunds = await db.refund.findMany({
    where: {
      merchantId,
      environment: env,
      status: 'COMPLETED',
    },
    select: { amount: true },
  });

  const totalRevenue = completedPayments.reduce((s, p) => s + Number(p.amount), 0);
  const totalFees = completedPayments.reduce((s, p) => s + Number(p.fee || 0), 0);
  const totalRefunds = refunds.reduce((s, r) => s + Number(r.amount), 0);
  const netRevenue = totalRevenue - totalFees - totalRefunds;
  const paymentCount = completedPayments.length;
  const averageOrderValue = paymentCount > 0 ? totalRevenue / paymentCount : 0;

  const summary: Summary = {
    totalRevenue,
    totalFees,
    totalRefunds,
    netRevenue,
    paymentCount,
    averageOrderValue,
  };

  const paymentRows: PaymentRow[] = completedPayments.map((p) => ({
    id: p.id,
    reference: p.reference,
    amount: Number(p.amount),
    currency: p.currency,
    fee: Number(p.fee || 0),
    netAmount: Number(p.netAmount || 0),
    status: p.status,
    method: p.method,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    settledAt: p.settledAt ? p.settledAt.toISOString() : null,
  }));

  const SUMMARY_CARDS = [
    {
      label: 'Total revenue',
      value: fmtMoney(totalRevenue, merchantCurrency),
      hint: `${paymentCount} completed payment${paymentCount === 1 ? '' : 's'}`,
      icon: <Receipt className="h-4 w-4" />,
      tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Fees collected',
      value: fmtMoney(totalFees, merchantCurrency),
      hint: 'Processing fees on completed payments',
      icon: <Coins className="h-4 w-4" />,
      tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    },
    {
      label: 'Total refunds',
      value: fmtMoney(totalRefunds, merchantCurrency),
      hint: `${refunds.length} refund${refunds.length === 1 ? '' : 's'} processed`,
      icon: <ArrowDownToLine className="h-4 w-4" />,
      tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    },
    {
      label: 'Net revenue',
      value: fmtMoney(netRevenue, merchantCurrency),
      hint: 'Revenue − fees − refunds',
      icon: <TrendingUp className="h-4 w-4" />,
      tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
    },
    {
      label: 'Payment count',
      value: paymentCount.toLocaleString(),
      hint: 'Completed payments',
      icon: <Wallet className="h-4 w-4" />,
      tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Average order value',
      value: fmtMoney(averageOrderValue, merchantCurrency),
      hint: 'Mean completed payment',
      icon: <Receipt className="h-4 w-4" />,
      tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Real-time financial summary across your completed payments.
          </p>
        </div>
        <ReportsExportButton rows={paymentRows} />
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SUMMARY_CARDS.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </span>
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-md ${c.tone}`}
                >
                  {c.icon}
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums">
                {c.value}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent completed payments table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Completed payments</CardTitle>
          <CardDescription>
            {paymentCount} payment{paymentCount === 1 ? '' : 's'} included in
            this report
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Receipt className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="mt-4 text-sm font-semibold">No completed payments yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Once you start receiving completed payments, they will appear
                here and contribute to your financial summary.
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">Method</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Fee</th>
                    <th className="px-3 py-2 text-right font-medium">Net</th>
                    <th className="px-3 py-2 text-right font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paymentRows.slice(0, 200).map((p) => (
                    <tr key={p.id} className="text-xs">
                      <td className="px-3 py-2 font-mono">
                        {p.reference ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.method ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtMoney(p.amount, p.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {fmtMoney(p.fee, p.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {fmtMoney(p.netAmount, p.currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {paymentRows.length > 200 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Showing the 200 most recent payments. Use{' '}
              <span className="font-medium text-foreground">Export CSV</span> to
              download all {paymentRows.length} rows.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
