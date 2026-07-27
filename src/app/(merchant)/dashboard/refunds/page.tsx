import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireMerchant } from '@/lib/auth-guards';
import { getEnvironment } from '@/lib/environment';
// M-RT-19: reads go through the read-model façades. db.refund is forbidden.
// We fetch refunds via refundReadModel, payments via paymentReadModel, and
// join in memory (the projection doesn't store relationships).
import { refundReadModel, paymentReadModel } from '@/runtime';
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
import { Badge } from '@/components/ui/badge';
import { RotateCcw } from 'lucide-react';
import { CreateRefundDialog } from '@/components/merchant/create-refund-dialog';

export const dynamic = 'force-dynamic';

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentId?: string }>;
}) {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

  const env = await getEnvironment();

  // M-RT-19: fetch via read-model façades (backed by runtime projections).
  const [refunds, recentPaymentViews] = await Promise.all([
    refundReadModel.list(merchantId, env, { take: 100 }),
    paymentReadModel.list(merchantId, { take: 500 }),
  ]);

  // Build a payment lookup map for joining (the projection doesn't store
  // relationships — we join in memory, same pattern as the dashboard).
  const paymentMap = new Map(recentPaymentViews.map((p) => [p.id, p]));

  // Recent payments the merchant can issue refunds against (filter in memory).
  const recentPayments = recentPaymentViews
    .filter((p) => ['SUCCESS', 'COMPLETED', 'SETTLED', 'SUCCEEDED'].includes(p.status))
    .slice(0, 25)
    .map((p) => ({ id: p.id, reference: p.reference, amount: p.amount, currency: p.currency }));

  // When the user clicks "Create Refund" on a payment detail page we link
  // here with ?paymentId=… — pre-select that payment in the dialog so they
  // don't have to find it in the dropdown.
  const sp = await searchParams;
  const preselectPaymentId =
    typeof sp?.paymentId === 'string' && sp.paymentId.trim()
      ? sp.paymentId.trim()
      : '';

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const totalRefunded = refunds
    .filter((r) => r.status === 'COMPLETED' || r.status === 'APPROVED')
    .reduce((s, r) => s + r.amount, 0);
  const pending = refunds.filter((r) => r.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Refunds</h1>
          <p className="text-sm text-muted-foreground">
            Track and manage refunds issued to your customers.
          </p>
        </div>
        <CreateRefundDialog
          payments={recentPayments}
          defaultPaymentId={preselectPaymentId}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total refunds
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">{refunds.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Amount refunded
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmt(totalRefunded)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pending review
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {pending}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All refunds</CardTitle>
          <CardDescription>
            {refunds.length} refund{refunds.length === 1 ? '' : 's'} on record
          </CardDescription>
        </CardHeader>
        <CardContent>
          {refunds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <RotateCcw className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No refunds yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click <span className="font-medium text-foreground">New Refund</span> above to issue
                a refund against a completed payment.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment reference</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refunds.map((r) => {
                  const payment = paymentMap.get(r.paymentId);
                  const ref = payment?.reference || r.paymentId.slice(0, 12);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/dashboard/payments/${encodeURIComponent(r.paymentId)}`}
                          className="hover:text-emerald-600 hover:underline dark:hover:text-emerald-400"
                        >
                          {ref}
                        </Link>
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {fmt(r.amount, payment?.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            r.type === 'FULL'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }
                        >
                          {r.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                        {r.reason || '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(r.createdAt)}
                      </TableCell>
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
