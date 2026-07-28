'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  Loader2,
  X,
  CreditCard,
  ArrowDownToLine,
  Building2,
  Users,
  ArrowRight,
  Receipt,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { StatusBadge } from '@/components/status-badge';
import { fmtCurrency, fmtDate } from '@/components/role-ui';

type ResultType = 'PAYMENT' | 'PAYOUT' | 'MERCHANT' | 'CUSTOMER' | 'INVOICE';

interface SearchResult {
  id: string;
  type: ResultType;
  label: string;
  subtitle: string;
  status: string;
  amount?: number;
  currency?: string;
  createdAt: string;
  url: string;
}

interface SearchResponse {
  query: string;
  payments: SearchResult[];
  payouts: SearchResult[];
  merchants: SearchResult[];
  customers: SearchResult[];
  invoices?: SearchResult[];
  total: number;
}

const TYPE_META: Record<
  ResultType,
  { label: string; icon: typeof CreditCard; tone: string }
> = {
  PAYMENT: {
    label: 'Payments',
    icon: CreditCard,
    tone: 'text-emerald-600 dark:text-emerald-400',
  },
  PAYOUT: {
    label: 'Payouts',
    icon: ArrowDownToLine,
    tone: 'text-teal-600 dark:text-teal-400',
  },
  MERCHANT: {
    label: 'Merchants',
    icon: Building2,
    tone: 'text-cyan-600 dark:text-cyan-400',
  },
  CUSTOMER: {
    label: 'Customers',
    icon: Users,
    tone: 'text-violet-600 dark:text-violet-400',
  },
  INVOICE: {
    label: 'Invoices',
    icon: Receipt,
    tone: 'text-amber-600 dark:text-amber-400',
  },
};

/**
 * QuickSearch — the support home page's quick search bar.
 *
 * Calls GET /api/support/search?q=<term> with a 300ms debounce and shows a
 * dropdown of the top results grouped by record type (Payments, Payouts,
 * Merchants, Customers). Clicking a result navigates to that record's
 * detail page. Pressing Enter (or clicking the "Search" button) opens the
 * full /support/search page with the current query.
 *
 * Replaces the previous no-op placeholder.
 */
export function QuickSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  // Trigger: query length ≥ 2 → debounced API call.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setLoading(false);
      setResults(null);
      setError(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/support/search?q=${encodeURIComponent(trimmed)}`,
        );
        const data = (await res.json()) as SearchResponse & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            data?.error || `Search failed (${res.status})`,
          );
        }
        setResults(data);
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults(null);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const groups = useMemo<
    Array<{ type: ResultType; items: SearchResult[] }>
  >(() => {
    if (!results) return [];
    return [
      { type: 'PAYMENT', items: results.payments },
      { type: 'PAYOUT', items: results.payouts },
      { type: 'MERCHANT', items: results.merchants },
      { type: 'CUSTOMER', items: results.customers },
    ].filter((g) => g.items.length > 0);
  }, [results]);

  const hasQuery = query.trim().length >= 2;
  const showEmpty =
    hasQuery && !loading && !error && results && results.total === 0;

  function gotoFullSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/support/search?q=${encodeURIComponent(trimmed)}`);
  }

  function handleSelect(url: string) {
    setOpen(false);
    setQuery('');
    setResults(null);
    router.push(url);
  }

  return (
    <form onSubmit={gotoFullSearch} className="flex flex-col gap-3 sm:flex-row">
      <div ref={triggerRef} className="relative flex-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by email, payment reference, merchant name, or transaction ID…"
                className="h-10 pl-9 pr-9"
                aria-label="Quick search"
                autoComplete="off"
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {!loading && query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setResults(null);
                    setOpen(false);
                  }}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="w-[--radix-popover-trigger-width] min-w-[320px] p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="max-h-96 overflow-y-auto">
              {error && (
                <div className="p-3 text-xs text-rose-600 dark:text-rose-400">
                  {error}
                </div>
              )}
              {showEmpty && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Search className="h-5 w-5 text-muted-foreground" />
                  <p className="mt-2 text-xs font-medium">No results</p>
                  <p className="text-[10px] text-muted-foreground">
                    No records matched &ldquo;{results?.query}&rdquo;.
                  </p>
                </div>
              )}
              {groups.map(({ type, items }) => {
                const meta = TYPE_META[type];
                const Icon = meta.icon;
                return (
                  <div key={type} className="border-b last:border-0">
                    <div className="flex items-center gap-1.5 bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Icon className={`h-3 w-3 ${meta.tone}`} />
                      {meta.label}
                      <span className="ml-auto rounded bg-muted px-1.5 text-[9px] tabular-nums">
                        {items.length}
                      </span>
                    </div>
                    <ul role="listbox" aria-label={meta.label}>
                      {items.slice(0, 5).map((item) => (
                        <li key={`${item.type}-${item.id}`}>
                          <button
                            type="button"
                            onClick={() => handleSelect(item.url)}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-emerald-500/5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">
                                  {item.label}
                                </span>
                                <StatusBadge status={item.status} />
                              </div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {item.subtitle}
                              </div>
                              <div className="font-mono text-[9px] text-muted-foreground">
                                {item.id}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground">
                              {typeof item.amount === 'number' && (
                                <span className="font-semibold tabular-nums text-foreground">
                                  {fmtCurrency(
                                    item.amount,
                                    item.currency || 'USD',
                                  )}
                                </span>
                              )}
                              <span>{fmtDate(new Date(item.createdAt))}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {results && results.total > 0 && (
                <Link
                  href={`/support/search?q=${encodeURIComponent(results.query)}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-1.5 bg-muted/30 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                >
                  View all {results.total} result
                  {results.total === 1 ? '' : 's'} on the full search page
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <Button
        type="submit"
        disabled={loading || !query.trim()}
        className="h-10 bg-emerald-600 text-white hover:bg-emerald-700"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
      </Button>
    </form>
  );
}
