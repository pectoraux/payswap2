'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Database, Filter, Loader2, ChevronRight, ChevronDown, RotateCcw } from 'lucide-react';

interface EventRow {
  seq: number;
  id: string;
  type: string;
  streamId: string;
  streamType: string;
  version: number;
  kind: 'domain' | 'runtime';
  timestamp: number;
  actor: string;
  environment: string;
  correlationId: string;
  intentId: string;
  payload: Record<string, unknown>;
}

interface EventsResponse {
  ok: boolean;
  events?: EventRow[];
  total?: number;
  offset?: number;
  limit?: number;
  afterSeq?: number;
  totalInStore?: number;
  types?: string[];
  error?: string;
}

const LIMIT_OPTIONS = [25, 50, 100, 250, 500];

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function kindColor(kind: EventRow['kind']): string {
  return kind === 'domain'
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : 'bg-muted text-muted-foreground';
}

function typeColor(type: string): string {
  if (type.startsWith('payment.')) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (type.startsWith('treasury.')) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  if (type.startsWith('wallet.')) return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
  if (type.startsWith('lp.')) return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
  if (type.startsWith('twin.')) return 'bg-teal-500/15 text-teal-600 dark:text-teal-400';
  if (type.startsWith('settlement.')) return 'bg-orange-500/15 text-orange-600 dark:text-orange-400';
  if (type.startsWith('refund.')) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  if (type.startsWith('bandwidth.')) return 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400';
  return 'bg-muted text-muted-foreground';
}

export function EventExplorer() {
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [aggregateFilter, setAggregateFilter] = useState<string>('');
  const [limit, setLimit] = useState<number>(100);
  const [offset, setOffset] = useState<number>(0);
  const [afterSeq, setAfterSeq] = useState<number>(0);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [replaySeq, setReplaySeq] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter);
      if (aggregateFilter) params.set('aggregateId', aggregateFilter);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      params.set('afterSeq', String(afterSeq));
      const res = await fetch(`/api/developer/inspectors/events?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as EventsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, aggregateFilter, limit, offset, afterSeq]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalInStore = data?.totalInStore ?? 0;
  const types = data?.types ?? [];

  const toggle = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  const handleReplay = (seq: number) => {
    setReplaySeq(seq);
    setTimeout(() => setReplaySeq(null), 2500);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  const summaryStats = useMemo(() => {
    const byType = new Map<string, number>();
    for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    return Array.from(byType.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [events]);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
          <CardDescription>
            Read directly from <code className="rounded bg-muted px-1 py-0.5 text-[11px]">runtime.eventStore</code>.
            Total in store: <span className="font-mono">{totalInStore.toLocaleString()}</span> · matching:
            <span className="font-mono"> {total.toLocaleString()}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Event type
              </label>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t} value={t} className="font-mono text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Aggregate / stream ID
              </label>
              <Input
                placeholder="e.g. payment, treasury_wallet_"
                value={aggregateFilter}
                onChange={(e) => { setAggregateFilter(e.target.value); setOffset(0); }}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Page size
              </label>
              <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setOffset(0); }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} per page</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                After seq
              </label>
              <Input
                type="number"
                min={0}
                value={afterSeq}
                onChange={(e) => { setAfterSeq(Math.max(0, Number(e.target.value) || 0)); setOffset(0); }}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Database className="mr-1.5 h-3.5 w-3.5" />}
              Refresh
            </Button>
            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                ← Prev
              </Button>
              <span className="font-mono">page {currentPage}/{totalPages}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + limit >= total || loading}
                onClick={() => setOffset(offset + limit)}
              >
                Next →
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary chips */}
      {summaryStats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summaryStats.map(([t, n]) => (
            <Badge key={t} variant="secondary" className={`font-mono text-[10px] ${typeColor(t)}`}>
              {t}: {n}
            </Badge>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Error loading events: {error}
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
          <CardDescription>Click any row to expand the full payload + metadata.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[70vh]">
            <div className="min-w-[800px]">
              {/* Header row */}
              <div className="grid grid-cols-[60px_140px_220px_1fr_60px_80px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <div>Seq</div>
                <div>Timestamp</div>
                <div>Type</div>
                <div>Stream ID</div>
                <div>Ver</div>
                <div className="text-right">Kind</div>
              </div>
              {events.length === 0 && !loading ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No events match the current filters. Run the simulator or dispatch a command to populate the store.
                </div>
              ) : (
                events.map((e) => (
                  <div key={e.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggle(e.seq)}
                      className="grid w-full grid-cols-[60px_140px_220px_1fr_60px_80px] items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-500/5"
                    >
                      <div className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {e.seq}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(e.timestamp)}</div>
                      <div>
                        <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${typeColor(e.type)}`}>
                          {e.type}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={e.streamId}>
                        {truncate(e.streamId, 60)}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">{e.version}</div>
                      <div className="flex items-center justify-end gap-1">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${kindColor(e.kind)}`}>
                          {e.kind}
                        </span>
                        {expanded.has(e.seq) ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                    {expanded.has(e.seq) && (
                      <div className="grid gap-3 bg-muted/30 px-4 py-3 sm:grid-cols-2">
                        <div className="space-y-2 text-xs">
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Metadata</div>
                            <div className="mt-1 space-y-0.5 font-mono text-[11px]">
                              <div><span className="text-muted-foreground">id:</span> {e.id}</div>
                              <div><span className="text-muted-foreground">streamType:</span> {e.streamType}</div>
                              <div><span className="text-muted-foreground">actor:</span> {e.actor}</div>
                              <div><span className="text-muted-foreground">environment:</span> {e.environment}</div>
                              <div><span className="text-muted-foreground">correlationId:</span> {e.correlationId}</div>
                              <div><span className="text-muted-foreground">intentId:</span> {e.intentId}</div>
                            </div>
                          </div>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReplay(e.seq)}
                              disabled={replaySeq === e.seq}
                            >
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                              {replaySeq === e.seq ? 'Marked!' : 'Replay from here'}
                            </Button>
                            {replaySeq === e.seq && (
                              <p className="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                                Marked seq {e.seq} as replay start. Open the Replay Explorer to continue.
                              </p>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Payload
                          </div>
                          <pre className="mt-1 max-h-64 overflow-auto rounded border bg-card p-3 text-[11px] leading-relaxed">
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
