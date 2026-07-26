'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  CreditCard,
  RefreshCcw,
  Webhook,
  History,
  Inbox,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types — kept in sync with the /api/activity route contract.
// ─────────────────────────────────────────────────────────────────────────────

type ActivityType = 'payment' | 'payout' | 'refund' | 'webhook' | 'audit';
type ActivityFilter = ActivityType | 'all';

interface ActivityItem {
  id: string;
  type: ActivityType;
  description: string;
  amount: number | null;
  currency: string | null;
  amountFormatted: string | null;
  status: string;
  createdAt: string;
  merchantName: string | null;
  reference?: string | null;
}

interface ActivityResponse {
  items: ActivityItem[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
  filter: ActivityFilter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-type visual config: icon, accent color, and the left-border class used
// to color-code each card.
// ─────────────────────────────────────────────────────────────────────────────

interface TypeConfig {
  icon: LucideIcon;
  /** Left-border color (color-coded by type as per the spec). */
  border: string;
  /** Icon wrapper background + text color. */
  iconWrap: string;
  label: string;
}

const TYPE_CONFIG: Record<ActivityType, TypeConfig> = {
  payment: {
    icon: CreditCard,
    border: 'border-l-emerald-500',
    iconWrap:
      'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    label: 'Payment',
  },
  payout: {
    icon: ArrowDownToLine,
    border: 'border-l-teal-500',
    iconWrap: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    label: 'Payout',
  },
  refund: {
    icon: RefreshCcw,
    border: 'border-l-amber-500',
    iconWrap: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    label: 'Refund',
  },
  webhook: {
    icon: Webhook,
    border: 'border-l-violet-500',
    iconWrap: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    label: 'Webhook',
  },
  audit: {
    icon: History,
    border: 'border-l-sky-500',
    iconWrap: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    label: 'Audit',
  },
};

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'payment', label: 'Payments' },
  { value: 'payout', label: 'Payouts' },
  { value: 'refund', label: 'Refunds' },
  { value: 'webhook', label: 'Webhooks' },
  { value: 'audit', label: 'Audit' },
];

const REFRESH_INTERVAL_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Small status pill — color-mapped from the status string (success / warn /
// fail / neutral). Kept inline so the component is fully self-contained.
// ─────────────────────────────────────────────────────────────────────────────

const SUCCESS_SET = new Set([
  'COMPLETED',
  'ACTIVE',
  'APPROVED',
  'PAID',
  'SUCCEEDED',
  'DELIVERED',
  'SUCCESS',
  'OK',
  'LIVE',
  'SETTLED',
  'VERIFIED',
]);
const WARN_SET = new Set([
  'PENDING',
  'REQUESTED',
  'DRAFT',
  'PROCESSING',
  'SENT',
  'RETRY',
  'RETRYING',
  'QUEUED',
]);
const FAIL_SET = new Set([
  'FAILED',
  'REJECTED',
  'CANCELED',
  'CANCELLED',
  'EXPIRED',
  'REVOKED',
  'DECLINED',
  'ERROR',
  'BLOCKED',
]);

function statusClass(status: string): string {
  const s = (status || '').toUpperCase();
  if (SUCCESS_SET.has(s)) {
    return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  }
  if (WARN_SET.has(s)) {
    return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  }
  if (FAIL_SET.has(s)) {
    return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  }
  return 'bg-muted text-muted-foreground';
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivityFeedProps {
  /** Page size to fetch per page (default 25). */
  pageSize?: number;
  /** Whether to render the filter chips row (default true). */
  showFilters?: boolean;
  /**
   * Layout variant:
   *  - "scrollable" (default): fixed-height, scrollable list — for sidebars
   *    and dashboard cards.
   *  - "page": natural height, no internal scroll — for a dedicated page.
   */
  variant?: 'scrollable' | 'page';
  /** Optional className applied to the outer wrapper. */
  className?: string;
  /** Optional empty-state message override. */
  emptyMessage?: string;
}

export function ActivityFeed({
  pageSize = 25,
  showFilters = true,
  variant = 'scrollable',
  className,
  emptyMessage = 'No activity yet',
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Abort in-flight requests when a new one starts (filter change, refresh).
  const abortRef = useRef<AbortController | null>(null);

  const buildUrl = useCallback(
    (opts: { limit: number; offset: number; type: ActivityFilter }) => {
      const params = new URLSearchParams({
        limit: String(opts.limit),
        offset: String(opts.offset),
        type: opts.type,
      });
      return `/api/activity?${params.toString()}`;
    },
    [],
  );

  // Initial load + filter change → full replace.
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    fetch(buildUrl({ limit: pageSize, offset: 0, type: filter }), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load activity (${res.status})`);
        }
        const data = (await res.json()) as ActivityResponse;
        setItems(data.items);
        setHasMore(data.hasMore);
        setOffset(data.offset + data.items.length);
      })
      .catch((err: unknown) => {
        // AbortError is expected on filter changes / unmount.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof Error ? err.message : 'Failed to load activity',
        );
        setItems([]);
        setHasMore(false);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => ctrl.abort();
  }, [filter, pageSize, buildUrl]);

  // Auto-refresh every 30s. Replaces the first page only (preserves any
  // "load more" history the user has accumulated by appending below).
  useEffect(() => {
    const id = window.setInterval(async () => {
      // Don't run a background refresh while an initial load is in flight.
      if (loading) return;
      try {
        setRefreshing(true);
        const res = await fetch(
          buildUrl({ limit: pageSize, offset: 0, type: filter }),
          { headers: { Accept: 'application/json' } },
        );
        if (!res.ok) return;
        const data = (await res.json()) as ActivityResponse;
        setItems((prev) => {
          // Merge: keep any items below the first page that the user already
          // loaded via "Load more", prepend fresh ones, dedupe by id.
          const freshIds = new Set(data.items.map((i) => i.id));
          const tail = prev.filter((i) => !freshIds.has(i.id));
          const merged = [...data.items, ...tail];
          return merged;
        });
        setHasMore(data.hasMore);
      } catch {
        // Silent — background refresh should never surface errors.
      } finally {
        setRefreshing(false);
      }
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [filter, pageSize, loading, buildUrl]);

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        buildUrl({ limit: pageSize, offset, type: filter }),
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error(`Failed to load more (${res.status})`);
      const data = (await res.json()) as ActivityResponse;
      // Dedupe against existing items (in case the offset shifted during
      // auto-refresh).
      setItems((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        const appended = data.items.filter((i) => !existing.has(i.id));
        return [...prev, ...appended];
      });
      setHasMore(data.hasMore);
      setOffset((o) => o + data.items.length);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load more activity',
      );
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, filter, hasMore, loadingMore, offset, pageSize]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(
        buildUrl({ limit: pageSize, offset: 0, type: filter }),
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) throw new Error(`Failed to refresh (${res.status})`);
      const data = (await res.json()) as ActivityResponse;
      setItems((prev) => {
        const freshIds = new Set(data.items.map((i) => i.id));
        const tail = prev.filter((i) => !freshIds.has(i.id));
        return [...data.items, ...tail];
      });
      setHasMore(data.hasMore);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to refresh activity',
      );
    } finally {
      setRefreshing(false);
    }
  }, [buildUrl, filter, pageSize]);

  const showEmpty = !loading && !error && items.length === 0;

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        variant === 'scrollable' && 'min-h-0',
        className,
      )}
    >
      {/* ───────── Filter row ───────── */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Activity filter"
            className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1"
          >
            {FILTERS.map((f) => {
              const active = f.value === filter;
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="activity-filter-pill"
                      className="absolute inset-0 rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/30"
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 32,
                      }}
                    />
                  )}
                  <span className="relative z-10">{f.label}</span>
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={refreshing || loading}
            aria-label="Refresh activity feed"
            className="ml-auto h-8 gap-1.5 text-xs"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ActivityIcon className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      )}

      {/* ───────── List ───────── */}
      {loading ? (
        <ActivitySkeleton />
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-300"
        >
          <p className="font-medium">Couldn’t load activity</p>
          <p className="mt-0.5 text-xs text-rose-600/80 dark:text-rose-400/80">
            {error}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            className="mt-2 h-7 gap-1.5 text-xs"
          >
            <RefreshCcw className="h-3 w-3" /> Try again
          </Button>
        </div>
      ) : showEmpty ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div
          className={cn(
            'flex flex-col gap-2',
            variant === 'scrollable' &&
              'max-h-[28rem] overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent',
          )}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item, idx) => (
              <ActivityRow
                key={item.id}
                item={item}
                index={idx}
              />
            ))}
          </AnimatePresence>

          {hasMore && (
            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="h-8 w-full gap-1.5 text-xs"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────

function ActivityRow({ item, index }: { item: ActivityItem; index: number }) {
  const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.audit;
  const Icon = cfg.icon;
  const relative = useMemo(() => {
    try {
      return formatDistanceToNowStrict(new Date(item.createdAt), {
        addSuffix: true,
      });
    } catch {
      return '';
    }
  }, [item.createdAt]);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{
        duration: 0.18,
        delay: Math.min(index * 0.015, 0.12),
      }}
      className={cn(
        'relative flex items-start gap-3 rounded-lg border border-l-4 bg-card p-3 shadow-xs transition-colors hover:bg-accent/40',
        cfg.border,
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          cfg.iconWrap,
        )}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium leading-snug">
            {item.description}
          </p>
          {item.amountFormatted && (
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {item.amountFormatted}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium uppercase tracking-wide">
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 rounded-full',
                item.type === 'payment' && 'bg-emerald-500',
                item.type === 'payout' && 'bg-teal-500',
                item.type === 'refund' && 'bg-amber-500',
                item.type === 'webhook' && 'bg-violet-500',
                item.type === 'audit' && 'bg-sky-500',
              )}
            />
            {cfg.label}
          </span>

          {item.merchantName && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{item.merchantName}</span>
            </>
          )}

          {item.reference && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate font-mono text-[10px]">
                {item.reference}
              </span>
            </>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              statusClass(item.status),
            )}
          >
            {item.status}
          </span>
          <time
            dateTime={item.createdAt}
            title={new Date(item.createdAt).toLocaleString()}
            className="text-[11px] text-muted-foreground"
          >
            {relative}
          </time>
        </div>
      </div>
    </motion.article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton / empty states
// ─────────────────────────────────────────────────────────────────────────────

function ActivitySkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg border border-l-4 border-l-muted bg-card p-3"
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between gap-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-16" />
            </div>
            <Skeleton className="h-2.5 w-1/2" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </span>
      <div>
        <p className="text-sm font-medium">{message}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          New payments, payouts, refunds, and webhook deliveries will show up
          here automatically.
        </p>
      </div>
    </div>
  );
}
