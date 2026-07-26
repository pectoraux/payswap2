import { redirect } from 'next/navigation';
import Link from 'next/link';
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
import { CreditCard, ExternalLink } from 'lucide-react';
import { CreatePaymentDialog } from '@/components/merchant/create-payment-dialog';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
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

  // The customer detail page links here with ?customer=<id> — when that
  // param is present, we filter the payment list to rows whose metadata
  // references that customer record (the create-payment flow stores
  // customerRecordId in metadata).
  const sp = await searchParams;
  const customerFilterId =
    typeof sp?.customer === 'string' && sp.customer.trim()
      ? sp.customer.trim()
      : null;

  const payments = await db.payment.findMany({
    where: {
      merchantId,
      environment: env,
      ...(customerFilterId
        ? { metadata: { contains: customerFilterId } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const fmt = (n: number, c: string = merchant?.currency || 'GHS') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const totalRevenue = payments
    .filter((p) => p.status === 'COMPLETED')
    .reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-sm text-muted-foreground">
            {customerFilterId
              ? 'Payments filtered for the selected customer.'
              : 'Track all incoming payments to your merchant account.'}
          </p>
        </div>
        <CreatePaymentDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total volume
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {fmt(totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payments
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {payments.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Completed
            </span>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {payments.filter((p) => p.status === 'COMPLETED').length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {customerFilterId ? 'Customer payments' : 'All payments'}
          </CardTitle>
          <CardDescription>
            {payments.length} payment{payments.length === 1 ? '' : 's'} recorded
            {customerFilterId && (
              <>
                {' '}—{' '}
                <Link
                  href="/dashboard/payments"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  clear filter
                </Link>
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CreditCard className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm font-medium">No payments yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click <span className="font-medium text-foreground">New Payment</span> above to
                create your first payment.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/payments/${encodeURIComponent(p.id)}`}
                        className="hover:text-emerald-600 hover:underline dark:hover:text-emerald-400"
                      >
                        {p.reference || p.id.slice(0, 12)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {fmt(p.amount, p.currency)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.method || '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtDate(p.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/dashboard/payments/${encodeURIComponent(p.id)}`}
                        className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2.5 text-xs font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                        aria-label={`View payment ${p.reference || p.id.slice(0, 12)}`}
                      >
                        View
                        <ExternalLink className="h-3 w-3" />
                      </Link>
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
