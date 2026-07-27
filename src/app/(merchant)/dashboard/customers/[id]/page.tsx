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
import { PageBreadcrumbs } from '@/components/breadcrumbs';
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
  Crown,
  Repeat,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { CreateInvoiceDialog } from '@/components/merchant/create-invoice-dialog';
import { CreatePaymentDialog } from '@/components/merchant/create-payment-dialog';
import { CustomerNotes } from '@/components/merchant/customer-notes';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

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

  // ── AML risk scan ─────────────────────────────────────────────────
  // Look for OPEN AML alerts that reference this customer record, its
  // email, or any of its payments. This powers the risk badge.
  const amlEntityIds = [customer.id, customer.email, ...paymentIds].filter(
    Boolean,
  );
  const amlAlerts = amlEntityIds.length
    ? await db.aMLAlert.findMany({
        where: {
          environment: env,
          status: 'OPEN',
          entityId: { in: amlEntityIds },
        },
        select: {
          id: true,
          alertType: true,
          severity: true,
          score: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
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
  const hasPendingRefund = refunds.some(
    (r) => r.status.toUpperCase() === 'PENDING',
  );

  // ── Customer tags ─────────────────────────────────────────────────
  const isVip = customer.totalSpent > 500;
  const isFrequent = customer.transactionCount > 5;
  const isAtRisk = hasPendingRefund;
  const tags: { label: string; icon: typeof Crown; tone: string }[] = [];
  if (isVip) {
    tags.push({
      label: 'VIP',
      icon: Crown,
      tone:
        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    });
  }
  if (isFrequent) {
    tags.push({
      label: 'Frequent',
      icon: Repeat,
      tone:
        'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
    });
  }
  if (isAtRisk) {
    tags.push({
      label: 'At Risk',
      icon: ShieldAlert,
      tone:
        'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    });
  }

  // ── Lifetime value monthly series (last 6 months) ─────────────────
  const months: { key: string; label: string; total: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      total: 0,
    });
  }
  const monthMap = new Map(months.map((m) => [m.key, m]));
  for (const p of completedPayments) {
    const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`;
    const m = monthMap.get(key);
    if (m) m.total += p.amount;
  }
  const maxMonthly = Math.max(...months.map((m) => m.total), 1);

  // ── Parse existing notes from metadata ────────────────────────────
  let notesText = '';
  let notesUpdatedAt: string | null = null;
  if (customer.metadata) {
    try {
      const parsed = JSON.parse(customer.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const m = parsed as Record<string, unknown>;
        if (typeof m.notes === 'string') notesText = m.notes;
        if (typeof m.notesUpdatedAt === 'string')
          notesUpdatedAt = m.notesUpdatedAt;
      }
    } catch {
      // ignore malformed metadata
    }
  }

  return (
    <div className="space-y-6">
      {/* ───────── Breadcrumbs ───────── */}
      <PageBreadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Customers', href: '/dashboard/customers' },
          { label: customer.name },
        ]}
      />

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
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold tracking-tight break-words">
                      {customer.name}
                    </h1>
                    {/* Customer tags */}
                    {tags.map((t) => {
                      const Icon = t.icon;
                      return (
                        <span
                          key={t.label}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${t.tone}`}
                        >
                          <Icon className="h-3 w-3" />
                          {t.label}
                        </span>
                      );
                    })}
                    {/* AML risk badge */}
                    {amlAlerts.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        <ShieldAlert className="h-3 w-3" />
                        {amlAlerts.length} AML alert
                        {amlAlerts.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
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

      {/* ───────── AML risk banner (only when alerts exist) ───────── */}
      {amlAlerts.length > 0 && (
        <Card className="border-rose-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-rose-600 dark:text-rose-400">
              <ShieldAlert className="h-4 w-4" />
              Compliance risk detected
            </CardTitle>
            <CardDescription>
              {amlAlerts.length} open AML alert
              {amlAlerts.length === 1 ? '' : 's'} reference this customer.
              Review before processing further transactions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {amlAlerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2"
                >
                  <Badge className="border-transparent bg-rose-500/15 text-[10px] font-medium text-rose-600 hover:bg-rose-500/15 dark:text-rose-400">
                    {a.severity}
                  </Badge>
                  <span className="text-xs font-medium">{a.alertType}</span>
                  <span className="text-[10px] text-muted-foreground">
                    score {a.score.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ───────── Lifetime value chart ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Lifetime value
          </CardTitle>
          <CardDescription>
            Monthly completed payment volume over the last 6 months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lifetimeValue === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium">No completed payments yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Once this customer has completed payments, their monthly value
                will appear here.
              </p>
            </div>
          ) : (
            <div className="flex h-44 items-end gap-3 sm:gap-4">
              {months.map((m) => {
                const heightPct = (m.total / maxMonthly) * 100;
                return (
                  <div
                    key={m.key}
                    className="group flex flex-1 flex-col items-center gap-2"
                    title={`${m.label}: ${fmt(m.total)}`}
                  >
                    <div className="flex w-full flex-1 items-end">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-teal-400 transition-all group-hover:from-emerald-600 group-hover:to-teal-500"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                      />
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-medium tabular-nums text-muted-foreground">
                        {m.total > 0 ? fmt(m.total) : '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {m.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

        {/* Right column: notes + wallet + refunds + activity */}
        <div className="space-y-6">
          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-emerald-500" />
                Notes
              </CardTitle>
              <CardDescription>
                Keep private context on this customer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CustomerNotes
                customerId={customer.id}
                initialNotes={notesText}
                initialUpdatedAt={notesUpdatedAt}
              />
            </CardContent>
          </Card>

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
              <Link href="/dashboard/disputes">
                <ShieldAlert className="h-4 w-4" />
                Disputes
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
