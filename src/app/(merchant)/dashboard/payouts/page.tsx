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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/status-badge';
import { ArrowDownToLine } from 'lucide-react';
import { CreatePayoutDialog } from '@/components/merchant/create-payout-dialog';

export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
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
  const payouts = await db.payout.findMany({
    where: { merchantId, environment: env },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const totalPaid = payouts
    .filter((p) => p.status === 'COMPLETED')
    .reduce((s, p) => s + p.netAmount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
          <p className="text-sm text-muted-foreground">
            Track funds disbursed from your merchant account.
          </p>
        </div>
        <CreatePayoutDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total disbursed
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {fmt(totalPaid)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payouts
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {payouts.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total fees
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {fmt(payouts.reduce((s, p) => s + p.fee, 0))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All payouts</CardTitle>
          <CardDescription>
            {payouts.length} payout{payouts.length === 1 ? '' : 's'} recorded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ArrowDownToLine className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No payouts yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click <span className="font-medium text-foreground">New Payout</span> above to
                withdraw funds from your balance.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-semibold tabular-nums">
                      {fmt(p.sourceAmount, p.sourceCurrency)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.method}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {fmt(p.fee, p.sourceCurrency)}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmt(p.netAmount, p.destinationCurrency)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(p.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
