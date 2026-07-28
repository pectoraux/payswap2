'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Loader2, ChevronRight } from 'lucide-react';

interface SchemaField {
  field: string;
  type: string;
  required: boolean;
  description: string;
}

interface CommandHandlerInfo {
  commandType: string;
  description: string;
  category: string;
  schema: SchemaField[];
  eventsEmitted: string[];
}

interface RecentInvocation {
  timestamp: number;
  streamId: string;
  streamType: string;
  eventType: string;
  actor: string;
  environment: string;
  seq: number;
}

interface CommandsResponse {
  ok: boolean;
  totalCommands?: number;
  categories?: string[];
  handlers?: CommandHandlerInfo[];
  byCategory?: Record<string, CommandHandlerInfo[]>;
  recent?: RecentInvocation[];
  error?: string;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function categoryColor(cat: string): string {
  switch (cat) {
    case 'Payments': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'Refunds': return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
    case 'Payouts': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'Invoices': return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
    case 'Treasury / Reserves': return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
    case 'Wallets': return 'bg-teal-500/15 text-teal-600 dark:text-teal-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function CommandExplorer() {
  const [data, setData] = useState<CommandsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [showRecent, setShowRecent] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (showRecent) params.set('recent', 'true');
      const res = await fetch(`/api/developer/inspectors/commands?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as CommandsResponse;
      setData(json);
      if (!selected && json.handlers && json.handlers.length > 0) {
        setSelected(json.handlers[0].commandType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [showRecent, selected]);

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecent]);

  const handlers = data?.handlers ?? [];
  const byCategory = data?.byCategory ?? {};
  const categories = data?.categories ?? [];
  const recent = data?.recent ?? [];

  const selectedHandler = useMemo(
    () => handlers.find((h) => h.commandType === selected) ?? null,
    [handlers, selected],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base">Command Registry</CardTitle>
            <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
              {data?.totalCommands ?? 0} registered
            </Badge>
          </div>
          <CardDescription>
            Every command type accepted by <code className="rounded bg-muted px-1 py-0.5 text-[11px]">runtime.dispatcher</code>.
            Handlers are PURE: they compute events, the dispatcher appends them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Terminal className="mr-1.5 h-3.5 w-3.5" />}
              Refresh
            </Button>
            <Button
              variant={showRecent ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowRecent((v) => !v)}
              className={showRecent ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}
            >
              {showRecent ? 'Hide' : 'Show'} recent invocations
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Error: {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Sidebar — command types grouped by category */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Commands by category</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-[70vh]">
              <div className="px-3 pb-3">
                {categories.map((cat) => (
                  <div key={cat} className="mb-3">
                    <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {cat} <span className="text-[9px]">({byCategory[cat]?.length ?? 0})</span>
                    </div>
                    <div className="space-y-0.5">
                      {(byCategory[cat] ?? []).map((h) => (
                        <button
                          key={h.commandType}
                          type="button"
                          onClick={() => setSelected(h.commandType)}
                          className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            selected === h.commandType
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <ChevronRight className={`h-3 w-3 shrink-0 ${selected === h.commandType ? 'rotate-90 text-emerald-600' : 'text-muted-foreground'}`} />
                          <span className="truncate font-mono text-[11px]">{h.commandType}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right panel — selected command */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono text-base">{selectedHandler?.commandType ?? '—'}</CardTitle>
              {selectedHandler && (
                <Badge variant="secondary" className={`font-mono text-[10px] ${categoryColor(selectedHandler.category)}`}>
                  {selectedHandler.category}
                </Badge>
              )}
            </div>
            <CardDescription>{selectedHandler?.description ?? 'Select a command from the left.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedHandler && (
              <>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Payload schema
                  </div>
                  <div className="mt-2 overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">Field</th>
                          <th className="px-3 py-2 text-left">Type</th>
                          <th className="px-3 py-2 text-left">Required</th>
                          <th className="px-3 py-2 text-left">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedHandler.schema.map((f) => (
                          <tr key={f.field} className="border-t">
                            <td className="px-3 py-2 font-mono text-[11px] font-semibold">{f.field}</td>
                            <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{f.type}</td>
                            <td className="px-3 py-2">
                              {f.required ? (
                                <Badge variant="secondary" className="bg-rose-500/15 text-[10px] text-rose-600 dark:text-rose-400">required</Badge>
                              ) : (
                                <Badge variant="secondary" className="bg-muted text-[10px] text-muted-foreground">optional</Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-muted-foreground">{f.description}</td>
                          </tr>
                        ))}
                        {selectedHandler.schema.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-3 py-4 text-center text-xs text-muted-foreground">
                              No schema documented for this command.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Events emitted
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedHandler.eventsEmitted.map((e) => (
                      <Badge key={e} variant="secondary" className="bg-emerald-500/10 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                        {e}
                      </Badge>
                    ))}
                    {selectedHandler.eventsEmitted.length === 0 && (
                      <span className="text-xs text-muted-foreground">Unknown.</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="rounded-lg border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">flow:</span>{' '}
                    API → <span className="font-mono">runtime.dispatcher.dispatch()</span> → compile →{' '}
                    <span className="font-mono">invariants.verifyOrThrow()</span> → append to{' '}
                    <span className="font-mono">eventStore</span> → projections update synchronously.
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent invocations */}
      {showRecent && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent invocations</CardTitle>
            <CardDescription>
              The dispatcher doesn&apos;t log commands separately. These are the last 100 domain events
              (each represents a command that produced it).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-96">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[80px_140px_180px_200px_1fr_100px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <div>Seq</div>
                  <div>Timestamp</div>
                  <div>Stream type</div>
                  <div>Event type</div>
                  <div>Stream ID</div>
                  <div>Actor</div>
                </div>
                {recent.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No recent events. Dispatch a command to populate.
                  </div>
                ) : (
                  recent.map((r) => (
                    <div
                      key={`${r.seq}-${r.streamId}`}
                      className="grid grid-cols-[80px_140px_180px_200px_1fr_100px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                    >
                      <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">{r.seq}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(r.timestamp)}</div>
                      <div className="font-mono text-[11px]">{r.streamType}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{r.eventType}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={r.streamId}>{r.streamId}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground" title={r.actor}>{r.actor}</div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
