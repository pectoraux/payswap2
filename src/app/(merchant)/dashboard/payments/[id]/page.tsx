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
import { Separator } from '@/components/ui/separator';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import {
  ArrowLeft,
  CreditCard,
  Users,
  RotateCcw,
  Webhook,
  FileText,
  ExternalLink,
  ArrowDownToLine,
  History,
  CheckCircle2,
  Circle,
  XCircle,
  Clock,
} from 'lucide-react';
import {
  CopyPaymentIdButton,
  DownloadReceiptButton,
  CreateRefundLinkButton,
} from '@/components/merchant/payment-detail-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PaymentDetailPage({ params }: PageProps) {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

  const env = await getEnvironment();
  const { id } = await params;

  // Fetch the payment with related refunds and merchant.
  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      refunds: { orderBy: { createdAt: 'desc' }, take: 50 },
      merchant: true,
      customer: true,
    },
  });

  if (!payment) redirect('/dashboard/payments');
  if (payment.merchantId !== merchantId) redirect('/unauthorized');
  if (payment.environment !== env) redirect('/unauthorized');

  // Look up the CustomerRecord for this payment. The create-payment flow
  // stores the customerRecordId in metadata; if the payment is also linked
  // to a Customer via customerId we use that.
  let customerRecord: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    country: string | null;
  } | null = null;
  try {
    let customerRecordId: string | null = null;
    if (payment.metadata) {
      const parsed = JSON.parse(payment.metadata);
      if (typeof parsed?.customerRecordId === 'string') {
        customerRecordId = parsed.customerRecordId;
      }
    }
    if (customerRecordId) {
      customerRecord = await db.customerRecord.findUnique({
        where: { id: customerRecordId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          country: true,
        },
      });
    } else if (payment.customerId) {
      // Fall back to a CustomerRecord linked to the same Customer.
      customerRecord = await db.customerRecord.findFirst({
        where: { customerId: payment.customerId, merchantId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          country: true,
        },
      });
    }
  } catch {
    // metadata isn't valid JSON — ignore.
  }

  // Webhook deliveries for this merchant that mention this payment ID in
  // their payload. The payload column is a JSON string so we use a string
  // `contains` filter.
  const webhookDeliveries = await db.webhookDelivery.findMany({
    where: {
      endpoint: { merchantId, environment: env },
      payload: { contains: payment.id },
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { endpoint: { select: { url: true } } },
  });

  // Related payouts: we don't have a direct FK, but if there's a payout in
  // the same corridor/currency around the time of settlement we surface a
  // link to the payouts list (filtered). To keep this simple and stable,
  // we just link to /dashboard/payouts.
  const hasRelatedPayouts = true;

  const fmt = (n: number, c: string = payment.currency) => {
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

  const ref = payment.reference || payment.id.slice(0, 12);
  const statusUpper = payment.status.toUpperCase();

  // Build the timeline nodes. The order is Created → Processing → Settled
  // (or Failed/Cancelled). We compute the "current" step from the status.
  const isFailed = ['FAILED', 'DECLINED', 'REJECTED'].includes(statusUpper);
  const isCancelled = ['CANCELLED', 'CANCELED', 'EXPIRED'].includes(statusUpper);
  const isSettled =
    ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'].includes(
      statusUpper,
    ) && !!payment.settledAt;
  const isProcessing = !isFailed && !isCancelled && !isSettled;

  type Step = {
    label: string;
    state: 'done' | 'current' | 'failed' | 'cancelled' | 'upcoming';
    timestamp: string | null;
  };
  const steps: Step[] = [
    {
      label: 'Created',
      state: 'done',
      timestamp: payment.createdAt.toISOString(),
    },
    {
      label: 'Processing',
      state: isProcessing
        ? 'current'
        : isFailed
          ? 'failed'
          : isCancelled
            ? 'cancelled'
            : 'done',
      timestamp: isProcessing || isFailed || isCancelled ? null : null,
    },
    {
      label: isFailed ? 'Failed' : isCancelled ? 'Cancelled' : 'Settled',
      state: isSettled
        ? 'done'
        : isFailed
          ? 'failed'
          : isCancelled
            ? 'cancelled'
            : 'upcoming',
      timestamp: payment.settledAt?.toISOString() ?? null,
    },
  ];

  // Parse metadata + evidence for the ledger section.
  let metadataParsed: Record<string, unknown> | null = null;
  if (payment.metadata) {
    try {
      metadataParsed = JSON.parse(payment.metadata);
    } catch {
      metadataParsed = null;
    }
  }
  let evidenceParsed: Record<string, unknown> | null = null;
  if (payment.evidence) {
    try {
      evidenceParsed = JSON.parse(payment.evidence);
    } catch {
      evidenceParsed = null;
    }
  }

  const receiptPayload = {
    reference: payment.reference || payment.id.slice(0, 12),
    paymentId: payment.id,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    description: payment.description,
    createdAt: payment.createdAt.toISOString(),
    settledAt: payment.settledAt?.toISOString() ?? null,
    merchantName: merchant.name,
    merchantEmail: merchant.email,
    customerName: customerRecord?.name ?? payment.customer?.name ?? null,
    customerEmail: customerRecord?.email ?? payment.customer?.email ?? null,
  };

  return (
    <div className="space-y-6">
      {/* ───────── Breadcrumbs ───────── */}
      <PageBreadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Payments', href: '/dashboard/payments' },
          { label: ref },
        ]}
      />

      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/dashboard/payments">
            <ArrowLeft className="h-4 w-4" />
            Back to payments
          </Link>
        </Button>
      </div>

      {/* ───────── Header card ───────── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold tracking-tight font-mono break-all">
                      {ref}
                    </h1>
                    <StatusBadge status={payment.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {payment.description || 'No description provided.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Amount
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums">
                    {fmt(Number(payment.amount))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Fee
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-muted-foreground">
                    {fmt(Number(payment.fee))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Net
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmt(Number(payment.netAmount))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Method
                  </div>
                  <div className="mt-0.5 text-sm font-medium">
                    {payment.method || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Corridor
                  </div>
                  <div className="mt-0.5 text-sm font-medium">
                    {payment.corridor || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    FX rate
                  </div>
                  <div className="mt-0.5 text-sm font-medium tabular-nums">
                    {payment.fxRate.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Created
                  </div>
                  <div className="mt-0.5 text-xs font-medium">
                    {fmtDate(payment.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Settled
                  </div>
                  <div className="mt-0.5 text-xs font-medium">
                    {fmtDate(payment.settledAt)}
                  </div>
                </div>
                {payment.txHash && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Tx hash
                    </div>
                    <div className="mt-0.5 truncate text-xs font-mono text-muted-foreground">
                      {payment.txHash}
                    </div>
                  </div>
                )}
              </div>

              {payment.failureReason && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  <span className="font-semibold">Failure reason: </span>
                  {payment.failureReason}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <CreateRefundLinkButton paymentId={payment.id} />
                <DownloadReceiptButton payment={receiptPayload} />
                <CopyPaymentIdButton paymentId={payment.id} />
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {customerRecord && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(customerRecord.id)}`}
                    >
                      <Users className="h-4 w-4" />
                      View Customer
                    </Link>
                  </Button>
                )}
                {hasRelatedPayouts && (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    <Link href="/dashboard/payouts">
                      <ArrowDownToLine className="h-4 w-4" />
                      View Payouts
                    </Link>
                  </Button>
                )}
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                >
                  <Link
                    href={`/dashboard/activity?type=payment`}
                  >
                    <History className="h-4 w-4" />
                    View in Activity
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ───────── Timeline ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-emerald-500" />
            Payment timeline
          </CardTitle>
          <CardDescription>
            Lifecycle status from creation to settlement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:gap-0">
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1;
              const Icon =
                step.state === 'done'
                  ? CheckCircle2
                  : step.state === 'failed' || step.state === 'cancelled'
                    ? XCircle
                    : step.state === 'current'
                      ? Clock
                      : Circle;
              const iconColor =
                step.state === 'done'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : step.state === 'failed'
                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    : step.state === 'cancelled'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : step.state === 'current'
                        ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400'
                        : 'bg-muted text-muted-foreground';
              return (
                <li
                  key={step.label}
                  className="relative flex flex-1 items-start gap-3 pb-4 sm:pb-0 sm:flex-col sm:items-start"
                >
                  <div className="flex items-center gap-3 w-full sm:flex-col sm:items-start sm:gap-2">
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconColor}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      {!isLast && (
                        <span
                          aria-hidden
                          className="hidden sm:block h-px w-full bg-border min-w-[3rem] flex-1"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 sm:mt-1">
                      <div className="text-sm font-medium">{step.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {step.timestamp
                          ? fmtDate(step.timestamp)
                          : step.state === 'current'
                            ? 'In progress'
                            : step.state === 'upcoming'
                              ? 'Pending'
                              : step.state === 'failed'
                                ? 'Failed'
                                : step.state === 'cancelled'
                                  ? 'Cancelled'
                                  : '—'}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {/* ───────── Two-column section ───────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Customer section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-emerald-500" />
              Customer
            </CardTitle>
            <CardDescription>
              The customer who initiated this payment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {customerRecord ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {customerRecord.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {customerRecord.email}
                    </div>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                  >
                    <Link
                      href={`/dashboard/customers/${encodeURIComponent(customerRecord.id)}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open
                    </Link>
                  </Button>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Phone
                    </div>
                    <div className="mt-0.5 font-medium">
                      {customerRecord.phone || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Country
                    </div>
                    <div className="mt-0.5 font-medium">
                      {customerRecord.country || '—'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Users className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">No customer linked</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This payment was created without a customer record.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Refunds section */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RotateCcw className="h-4 w-4 text-emerald-500" />
                  Refunds
                </CardTitle>
                <CardDescription>
                  Refunds issued against this payment.
                </CardDescription>
              </div>
              <CreateRefundLinkButton paymentId={payment.id} />
            </div>
          </CardHeader>
          <CardContent>
            {payment.refunds.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <RotateCcw className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">No refunds yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click <span className="font-medium text-foreground">Create Refund</span> to issue one.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
                {payment.refunds.map((r) => (
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
                      <div className="mt-1 text-xs text-muted-foreground truncate">
                        {r.reason || 'No reason provided'}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {fmtDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums shrink-0">
                      {fmt(Number(r.amount))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook deliveries section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="h-4 w-4 text-emerald-500" />
              Webhook deliveries
            </CardTitle>
            <CardDescription>
              Notifications sent for this payment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {webhookDeliveries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Webhook className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">No deliveries</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Configure a webhook endpoint to receive payment events.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
                {webhookDeliveries.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-card/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {d.eventType}
                        </span>
                        <StatusBadge
                          status={
                            d.responseStatus != null
                              ? `HTTP ${d.responseStatus}`
                              : d.status
                          }
                        />
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        → {d.endpoint?.url || 'unknown endpoint'}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {fmtDate(d.createdAt)} · {d.attempts} attempt
                        {d.attempts === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ledger / metadata section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-emerald-500" />
              Ledger &amp; metadata
            </CardTitle>
            <CardDescription>
              Raw evidence and metadata for this payment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metadataParsed || evidenceParsed ? (
              <div className="space-y-4">
                {metadataParsed && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                      Metadata
                    </div>
                    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed font-mono max-h-48 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
{JSON.stringify(metadataParsed, null, 2)}
                    </pre>
                  </div>
                )}
                {evidenceParsed && (
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                      Evidence
                    </div>
                    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed font-mono max-h-48 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
{JSON.stringify(evidenceParsed, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">No metadata recorded</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Evidence and metadata will appear here when available.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ───────── Cross-resource navigation footer ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Related resources</CardTitle>
          <CardDescription>
            Jump to other parts of the dashboard linked to this payment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/payments">
                <CreditCard className="h-4 w-4" />
                All payments
              </Link>
            </Button>
            {customerRecord && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link
                  href={`/dashboard/customers/${encodeURIComponent(customerRecord.id)}`}
                >
                  <Users className="h-4 w-4" />
                  Customer detail
                </Link>
              </Button>
            )}
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
