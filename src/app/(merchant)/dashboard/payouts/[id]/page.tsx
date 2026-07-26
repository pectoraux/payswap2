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
import { StatusBadge } from '@/components/status-badge';
import { Separator } from '@/components/ui/separator';
import { PageBreadcrumbs } from '@/components/breadcrumbs';
import {
  ArrowLeft,
  ArrowDownToLine,
  Building2,
  Smartphone,
  Link2,
  History,
  Store,
  FileText,
  CheckCircle2,
  Circle,
  XCircle,
  Clock,
} from 'lucide-react';
import { CancelPayoutButton } from '@/components/merchant/payout-detail-actions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PayoutDetailPage({ params }: PageProps) {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchantId, merchant } = ctx;

  const env = await getEnvironment();
  const { id } = await params;

  const payout = await db.payout.findUnique({
    where: { id },
    include: { merchant: true },
  });

  if (!payout) redirect('/dashboard/payouts');
  if (payout.merchantId !== merchantId) redirect('/unauthorized');
  if (payout.environment !== env) redirect('/unauthorized');

  const fmt = (n: number, c: string) => {
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

  const statusUpper = payout.status.toUpperCase();
  const cancellable = ['REQUESTED', 'REVIEWING', 'PENDING'].includes(statusUpper);

  const isCompleted = ['COMPLETED', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID'].includes(statusUpper);
  const isFailed = ['FAILED', 'REJECTED', 'DECLINED'].includes(statusUpper);
  const isCancelled = ['CANCELLED', 'CANCELED'].includes(statusUpper);
  const isProcessing = !isCompleted && !isFailed && !isCancelled;

  type Step = {
    label: string;
    state: 'done' | 'current' | 'failed' | 'cancelled' | 'upcoming';
    timestamp: string | null;
  };
  const steps: Step[] = [
    {
      label: 'Requested',
      state: 'done',
      timestamp: payout.createdAt.toISOString(),
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
      timestamp: payout.processedAt?.toISOString() ?? null,
    },
    {
      label: isFailed ? 'Failed' : isCancelled ? 'Cancelled' : 'Completed',
      state: isCompleted
        ? 'done'
        : isFailed
          ? 'failed'
          : isCancelled
            ? 'cancelled'
            : 'upcoming',
      timestamp: payout.completedAt?.toISOString() ?? null,
    },
  ];

  // Method-specific destination icon
  const DestinationIcon =
    payout.method === 'bank'
      ? Building2
      : payout.method === 'mobile_money'
        ? Smartphone
        : Link2;
  const destinationLabel =
    payout.method === 'bank'
      ? 'Bank account'
      : payout.method === 'mobile_money'
        ? 'Mobile money number'
        : payout.method === 'onchain'
          ? 'On-chain address'
          : 'Destination';

  // Parse evidence if present.
  let evidenceParsed: Record<string, unknown> | null = null;
  if (payout.evidence) {
    try {
      evidenceParsed = JSON.parse(payout.evidence);
    } catch {
      evidenceParsed = null;
    }
  }

  return (
    <div className="space-y-6">
      {/* ───────── Breadcrumbs ───────── */}
      <PageBreadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Payouts', href: '/dashboard/payouts' },
          { label: payout.id.slice(0, 12) },
        ]}
      />

      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link href="/dashboard/payouts">
            <ArrowLeft className="h-4 w-4" />
            Back to payouts
          </Link>
        </Button>
      </div>

      {/* ───────── Header card ───────── */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3 min-w-0">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                  <ArrowDownToLine className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold tracking-tight font-mono break-all">
                      {payout.id.slice(0, 16)}
                    </h1>
                    <StatusBadge status={payout.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {payout.reason || 'Payout request'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Source amount
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums">
                    {fmt(payout.sourceAmount, payout.sourceCurrency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Fee ({payout.feeBps} bps)
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-muted-foreground">
                    {fmt(payout.fee, payout.sourceCurrency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Net amount
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmt(payout.netAmount, payout.destinationCurrency)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Method
                  </div>
                  <div className="mt-0.5 text-sm font-medium">{payout.method}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    FX rate
                  </div>
                  <div className="mt-0.5 text-sm font-medium tabular-nums">
                    {payout.fxRate.toFixed(4)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Destination currency
                  </div>
                  <div className="mt-0.5 text-sm font-medium">
                    {payout.destinationCurrency}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Created
                  </div>
                  <div className="mt-0.5 text-xs font-medium">
                    {fmtDate(payout.createdAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Processed
                  </div>
                  <div className="mt-0.5 text-xs font-medium">
                    {fmtDate(payout.processedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Completed
                  </div>
                  <div className="mt-0.5 text-xs font-medium">
                    {fmtDate(payout.completedAt)}
                  </div>
                </div>
              </div>

              {payout.failureReason && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                  <span className="font-semibold">Failure reason: </span>
                  {payout.failureReason}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              {cancellable && <CancelPayoutButton payoutId={payout.id} />}
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href="/dashboard/activity?type=payout">
                  <History className="h-4 w-4" />
                  View in Activity
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href="/dashboard/settings">
                  <Store className="h-4 w-4" />
                  View Merchant
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ───────── Timeline ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-teal-500" />
            Payout timeline
          </CardTitle>
          <CardDescription>
            Lifecycle status from request to completion.
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

      {/* ───────── Destination + Evidence ───────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Destination details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DestinationIcon className="h-4 w-4 text-teal-500" />
              Destination details
            </CardTitle>
            <CardDescription>
              Where the funds are being sent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-card/50 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {destinationLabel}
              </div>
              <div className="mt-1 break-all font-mono text-sm font-medium">
                {payout.destination || '—'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Source asset
                </div>
                <div className="mt-0.5 font-medium">
                  {payout.sourceAsset || '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Source currency
                </div>
                <div className="mt-0.5 font-medium">
                  {payout.sourceCurrency}
                </div>
              </div>
            </div>
            {payout.txHash && (
              <>
                <Separator />
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Transaction hash
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {payout.txHash}
                  </div>
                </div>
              </>
            )}
            {payout.approvedBy && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Approved by
                    </div>
                    <div className="mt-0.5 font-medium">{payout.approvedBy}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Approved at
                    </div>
                    <div className="mt-0.5 font-medium">
                      {fmtDate(payout.approvedAt)}
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Evidence */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-teal-500" />
              Evidence
            </CardTitle>
            <CardDescription>
              Settlement evidence and supporting metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {evidenceParsed ? (
              <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed font-mono max-h-72 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent">
{JSON.stringify(evidenceParsed, null, 2)}
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileText className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium">No evidence recorded</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Settlement evidence will appear here once the payout is processed.
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
            Jump to other parts of the dashboard linked to this payout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/payouts">
                <ArrowDownToLine className="h-4 w-4" />
                All payouts
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/activity?type=payout">
                <History className="h-4 w-4" />
                View in activity
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/dashboard/settings">
                <Store className="h-4 w-4" />
                View merchant
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
