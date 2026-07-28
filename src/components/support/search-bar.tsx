'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { fmtDate, fmtCurrency } from '@/components/role-ui';

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
  invoices: SearchResult[];
  total: number;
}

const TYPE_LABELS: Record<ResultType, string> = {
  PAYMENT: 'Payments',
  PAYOUT: 'Payouts',
  MERCHANT: 'Merchants',
  CUSTOMER: 'Customers',
  INVOICE: 'Invoices',
};

const TYPE_TONES: Record<ResultType, string> = {
  PAYMENT: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  PAYOUT: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  MERCHANT: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  CUSTOMER: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  INVOICE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
};

/**
 * Debounced search input that hits GET /api/support/search?q=<term> and
 * renders the results grouped by type (Payments, Payouts, Merchants,
 * Customers). Used on the support search page.
 *
 * Pass `initialQuery` to seed the input (e.g. from a `?q=…` URL param) so
 * deep-linking from the QuickSearch dropdown works.
 */
export function SearchBar({ initialQuery = '' }: { initialQuery?: string } = {}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setLoading(false);
      setResults(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/support/search?q=${encodeURIComponent(trimmed)}`,
        );
        const data = (await res.json()) as SearchResponse;
        if (!res.ok) {
          throw new Error(
            (data as any)?.error || `Search failed (${res.status})`,
          );
        }
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const groups: Array<{ type: ResultType; items: SearchResult[] }> = results
    ? (() => {
        const all: Array<{ type: ResultType; items: SearchResult[] }> = [
          { type: 'PAYMENT', items: results.payments },
          { type: 'PAYOUT', items: results.payouts },
          { type: 'MERCHANT', items: results.merchants },
          { type: 'CUSTOMER', items: results.customers },
          { type: 'INVOICE', items: results.invoices ?? [] },
        ];
        return all.filter((g) => g.items.length > 0);
      })()
    : [];

  const hasQuery = query.trim().length >= 2;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by id, reference, email, phone, name, destination…"
          className="h-11 pl-9 pr-9"
          aria-label="Global support search"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!loading && query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </CardContent>
        </Card>
      )}

      {hasQuery && !loading && results && results.total === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No results</p>
            <p className="text-xs text-muted-foreground">
              No payments, payouts, merchants or customers matched
              “{results.query}”.
            </p>
          </CardContent>
        </Card>
      )}

      {hasQuery && results && results.total > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {results.total} result{results.total === 1 ? '' : 's'} for
            </span>
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              “{results.query}”
            </Badge>
          </div>

          {groups.map(({ type, items }) => {
            if (items.length === 0) return null;
            return (
              <Card key={type}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      {TYPE_LABELS[type]}
                    </CardTitle>
                    <Badge className={TYPE_TONES[type]} variant="secondary">
                      {items.length}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {items.length} match{items.length === 1 ? '' : 'es'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                    {items.map((item) => (
                      <a
                        key={`${item.type}-${item.id}`}
                        href={item.url}
                        className="flex flex-col gap-1 rounded-md border bg-card/40 px-3 py-2 transition-colors hover:bg-emerald-500/5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {item.label}
                            </span>
                            <StatusBadge status={item.status} />
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {item.subtitle}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {item.id}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                          {typeof item.amount === 'number' && (
                            <div className="text-sm font-semibold tabular-nums">
                              {fmtCurrency(item.amount, item.currency || 'USD')}
                            </div>
                          )}
                          <div className="text-[10px] text-muted-foreground">
                            {fmtDate(new Date(item.createdAt))}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!hasQuery && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Start typing to search</p>
            <p className="text-xs text-muted-foreground">
              Search across payments, payouts, merchants and customers. Minimum
              2 characters.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
