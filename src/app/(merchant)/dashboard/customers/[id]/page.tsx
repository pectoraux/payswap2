import { redirect } from 'next/navigation';
import Link from 'next/link';
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  ArrowLeft,
  Users,
  CreditCard,
  RotateCcw,
  Wallet as WalletIcon,
  Mail,
  Phone,
  Globe,
  Receipt,
  Plus,
  ArrowDownToLine,
  History,
  Inbox,
} from 'lucide-react';
import { CreateInvoiceDialog } from '@/components/merchant/create-invoice-dialog';
import { CreatePaymentDialog } from '@/components/merchant/create-payment-dialog';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchantId, merchant } = ctx;

  const env = await getEnvironment();
  const { id } = await params;

  const customer = await db.customerRecord.findUnique({
    where: { id },
  });

  if (!customer) redirect('/dashboard/customers');
  if (customer.merchantId !== merchantId) redirect('/unauthorized');
  if (customer.environment !== env) redirect('/unauthorized');

  // Find payments for this customer. The create-payment flow stores the
  // customerRecordId in the payment metadata JSON string; if the record is
  // linked to a Customer row we also match on Payment.customerId.
  const payments = await db.payment.findMany({
    where: {
      merchantId,
      environment: env,
      OR: [
        { metadata: { contains: customer.id } },
        ...(customer.customerId
          ? [{ customerId: customer.customerId }]
          : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { refunds: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });

  // Refunds across this customer's payments.
  const paymentIds = payments.map((p) => p.id);
  const refunds = paymentIds.length
    ? await db.refund.findMany({
        where: { paymentId: { in: paymentIds }, environment: env },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { payment: { select: { reference: true, currency: true } } },
      })
    : [];

  // Wallet: if the CustomerRecord is linked to a Customer with an Account,
  // surface the account's wallets. Most merchant-side records won't have one,
  // in which case we hide the section.
  let wallets: {
    id: string;
    name: string;
    currency: string;
    balance: number;
    pendingBalance: number;
    lockedBalance: number;
  }[] = [];
  if (customer.customerId) {
    try {
      const linkedCustomer = await db.customer.findUnique({
        where: { id: customer.customerId },
        select: { accountId: true },
      });
      if (linkedCustomer?.accountId) {
        wallets = await db.wallet.findMany({
          where: { accountId: linkedCustomer.accountId },
          select: {
            id: true,
            name: true,
            currency: true,
            balance: true,
            pendingBalance: true,
            lockedBalance: true,
          },
        });
      }
    } catch {
      // ignore — wallet section is optional.
    }
  }

  const fmt = (n: number, c: string = merchant.currency) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: c,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${c}`;
    }
  };
  const fmtDate = (d: Date | string | null) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(d);
    }
  };

  const completedPayments = payments.filter((p) =>
    ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'].includes(
      p.status.toUpperCase(),
    ),
  );
  const lifetimeValue = completedPayments.reduce((s, p) => s + p.amount, 0);
  const totalRefunded = refunds
    .filter((r) => ['COMPLETED', 'APPROVED'].includes(r.status.toUpperCase()))
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      {/* ───────── Breadcrumbs ───────── */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">Dashboard</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard/customers">Customers</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{customer.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/dashboard/customers">
            <ArrowLeft className="h-4 w-4" />
            Back to customers
          </Link>
        </Button>
      </div>

      {/* ───────── Header card ───────── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3 min-w-0">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Users className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl font-bold tracking-tight break-words">
                    {customer.name}
                  </h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {customer.email}
                    </span>
                    {customer.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {customer.phone}
                      </span>
                    )}
                    {customer.country && (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {customer.country}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Total spent
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmt(customer.totalSpent)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Transactions
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums">
                    {customer.transactionCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Lifetime value
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums">
                    {fmt(lifetimeValue)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Refunded
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {fmt(totalRefunded)}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-muted-foreground">
                Customer since{' '}
                <span className="font-medium text-foreground">
                  {fmtDate(customer.createdAt)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              <CreatePaymentDialog />
              <CreateInvoiceDialog />
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link
                  href={`/dashboard/payments?customer=${encodeURIComponent(customer.id)}`}
                >
                  <CreditCard className="h-4 w-4" />
                  View Payments
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ───────── Two-column section ───────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Payment history — spans 2 columns */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4 text-emerald-500" />
                  Payment history
                </CardTitle>
                <CardDescription>
                  {payments.length} payment{payments.length === 1 ? '' : 's'} from this customer.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href="/dashboard/payments">
                  <Plus className="h-3.5 w-3.5" />
                  New
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">No payments yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Payments from this customer will appear here.
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Right column: wallet + refunds + activity */}
        <div className="space-y-6">
          {/* Wallet */}
          {wallets.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <WalletIcon className="h-4 w-4 text-emerald-500" />
                  Wallet
                </CardTitle>
                <CardDescription>Customer wallet balance.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {wallets.map((w) => (
                  <div
                    key={w.id}
                    className="rounded-lg border bg-card/50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{w.name}</span>
                      <Badge variant="secondary">{w.currency}</Badge>
                    </div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {fmt(w.balance, w.currency)}
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Pending: <span className="font-medium tabular-nums">{fmt(w.pendingBalance, w.currency)}</span></span>
                      <span>Locked: <span className="font-medium tabular-nums">{fmt(w.lockedBalance, w.currency)}</span></span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Refunds */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RotateCcw className="h-4 w-4 text-emerald-500" />
                Refund history
              </CardTitle>
              <CardDescription>
                {refunds.length} refund{refunds.length === 1 ? '' : 's'} for this customer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {refunds.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <RotateCcw className="h-7 w-7 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No refunds</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Refunds for this customer will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
                  {refunds.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-lg border bg-card/50 p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
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
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground truncate">
                          {r.payment?.reference || r.paymentId.slice(0, 12)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {fmtDate(r.createdAt)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums shrink-0">
                        {fmt(r.amount, r.payment?.currency)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick activity link */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-emerald-500" />
                Activity
              </CardTitle>
              <CardDescription>
                Track this customer&apos;s events in the unified feed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm" className="w-full gap-1.5">
                <Link href="/dashboard/activity?type=payment">
                  <History className="h-4 w-4" />
                  Open activity feed
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ───────── Cross-resource navigation footer ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Related resources</CardTitle>
          <CardDescription>
            Jump to other parts of the dashboard for this customer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link
                href={`/dashboard/payments?customer=${encodeURIComponent(customer.id)}`}
              >
                <CreditCard className="h-4 w-4" />
                View payments
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/invoices">
                <Receipt className="h-4 w-4" />
                Invoices
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/refunds">
                <RotateCcw className="h-4 w-4" />
                Refunds
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/payouts">
                <ArrowDownToLine className="h-4 w-4" />
                Payouts
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/activity?type=payment">
                <History className="h-4 w-4" />
                Activity feed
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
