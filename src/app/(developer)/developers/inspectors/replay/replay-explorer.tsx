'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, Loader2, GitCompareArrows, RotateCcw } from 'lucide-react';

interface BalanceSheet {
  fiatReserves: number;
  stablecoinReserves: number;
  escrow: number;
  treasuryInventory: number;
  outstandingLPAdvances: number;
  totalAssets: number;
  twinTokensOutstanding: number;
  pendingSettlements: number;
  totalLiabilities: number;
  totalEquity: number;
  isBalanced: boolean;
}

interface Solvency {
  reserveCoverage: number;
  twinCoverage: number;
  solvencyRatio: number;
  networkSolvent: boolean;
}

interface ReplayState {
  seq: number;
  timestamp: number | null;
  eventCount: number;
  countsByType: Record<string, number>;
  countsByStreamType: Record<string, number>;
  lastEvents: Array<{
    seq: number;
    type: string;
    streamId: string;
    timestamp: number;
    actor: string;
  }>;
  balanceSheet: BalanceSheet;
  solvency: Solvency;
}

interface TimelinePoint {
  seq: number;
  eventCount: number;
  totalAssets: number;
  totalLiabilities: number;
  isBalanced: boolean;
}

interface ReplayResponse {
  ok: boolean;
  totalEvents?: number;
  requestedSeq?: number;
  replayed?: ReplayState;
  current?: ReplayState | null;
  timeline?: TimelinePoint[];
  error?: string;
}

function fmtTime(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDelta(a: number, b: number): { text: string; tone: 'pos' | 'neg' | 'neutral' } {
  const d = a - b;
  if (Math.abs(d) < 0.01) return { text: '±0', tone: 'neutral' };
  return {
    text: `${d > 0 ? '+' : ''}${fmtNum(d)}`,
    tone: d > 0 ? 'pos' : 'neg',
  };
}

export function ReplayExplorer() {
  const [data, setData] = useState<ReplayResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState<number>(0);
  const [showCompare, setShowCompare] = useState<boolean>(false);
  const [dateInput, setDateInput] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('seq', String(seq));
      if (showCompare) params.set('compare', 'true');
      const res = await fetch(`/api/developer/inspectors/replay?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ReplayResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [seq, showCompare]);

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, showCompare]);

  const totalEvents = data?.totalEvents ?? 0;
  const replayed = data?.replayed ?? null;
  const current = data?.current ?? null;
  const timeline = data?.timeline ?? [];

  // Initialize seq to the latest on first load.
  useEffect(() => {
    if (totalEvents > 0 && seq === 0 && replayed === null) {
      setSeq(Math.max(0, totalEvents - 1));
    }
  }, [totalEvents, seq, replayed]);

  // Convert date input to seq.
  const applyDate = () => {
    if (!dateInput || !timeline.length) return;
    const target = new Date(dateInput).getTime();
    if (Number.isNaN(target)) return;
    // Find the closest timeline point <= target.
    // We don't have full per-event timestamps here, so approximate by linear interpolation.
    if (replayed?.timestamp && replayed.timestamp > 0 && totalEvents > 0) {
      // Find ratio based on timeline endpoints.
      const first = timeline[0];
      const last = timeline[timeline.length - 1];
      const startTime = first ? (replayed.timestamp - (totalEvents - first.seq) * 100) : target;
      const endTime = last ? (replayed.timestamp + (last.seq - replayed.seq) * 100) : target;
      const ratio = (target - startTime) / Math.max(1, endTime - startTime);
      const newSeq = Math.round(Math.max(0, Math.min(totalEvents - 1, ratio * (totalEvents - 1))));
      setSeq(newSeq);
    }
  };

  const diffRows = useMemo(() => {
    if (!replayed || !current) return [];
    const r = replayed.balanceSheet;
    const c = current.balanceSheet;
    return [
      { label: 'fiat reserves', replayed: r.fiatReserves, current: c.fiatReserves },
      { label: 'stablecoin reserves', replayed: r.stablecoinReserves, current: c.stablecoinReserves },
      { label: 'escrow', replayed: r.escrow, current: c.escrow },
      { label: 'treasury inventory', replayed: r.treasuryInventory, current: c.treasuryInventory },
      { label: 'LP advances', replayed: r.outstandingLPAdvances, current: c.outstandingLPAdvances },
      { label: 'total assets', replayed: r.totalAssets, current: c.totalAssets },
      { label: 'twin tokens outstanding', replayed: r.twinTokensOutstanding, current: c.twinTokensOutstanding },
      { label: 'pending settlements', replayed: r.pendingSettlements, current: c.pendingSettlements },
      { label: 'total liabilities', replayed: r.totalLiabilities, current: c.totalLiabilities },
      { label: 'total equity', replayed: r.totalEquity, current: c.totalEquity },
    ];
  }, [replayed, current]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base">Replay controls</CardTitle>
          </div>
          <CardDescription>
            Replay events up to sequence <span className="font-mono">{seq}</span> of{' '}
            <span className="font-mono">{totalEvents}</span> total.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-muted-foreground">seq 0</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                selected: {seq}
              </span>
              <span className="font-mono text-muted-foreground">seq {Math.max(0, totalEvents - 1)}</span>
            </div>
            <Slider
              value={[seq]}
              min={0}
              max={Math.max(0, totalEvents - 1)}
              step={1}
              onValueChange={(v) => setSeq(v[0] ?? 0)}
              disabled={totalEvents === 0}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Jump to seq
              </label>
              <Input
                type="number"
                min={0}
                max={Math.max(0, totalEvents - 1)}
                value={seq}
                onChange={(e) => setSeq(Math.max(0, Math.min(totalEvents - 1, Number(e.target.value) || 0)))}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Jump to date
              </label>
              <Input
                type="datetime-local"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" size="sm" onClick={applyDate} disabled={!dateInput}>
                Apply date
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSeq(Math.max(0, totalEvents - 1))}
              >
                Latest
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              Re-run replay
            </Button>
            <Button
              variant={showCompare ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowCompare((v) => !v)}
              className={showCompare ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}
            >
              <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />
              {showCompare ? 'Hide' : 'Show'} diff with current
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

      {/* Timeline sparkline */}
      {timeline.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Balance sheet timeline (20 snapshots)</CardTitle>
            <CardDescription>Approximate derived totals across the event log.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-24 items-end gap-1">
              {timeline.map((t) => {
                const max = Math.max(...timeline.map((x) => Math.max(x.totalAssets, x.totalLiabilities, 1)));
                const aHeight = Math.max(2, (t.totalAssets / max) * 100);
                const lHeight = Math.max(2, (t.totalLiabilities / max) * 100);
                const isSelected = t.seq === seq;
                return (
                  <button
                    key={t.seq}
                    type="button"
                    onClick={() => setSeq(t.seq)}
                    className={`flex flex-1 flex-col items-stretch justify-end rounded-t ${isSelected ? 'bg-emerald-500/10' : 'hover:bg-muted'}`}
                    title={`seq ${t.seq}: ${fmtNum(t.totalAssets)} assets / ${fmtNum(t.totalLiabilities)} liabilities`}
                  >
                    <div className="flex h-20 items-end justify-center gap-0.5">
                      <div
                        className={`w-1.5 rounded-t ${t.isBalanced ? 'bg-emerald-500' : 'bg-rose-500'}`}
                        style={{ height: `${aHeight}%` }}
                      />
                      <div
                        className="w-1.5 rounded-t bg-amber-500"
                        style={{ height: `${lHeight}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> assets</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500" /> liabilities</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Replayed state */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Replayed state @ seq {replayed?.seq ?? '—'}</CardTitle>
              {replayed?.balanceSheet.isBalanced && (
                <Badge variant="secondary" className="bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                  balanced
                </Badge>
              )}
            </div>
            <CardDescription>
              {replayed ? `${replayed.eventCount.toLocaleString()} events replayed · ${fmtTime(replayed.timestamp)}` : 'No state.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {replayed ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Total assets" value={fmtNum(replayed.balanceSheet.totalAssets)} />
                  <Stat label="Total liabilities" value={fmtNum(replayed.balanceSheet.totalLiabilities)} />
                  <Stat label="Fiat reserves" value={fmtNum(replayed.balanceSheet.fiatReserves)} />
                  <Stat label="Stablecoin reserves" value={fmtNum(replayed.balanceSheet.stablecoinReserves)} />
                  <Stat label="Twin tokens" value={fmtNum(replayed.balanceSheet.twinTokensOutstanding)} />
                  <Stat label="Escrow" value={fmtNum(replayed.balanceSheet.escrow)} />
                  <Stat label="LP advances" value={fmtNum(replayed.balanceSheet.outstandingLPAdvances)} />
                  <Stat label="Treasury inventory" value={fmtNum(replayed.balanceSheet.treasuryInventory)} />
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Solvency ratio</span>
                    <span className={`font-mono font-semibold ${replayed.solvency.networkSolvent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {fmtPct(replayed.solvency.solvencyRatio)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Twin coverage</span>
                    <span className={`font-mono ${replayed.solvency.twinCoverage >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {fmtPct(replayed.solvency.twinCoverage)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Network solvent</span>
                    <span className={`font-mono ${replayed.solvency.networkSolvent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {replayed.solvency.networkSolvent ? 'YES' : 'NO'}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Event counts by stream type
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(replayed.countsByStreamType).map(([t, n]) => (
                      <Badge key={t} variant="secondary" className="font-mono text-[10px]">
                        {t}: {n}
                      </Badge>
                    ))}
                    {Object.keys(replayed.countsByStreamType).length === 0 && (
                      <span className="text-xs text-muted-foreground">No events at this seq.</span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No replay state available.</div>
            )}
          </CardContent>
        </Card>

        {/* Diff or last events */}
        {showCompare && current ? (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <GitCompareArrows className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <CardTitle className="text-sm">Diff with current</CardTitle>
              </div>
              <CardDescription>Replayed ({replayed?.seq}) → current ({current.seq})</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[60vh]">
                <div className="space-y-1">
                  {diffRows.map((row) => {
                    const delta = fmtDelta(row.current, row.replayed);
                    return (
                      <div
                        key={row.label}
                        className="grid grid-cols-[1fr_100px_100px_80px] items-center gap-2 rounded border bg-card/50 px-3 py-2 text-xs"
                      >
                        <div className="truncate text-muted-foreground">{row.label}</div>
                        <div className="text-right font-mono">{fmtNum(row.replayed)}</div>
                        <div className="text-right font-mono">{fmtNum(row.current)}</div>
                        <div
                          className={`text-right font-mono text-[11px] font-semibold ${
                            delta.tone === 'pos'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : delta.tone === 'neg'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {delta.text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Last 50 events up to seq {replayed?.seq ?? '—'}</CardTitle>
              <CardDescription>Most recent events in the replay window.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <div className="min-w-[600px]">
                  <div className="grid grid-cols-[60px_140px_200px_1fr] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Seq</div>
                    <div>Timestamp</div>
                    <div>Type</div>
                    <div>Stream ID</div>
                  </div>
                  {(replayed?.lastEvents ?? []).length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No events at this seq.
                    </div>
                  ) : (
                    (replayed?.lastEvents ?? []).map((e) => (
                      <div
                        key={`${e.seq}-${e.type}`}
                        className="grid grid-cols-[60px_140px_200px_1fr] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                      >
                        <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">{e.seq}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{fmtTime(e.timestamp)}</div>
                        <div className="font-mono text-[11px]">{e.type}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground" title={e.streamId}>
                          {e.streamId}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
