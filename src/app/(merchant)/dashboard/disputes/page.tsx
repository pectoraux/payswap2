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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { DisputeActions } from '@/components/merchant/dispute-actions';
import {
  ShieldAlert,
  Scale,
  Clock,
  CheckCircle2,
  Inbox,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ filter?: string }>;
}

/**
 * Dispute Center
 *
 * PaySwap models disputes as Refunds that need a merchant response. A
 * refund in `PENDING` is an "open dispute" the merchant must act on;
 * once the merchant Approves (→ PROCESSED) or Rejects (→ REJECTED) the
 * dispute is "resolved".
 */
export default async function DisputesPage({ searchParams }: PageProps) {
  const ctx = await requireMerchant().catch(() => null);
  if (!ctx) redirect('/unauthorized');
  const { merchant } = ctx;
  const merchantId = merchant.id;

  const env = await getEnvironment();
  const sp = await searchParams;
  const rawFilter = (sp?.filter || 'open').toLowerCase();
  const filter =
    rawFilter === 'all' || rawFilter === 'resolved' ? rawFilter : 'open';

  // Pull every refund for this merchant/env. The list is bounded by the
  // merchant's actual refund volume (typically < 1k) so we can compute
  // KPIs and the filtered table in memory.
  const refunds = await db.refund.findMany({
    where: { merchantId, environment: env },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      payment: {
        select: {
          id: true,
          reference: true,
          currency: true,
          amount: true,
          description: true,
          metadata: true,
        },
      },
    },
  });

  // Resolve a customer display name for each refund by parsing the
  // payment's metadata JSON ({ customerRecordId }) and looking up the
  // matching CustomerRecord. We batch the lookup so we only hit the DB
  // once for the whole page.
  const recordIds = new Set<string>();
  for (const r of refunds) {
    const meta = r.payment?.metadata;
    if (!meta) continue;
    try {
      const parsed = JSON.parse(meta);
      const rid =
        typeof parsed?.customerRecordId === 'string'
          ? parsed.customerRecordId
          : null;
      if (rid) recordIds.add(rid);
    } catch {
      // ignore malformed metadata
    }
  }
  const records =
    recordIds.size > 0
      ? await db.customerRecord.findMany({
          where: { id: { in: Array.from(recordIds) } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const recordMap = new Map(records.map((r) => [r.id, r]));

  function customerFor(meta: string | null | undefined): {
    name: string;
    email: string | null;
  } | null {
    if (!meta) return null;
    try {
      const parsed = JSON.parse(meta);
      const rid =
        typeof parsed?.customerRecordId === 'string'
          ? parsed.customerRecordId
          : null;
      if (rid && recordMap.has(rid)) {
        const r = recordMap.get(rid)!;
        return { name: r.name, email: r.email };
      }
    } catch {
      // ignore
    }
    return null;
  }

  // ── KPI computations ──────────────────────────────────────────────
  const isOpen = (s: string) => s.toUpperCase() === 'PENDING';
  const isResolved = (s: string) =>
    ['PROCESSED', 'REJECTED'].includes(s.toUpperCase());

  const openDisputes = refunds.filter((r) => isOpen(r.status));
  const resolvedDisputes = refunds.filter((r) => isResolved(r.status));
  // "Won" = the merchant successfully contested the dispute (REJECTED).
  const wonDisputes = refunds.filter(
    (r) => r.status.toUpperCase() === 'REJECTED',
  );

  const openAmount = openDisputes.reduce((s, r) => s + r.amount, 0);

  const winRate =
    resolvedDisputes.length > 0
      ? (wonDisputes.length / resolvedDisputes.length) * 100
      : 0;

  // Average resolution time = mean(processedAt - createdAt) across
  // resolved disputes that have a processedAt stamp.
  const resolutionMs: number[] = [];
  for (const r of resolvedDisputes) {
    if (r.processedAt) {
      resolutionMs.push(
        new Date(r.processedAt).getTime() - new Date(r.createdAt).getTime(),
      );
    }
  }
  const avgResolutionMs =
    resolutionMs.length > 0
      ? resolutionMs.reduce((a, b) => a + b, 0) / resolutionMs.length
      : 0;

  function fmtDuration(ms: number): string {
    if (ms <= 0) return '—';
    const minutes = ms / 60000;
    if (minutes < 60) return `${minutes.toFixed(0)}m`;
    const hours = minutes / 60;
    if (hours < 48) return `${hours.toFixed(1)}h`;
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }

  // ── Filtered table rows ───────────────────────────────────────────
  const rows =
    filter === 'open'
      ? openDisputes
      : filter === 'resolved'
        ? resolvedDisputes
        : refunds;

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
      return new Date(d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return String(d);
    }
  };

  const filterTabs: { key: string; label: string; count: number }[] = [
    { key: 'open', label: 'Open', count: openDisputes.length },
    { key: 'resolved', label: 'Resolved', count: resolvedDisputes.length },
    { key: 'all', label: 'All', count: refunds.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ShieldAlert className="h-6 w-6 text-emerald-500" />
          Dispute Center
        </h1>
        <p className="text-sm text-muted-foreground">
          Review and resolve customer disputes. Approve to honour a refund
          request, or reject to contest it.
        </p>
      </div>

      {/* ───────── KPI cards ───────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Open disputes
              </span>
              <ShieldAlert className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {openDisputes.length}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Awaiting your response
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Disputed amount
              </span>
              <Scale className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {fmt(openAmount)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              At stake in open disputes
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Win rate
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {winRate.toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {wonDisputes.length} won / {resolvedDisputes.length} resolved
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Avg resolution
              </span>
              <Clock className="h-4 w-4 text-teal-500" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {fmtDuration(avgResolutionMs)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Time to close a dispute
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ───────── Disputes table ───────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Disputes</CardTitle>
              <CardDescription>
                {rows.length} dispute{rows.length === 1 ? '' : 's'} in this view
              </CardDescription>
            </div>
            {/* Filter tabs */}
            <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
              {filterTabs.map((t) => {
                const active = t.key === filter;
                return (
                  <Link
                    key={t.key}
                    href={`/dashboard/disputes?filter=${t.key}`}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] tabular-nums ${
                        active
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {t.count}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
                <Inbox className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="mt-4 text-sm font-medium">
                {filter === 'open'
                  ? 'No open disputes'
                  : filter === 'resolved'
                    ? 'No resolved disputes yet'
                    : 'No disputes on record'}
              </p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {filter === 'open'
                  ? 'When a customer raises a dispute it will appear here for review.'
                  : 'Disputes you approve or reject will be listed here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment reference</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const ref = r.payment?.reference || r.paymentId.slice(0, 12);
                    const cust = customerFor(r.payment?.metadata);
                    const isOpenRow = r.status.toUpperCase() === 'PENDING';
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
                        <TableCell>
                          {cust ? (
                            <div className="min-w-0">
                              <Link
                                href={`/dashboard/payments?customer=${encodeURIComponent(cust.email || '')}`}
                                className="block truncate text-xs font-medium hover:text-emerald-600 hover:underline dark:hover:text-emerald-400"
                              >
                                {cust.name}
                              </Link>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {cust.email}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {r.payment?.description || 'Guest customer'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {fmt(r.amount, r.payment?.currency)}
                        </TableCell>
                        <TableCell className="max-w-[14rem]">
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {r.reason || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {isOpenRow ? (
                            <Badge className="border-transparent bg-amber-500/15 text-[10px] font-medium text-amber-600 hover:bg-amber-500/15 dark:text-amber-400">
                              Open
                            </Badge>
                          ) : (
                            <StatusBadge status={r.status} />
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(r.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DisputeActions
                            id={r.id}
                            status={r.status}
                            reference={ref}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
