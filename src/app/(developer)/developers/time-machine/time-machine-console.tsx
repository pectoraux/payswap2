'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  History,
  Play,
  Pause,
  Square,
  SkipForward,
  SkipBack,
  Loader2,
  Shield,
  Wallet,
  TrendingUp,
  Users,
  Briefcase,
  CreditCard,
  ArrowDownToLine,
  ArrowRight,
  GitCompare,
  Search,
  Coins,
  Activity,
  Clock,
  Database,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types (mirror the API responses) ──────────────────────────────────────

interface TimelineResponse {
  ok: boolean;
  totalEvents: number;
  scannedEvents?: number;
  firstSeq: number;
  lastSeq: number;
  firstTs: number;
  lastTs: number;
  eventTypes: { type: string; count: number }[];
  generatedAt: number;
}

interface ReplayEvent {
  seq: number;
  ts: number;
  type: string;
  streamId: string;
  aggregateId: string;
  payloadSummary: string;
}

interface ReplayResponse {
  ok: boolean;
  seq: number;
  ts: number;
  totalEventsReplayed: number;
  balanceSheet: {
    fiatReserves: number;
    stablecoinReserves: number;
    treasuryInventory: number;
    totalAssets: number;
    twinTokensOutstanding: number;
    pendingSettlements: number;
    totalLiabilities: number;
    totalEquity: number;
    isBalanced: boolean;
  };
  eventCounts: { type: string; count: number }[];
  metrics: {
    payments: number;
    payouts: number;
    refunds: number;
    walletCredits: number;
    walletDebits: number;
    treasuryAccounts: number;
    totalVolume: number;
    uniqueCustomers: number;
    uniqueMerchants: number;
    uniqueLPs: number;
  };
  lastEvents: ReplayEvent[];
  generatedAt: number;
}

interface DiffResponse {
  ok: boolean;
  fromSeq: number;
  toSeq: number;
  fromTs: number;
  toTs: number;
  newEventCount: number;
  newEvents: { seq: number; ts: number; type: string; streamId: string }[];
  balanceSheetDelta: {
    fiatReserves: number;
    stablecoinReserves: number;
    treasuryInventory: number;
    totalAssets: number;
    twinTokensOutstanding: number;
    pendingSettlements: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  balanceSheetAtFrom: { totalAssets: number; totalLiabilities: number; totalEquity: number };
  balanceSheetAtTo: { totalAssets: number; totalLiabilities: number; totalEquity: number };
  eventCountByType: { type: string; count: number }[];
  newTreasuryAccounts: { accountId: string; kind: string; currency: string; reference: string | null }[];
  newLps: string[];
  volumeBetween: number;
  generatedAt: number;
}

interface SearchResponse {
  ok: boolean;
  results: { seq: number; ts: number; type: string; streamId: string }[];
  nearest: { seq: number; ts: number; type: string } | null;
  totalEvents: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n: number, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, ...opts }).format(n || 0);

const fmtSigned = (n: number) =>
  `${n >= 0 ? '+' : ''}${fmt(n)}`;

const fmtDateTime = (ts: number) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const fmtTime = (ts: number) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const eventTypeColor = (type: string): string => {
  if (type.startsWith('payment.')) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  if (type.startsWith('payout.')) return 'bg-teal-500/15 text-teal-600 dark:text-teal-400';
  if (type.startsWith('refund.')) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  if (type.startsWith('wallet.')) return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
  if (type.startsWith('treasury.')) return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
  if (type.startsWith('lp.')) return 'bg-orange-500/15 text-orange-600 dark:text-orange-400';
  if (type.startsWith('twin_token') || type.startsWith('twintoken')) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  if (type.startsWith('settlement')) return 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400';
  return 'bg-muted text-muted-foreground';
};

const SCROLL_CLASS =
  'max-h-[calc(100vh-12rem)] overflow-y-auto overflow-x-hidden pr-1 ' +
  '[&::-webkit-scrollbar]:w-1.5 ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full ' +
  '[&::-webkit-scrollbar-thumb]:bg-muted ' +
  '[&::-webkit-scrollbar-track]:bg-transparent';

// ─── Component ──────────────────────────────────────────────────────────────

export function TimeMachineConsole() {
  const [timeline, setTimeline] = React.useState<TimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = React.useState(true);

  const [currentSeq, setCurrentSeq] = React.useState(0);
  const [replay, setReplay] = React.useState<ReplayResponse | null>(null);
  const [replayLoading, setReplayLoading] = React.useState(false);

  const [isPlaying, setIsPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState(1); // events per second multiplier

  // Compare mode
  const [fromSeq, setFromSeq] = React.useState(0);
  const [toSeq, setToSeq] = React.useState(0);
  const [diff, setDiff] = React.useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = React.useState(false);

  // Jump-to-event search
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<SearchResponse['results'] | null>(null);
  const [searching, setSearching] = React.useState(false);

  // Load timeline metadata.
  const loadTimeline = React.useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await fetch('/api/developer/time-machine/timeline', { cache: 'no-store' });
      const json = (await res.json()) as TimelineResponse;
      if (!res.ok || !json.ok) throw new Error('Failed to load timeline');
      setTimeline(json);
      setCurrentSeq((prev) => (prev === 0 ? json.lastSeq : prev));
      setToSeq(json.lastSeq);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast.error('Failed to load timeline', { description: msg });
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  // Load replay state at currentSeq.
  const loadReplay = React.useCallback(async (seq: number, silent = false) => {
    if (!silent) setReplayLoading(true);
    try {
      const res = await fetch(`/api/developer/time-machine/replay?seq=${seq}`, { cache: 'no-store' });
      const json = (await res.json()) as ReplayResponse;
      if (!res.ok || !json.ok) throw new Error('Failed to load replay');
      setReplay(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (!silent) toast.error('Failed to load replay', { description: msg });
    } finally {
      if (!silent) setReplayLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // Debounced replay fetch on currentSeq change. During play, we don't fetch
  // every step (too chatty) — we fetch at most once per 250ms.
  React.useEffect(() => {
    if (!timeline || timeline.totalEvents === 0) return;
    const id = setTimeout(() => {
      loadReplay(currentSeq, isPlaying);
    }, isPlaying ? 0 : 200);
    return () => clearTimeout(id);
  }, [currentSeq, timeline, isPlaying, loadReplay]);

  // Play/pause loop: advance 10 * speed events per second.
  React.useEffect(() => {
    if (!isPlaying) return;
    if (!timeline || timeline.totalEvents === 0) return;

    const stepCount = 10 * speed; // events per tick
    const tickMs = 1000; // 1 second per tick

    const id = setInterval(() => {
      setCurrentSeq((prev) => {
        if (!timeline) return prev;
        const next = Math.min(prev + stepCount, timeline.lastSeq);
        if (next >= timeline.lastSeq) {
          setIsPlaying(false);
          toast.success('Reached end of timeline');
        }
        return next;
      });
    }, tickMs);

    return () => clearInterval(id);
  }, [isPlaying, speed, timeline]);

  // Compare mode: load diff when fromSeq/toSeq changes (debounced).
  React.useEffect(() => {
    if (!timeline || timeline.totalEvents === 0) return;
    if (fromSeq === toSeq) {
      setDiff(null);
      return;
    }

    const id = setTimeout(async () => {
      setDiffLoading(true);
      try {
        const res = await fetch(
          `/api/developer/time-machine/diff?fromSeq=${fromSeq}&toSeq=${toSeq}`,
          { cache: 'no-store' },
        );
        const json = (await res.json()) as DiffResponse;
        if (!res.ok || !json.ok) throw new Error('Failed to load diff');
        setDiff(json);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        toast.error('Failed to load diff', { description: msg });
      } finally {
        setDiffLoading(false);
      }
    }, 400);

    return () => clearTimeout(id);
  }, [fromSeq, toSeq, timeline]);

  // Jump-to-event handler — calls the search endpoint.
  const handleJumpToEvent = async () => {
    if (!timeline || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/developer/time-machine/search?q=${encodeURIComponent(searchQuery.trim())}&limit=20`,
        { cache: 'no-store' },
      );
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || !json.ok) throw new Error('Search failed');
      setSearchResults(json.results);
      if (json.results.length === 0) {
        toast.error('No matching events', { description: `Searched for "${searchQuery}"` });
      } else if (json.results.length === 1) {
        setCurrentSeq(json.results[0].seq);
        toast.success(`Jumped to seq ${json.results[0].seq}`, { description: json.results[0].type });
        setSearchResults(null);
      } else {
        toast.success(`${json.results.length} matches — pick one below`);
      }
    } catch (e) {
      toast.error('Search failed', { description: e instanceof Error ? e.message : 'Unknown' });
    } finally {
      setSearching(false);
    }
  };

  // Date/time picker: convert a Date to the nearest seq via the search endpoint.
  const handleDateTimePick = async (dateStr: string) => {
    if (!dateStr || !timeline || timeline.totalEvents === 0) return;
    const target = new Date(dateStr).getTime();
    if (Number.isNaN(target)) return;

    try {
      const res = await fetch(`/api/developer/time-machine/search?ts=${target}`, { cache: 'no-store' });
      const json = (await res.json()) as SearchResponse;
      if (!res.ok || !json.ok) throw new Error('Search failed');
      if (json.nearest) {
        setCurrentSeq(json.nearest.seq);
        toast.success(`Jumped to ${fmtDateTime(json.nearest.ts)}`, {
          description: `Seq ${json.nearest.seq} · ${json.nearest.type}`,
        });
      } else {
        toast.error('No events near that time');
      }
    } catch (e) {
      toast.error('Date picker failed', { description: e instanceof Error ? e.message : 'Unknown' });
    }
  };

  if (timelineLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Time Machine…
        </div>
      </div>
    );
  }

  if (!timeline) {
    return (
      <Card className="border-rose-500/30">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
            <Shield className="h-5 w-5" />
            <h3 className="text-sm font-semibold">Failed to load timeline</h3>
          </div>
          <Button className="mt-3" size="sm" onClick={loadTimeline}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isEmpty = timeline.totalEvents === 0;
  const sliderMax = Math.max(timeline.lastSeq, 1);
  const sliderValue = Math.min(Math.max(currentSeq, 0), sliderMax);
  const currentTs = replay?.ts ?? timeline.lastTs;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6 text-violet-500" />
            Runtime Time Machine
          </h1>
          <p className="text-sm text-muted-foreground">
            Replay any point in time. The event-sourced store lets you scrub through history — drag the
            slider, hit play, or pick a date to watch the economy unfold.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400">
          <Database className="h-3 w-3" />
          <span className="text-[10px] font-medium uppercase tracking-wide">
            {timeline.totalEvents.toLocaleString()} events
          </span>
        </Badge>
      </div>

      {isEmpty ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
              <History className="h-6 w-6 text-violet-500" />
            </div>
            <h3 className="mt-4 text-sm font-semibold">Event store is empty</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              The runtime hasn&apos;t recorded any events yet. Run a simulation or trigger some
              API activity to populate the event log, then come back here to replay it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className={SCROLL_CLASS}>
          <div className="space-y-6">
            {/* Timeline controls */}
            <Card className="border-violet-500/20">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Clock className="h-4 w-4 text-violet-500" />
                      Timeline
                    </CardTitle>
                    <CardDescription>
                      Drag to scrub · Play to auto-advance · Pick a date to jump
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      seq {sliderValue.toLocaleString()} / {sliderMax.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {fmtDateTime(currentTs)}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Slider */}
                <div className="space-y-2">
                  <Slider
                    value={[sliderValue]}
                    min={0}
                    max={sliderMax}
                    step={1}
                    onValueChange={(v) => {
                      setIsPlaying(false);
                      setCurrentSeq(v[0] ?? 0);
                    }}
                    disabled={isEmpty}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{fmtDateTime(timeline.firstTs)}</span>
                    <span>{fmtDateTime(timeline.lastTs)}</span>
                  </div>
                </div>

                {/* Transport controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentSeq(Math.max(0, currentSeq - 10));
                    }}
                    disabled={isEmpty}
                  >
                    <SkipBack className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setIsPlaying((p) => !p)}
                    disabled={isEmpty}
                    className="bg-violet-600 text-white hover:bg-violet-700"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="mr-1.5 h-3.5 w-3.5" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="mr-1.5 h-3.5 w-3.5" /> Play
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentSeq(Math.min(sliderMax, currentSeq + 10));
                    }}
                    disabled={isEmpty}
                  >
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentSeq(0);
                    }}
                    disabled={isEmpty}
                  >
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>

                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Speed</span>
                    <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                      <SelectTrigger className="h-8 w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1×</SelectItem>
                        <SelectItem value="2">2×</SelectItem>
                        <SelectItem value="5">5×</SelectItem>
                        <SelectItem value="10">10×</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Date/time picker + jump-to-event */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border bg-card/50 p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Jump to date/time
                    </div>
                    <Input
                      type="datetime-local"
                      className="mt-2 h-8 text-xs"
                      onChange={(e) => handleDateTimePick(e.target.value)}
                    />
                    <div className="mt-1 text-[9px] text-muted-foreground">
                      Picks the event nearest to your selected time
                    </div>
                  </div>
                  <div className="rounded-lg border bg-card/50 p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Jump to event
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input
                        type="text"
                        placeholder="type, streamId, or seq"
                        className="h-8 text-xs"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleJumpToEvent();
                        }}
                      />
                      <Button size="sm" variant="outline" onClick={handleJumpToEvent} disabled={searching}>
                        {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    <div className="mt-1 text-[9px] text-muted-foreground">
                      Searches first 10,000 events
                    </div>
                  </div>
                </div>

                {/* Search results dropdown */}
                {searchResults && searchResults.length > 0 && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {searchResults.length} matches — click to jump
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setSearchResults(null)}
                      >
                        Dismiss
                      </Button>
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                      {searchResults.map((r) => (
                        <button
                          key={`${r.seq}-${r.type}`}
                          onClick={() => {
                            setCurrentSeq(r.seq);
                            setSearchResults(null);
                            toast.success(`Jumped to seq ${r.seq}`, { description: r.type });
                          }}
                          className="flex w-full items-center gap-3 rounded border bg-card px-2.5 py-1.5 text-left text-xs hover:bg-muted/30"
                        >
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                            #{r.seq}
                          </span>
                          <Badge variant="secondary" className={`font-mono text-[9px] ${eventTypeColor(r.type)}`}>
                            {r.type}
                          </Badge>
                          <span className="ml-auto truncate font-mono text-[9px] text-muted-foreground">
                            {r.streamId}
                          </span>
                          <span className="text-[9px] text-muted-foreground">
                            {fmtTime(r.ts)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Event type histogram (compact) */}
                {timeline.eventTypes.length > 0 && (
                  <div className="rounded-lg border bg-card/50 p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Event type distribution
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {timeline.eventTypes.slice(0, 12).map((t) => (
                        <TooltipProvider key={t.type}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className={`cursor-help text-[9px] font-mono ${eventTypeColor(t.type)}`}
                              >
                                {t.type} · {t.count}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs">
                                <div>{t.type}</div>
                                <div className="text-muted-foreground">{t.count} events</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tabs: State | Compare */}
            <Tabs defaultValue="state">
              <TabsList>
                <TabsTrigger value="state">
                  <Activity className="mr-1.5 h-3.5 w-3.5" /> State at seq {sliderValue}
                </TabsTrigger>
                <TabsTrigger value="compare">
                  <GitCompare className="mr-1.5 h-3.5 w-3.5" /> Compare
                </TabsTrigger>
              </TabsList>

              <TabsContent value="state" className="space-y-4">
                {replayLoading && !replay ? (
                  <Card>
                    <CardContent className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Replaying events…
                    </CardContent>
                  </Card>
                ) : replay ? (
                  <>
                    {/* Balance sheet */}
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Wallet className="h-4 w-4 text-emerald-500" />
                              Balance Sheet at seq {replay.seq}
                            </CardTitle>
                            <CardDescription>
                              Reconstructed from {replay.totalEventsReplayed.toLocaleString()} events · {fmtDateTime(replay.ts)}
                            </CardDescription>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              replay.balanceSheet.isBalanced
                                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                                : 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400'
                            }
                          >
                            {replay.balanceSheet.isBalanced ? 'Balanced' : 'Imbalanced'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <BalanceSheetCard
                            label="Assets"
                            tone="emerald"
                            rows={[
                              { label: 'Fiat reserves', value: replay.balanceSheet.fiatReserves },
                              { label: 'Stablecoin reserves', value: replay.balanceSheet.stablecoinReserves },
                              { label: 'Treasury inventory', value: replay.balanceSheet.treasuryInventory },
                              { label: 'Total assets', value: replay.balanceSheet.totalAssets, bold: true },
                            ]}
                          />
                          <BalanceSheetCard
                            label="Liabilities"
                            tone="amber"
                            rows={[
                              { label: 'Twin tokens outstanding', value: replay.balanceSheet.twinTokensOutstanding },
                              { label: 'Pending settlements', value: replay.balanceSheet.pendingSettlements },
                              { label: 'Total liabilities', value: replay.balanceSheet.totalLiabilities, bold: true },
                            ]}
                          />
                          <BalanceSheetCard
                            label="Equity"
                            tone="violet"
                            rows={[
                              { label: 'Retained earnings', value: replay.balanceSheet.totalEquity },
                              { label: 'Total equity', value: replay.balanceSheet.totalEquity, bold: true },
                            ]}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* Key metrics */}
                    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      <MetricCard
                        icon={<CreditCard className="h-4 w-4" />}
                        tone="emerald"
                        label="Payments"
                        value={replay.metrics.payments}
                      />
                      <MetricCard
                        icon={<ArrowDownToLine className="h-4 w-4" />}
                        tone="teal"
                        label="Payouts"
                        value={replay.metrics.payouts}
                      />
                      <MetricCard
                        icon={<TrendingUp className="h-4 w-4" />}
                        tone="violet"
                        label="Total Volume"
                        value={fmt(replay.metrics.totalVolume)}
                      />
                      <MetricCard
                        icon={<Users className="h-4 w-4" />}
                        tone="cyan"
                        label="Customers"
                        value={replay.metrics.uniqueCustomers}
                      />
                      <MetricCard
                        icon={<Briefcase className="h-4 w-4" />}
                        tone="orange"
                        label="Merchants"
                        value={replay.metrics.uniqueMerchants}
                      />
                      <MetricCard
                        icon={<Briefcase className="h-4 w-4" />}
                        tone="amber"
                        label="LPs"
                        value={replay.metrics.uniqueLPs}
                      />
                      <MetricCard
                        icon={<Coins className="h-4 w-4" />}
                        tone="rose"
                        label="Wallet Credits"
                        value={replay.metrics.walletCredits}
                      />
                      <MetricCard
                        icon={<Coins className="h-4 w-4" />}
                        tone="rose"
                        label="Wallet Debits"
                        value={replay.metrics.walletDebits}
                      />
                      <MetricCard
                        icon={<Database className="h-4 w-4" />}
                        tone="emerald"
                        label="Treasury Accounts"
                        value={replay.metrics.treasuryAccounts}
                      />
                      <MetricCard
                        icon={<Activity className="h-4 w-4" />}
                        tone="violet"
                        label="Events Replayed"
                        value={replay.totalEventsReplayed}
                      />
                    </div>

                    {/* Last 10 events */}
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <History className="h-4 w-4 text-violet-500" />
                              Last 10 Events
                            </CardTitle>
                            <CardDescription>
                              Events leading up to seq {replay.seq} — context for this point in time
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {replay.lastEvents.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                            No events at this position.
                          </div>
                        ) : (
                          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                            {replay.lastEvents.map((ev) => (
                              <div
                                key={`${ev.seq}-${ev.type}`}
                                className="flex items-start gap-3 rounded-lg border bg-card/50 p-2.5 hover:bg-muted/30"
                              >
                                <div className="shrink-0 text-right">
                                  <div className="font-mono text-xs font-semibold tabular-nums">
                                    #{ev.seq}
                                  </div>
                                  <div className="text-[9px] text-muted-foreground">
                                    {fmtTime(ev.ts)}
                                  </div>
                                </div>
                                <Badge
                                  variant="secondary"
                                  className={`shrink-0 font-mono text-[9px] ${eventTypeColor(ev.type)}`}
                                >
                                  {ev.type}
                                </Badge>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[10px] font-mono text-muted-foreground">
                                    {ev.aggregateId}
                                  </div>
                                  <div className="truncate text-[11px]">
                                    {ev.payloadSummary}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Event count by type as of this point */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Database className="h-4 w-4 text-emerald-500" />
                          Event Counts as of seq {replay.seq}
                        </CardTitle>
                        <CardDescription>
                          Cumulative counts by event type — what happened up to this point
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {replay.eventCounts.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                            No events recorded yet
                          </div>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {replay.eventCounts.map((c) => (
                              <div
                                key={c.type}
                                className="flex items-center justify-between rounded-lg border bg-card/50 px-3 py-2"
                              >
                                <Badge
                                  variant="secondary"
                                  className={`font-mono text-[9px] ${eventTypeColor(c.type)}`}
                                >
                                  {c.type}
                                </Badge>
                                <span className="font-mono text-sm font-semibold tabular-nums">
                                  {c.count.toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : null}
              </TabsContent>

              <TabsContent value="compare" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <GitCompare className="h-4 w-4 text-amber-500" />
                      Compare Two Points in Time
                    </CardTitle>
                    <CardDescription>
                      Pick two seq numbers — we&apos;ll show you exactly what changed between them
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-lg border bg-card/50 p-3">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          From seq
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={sliderMax}
                            value={fromSeq}
                            onChange={(e) => setFromSeq(Math.max(0, Math.min(Number(e.target.value) || 0, sliderMax)))}
                            className="h-8 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setFromSeq(currentSeq)}
                          >
                            Use current
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-lg border bg-card/50 p-3">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          To seq
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={sliderMax}
                            value={toSeq}
                            onChange={(e) => setToSeq(Math.max(0, Math.min(Number(e.target.value) || 0, sliderMax)))}
                            className="h-8 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setToSeq(currentSeq)}
                          >
                            Use current
                          </Button>
                        </div>
                      </div>
                    </div>

                    {diffLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Computing diff…
                      </div>
                    ) : diff ? (
                      <div className="space-y-4">
                        {/* Summary */}
                        <div className="grid gap-3 sm:grid-cols-4">
                          <DiffStat
                            label="New events"
                            value={diff.newEventCount.toLocaleString()}
                            tone="emerald"
                          />
                          <DiffStat
                            label="New accounts"
                            value={diff.newTreasuryAccounts.length.toString()}
                            tone="teal"
                          />
                          <DiffStat
                            label="New LPs"
                            value={diff.newLps.length.toString()}
                            tone="amber"
                          />
                          <DiffStat
                            label="Volume between"
                            value={fmt(diff.volumeBetween)}
                            tone="violet"
                          />
                        </div>

                        {/* Balance sheet delta */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Balance Sheet Delta</CardTitle>
                            <CardDescription>
                              {fmtDateTime(diff.fromTs)} → {fmtDateTime(diff.toTs)}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              <DeltaRow label="Fiat reserves" delta={diff.balanceSheetDelta.fiatReserves} />
                              <DeltaRow label="Stablecoin reserves" delta={diff.balanceSheetDelta.stablecoinReserves} />
                              <DeltaRow label="Treasury inventory" delta={diff.balanceSheetDelta.treasuryInventory} />
                              <DeltaRow label="Total assets" delta={diff.balanceSheetDelta.totalAssets} bold />
                              <DeltaRow label="Twin tokens" delta={diff.balanceSheetDelta.twinTokensOutstanding} />
                              <DeltaRow label="Pending settlements" delta={diff.balanceSheetDelta.pendingSettlements} />
                              <DeltaRow label="Total liabilities" delta={diff.balanceSheetDelta.totalLiabilities} bold />
                              <DeltaRow label="Total equity" delta={diff.balanceSheetDelta.totalEquity} bold />
                            </div>
                          </CardContent>
                        </Card>

                        {/* Balance sheet snapshots side-by-side */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">Balance Sheet Snapshots</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <SnapshotCard
                                label={`At seq ${diff.fromSeq}`}
                                rows={[
                                  { label: 'Assets', value: diff.balanceSheetAtFrom.totalAssets },
                                  { label: 'Liabilities', value: diff.balanceSheetAtFrom.totalLiabilities },
                                  { label: 'Equity', value: diff.balanceSheetAtFrom.totalEquity },
                                ]}
                                tone="emerald"
                              />
                              <div className="flex items-center justify-center">
                                <ArrowRight className="h-5 w-5 text-muted-foreground" />
                              </div>
                              <SnapshotCard
                                label={`At seq ${diff.toSeq}`}
                                rows={[
                                  { label: 'Assets', value: diff.balanceSheetAtTo.totalAssets },
                                  { label: 'Liabilities', value: diff.balanceSheetAtTo.totalLiabilities },
                                  { label: 'Equity', value: diff.balanceSheetAtTo.totalEquity },
                                ]}
                                tone="violet"
                              />
                            </div>
                          </CardContent>
                        </Card>

                        {/* New entities */}
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Card>
                            <CardHeader>
                              <CardTitle className="text-sm">New Treasury Accounts</CardTitle>
                              <CardDescription>Accounts created in the window</CardDescription>
                            </CardHeader>
                            <CardContent>
                              {diff.newTreasuryAccounts.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                  No new accounts
                                </div>
                              ) : (
                                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                                  {diff.newTreasuryAccounts.map((a) => (
                                    <div
                                      key={a.accountId}
                                      className="flex items-center justify-between rounded border bg-card/50 px-2 py-1.5 text-xs"
                                    >
                                      <span className="font-mono text-[10px] text-muted-foreground">
                                        {a.accountId.slice(0, 12)}
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[9px] capitalize">{a.kind.replace('_', ' ')}</Badge>
                                        <span className="font-mono text-[10px]">{a.currency}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle className="text-sm">Event Count by Type (window)</CardTitle>
                              <CardDescription>What happened between the two points</CardDescription>
                            </CardHeader>
                            <CardContent>
                              {diff.eventCountByType.length === 0 ? (
                                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                  No events in window
                                </div>
                              ) : (
                                <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                                  {diff.eventCountByType.map((c) => (
                                    <div
                                      key={c.type}
                                      className="flex items-center justify-between rounded border bg-card/50 px-2 py-1.5 text-xs"
                                    >
                                      <Badge variant="secondary" className={`font-mono text-[9px] ${eventTypeColor(c.type)}`}>
                                        {c.type}
                                      </Badge>
                                      <span className="font-mono font-semibold tabular-nums">{c.count.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </div>

                        {/* New events list */}
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              New Events ({diff.newEventCount.toLocaleString()} total · showing last 100)
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {diff.newEvents.length === 0 ? (
                              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                No new events
                              </div>
                            ) : (
                              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                                {diff.newEvents.map((ev) => (
                                  <button
                                    key={`${ev.seq}-${ev.type}`}
                                    onClick={() => setCurrentSeq(ev.seq)}
                                    className="flex w-full items-center gap-3 rounded border bg-card/50 px-2.5 py-1.5 text-left text-xs hover:bg-muted/30"
                                  >
                                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                                      #{ev.seq}
                                    </span>
                                    <Badge variant="secondary" className={`font-mono text-[9px] ${eventTypeColor(ev.type)}`}>
                                      {ev.type}
                                    </Badge>
                                    <span className="ml-auto text-[9px] text-muted-foreground">
                                      {fmtTime(ev.ts)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                        Pick two different seq numbers to compute the diff
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface BalanceSheetCardProps {
  label: string;
  tone: 'emerald' | 'amber' | 'violet';
  rows: { label: string; value: number; bold?: boolean }[];
}

function BalanceSheetCard({ label, tone, rows }: BalanceSheetCardProps) {
  const toneClass = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
    violet: 'border-violet-500/30 bg-violet-500/5',
  }[tone];

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className={`font-mono tabular-nums ${r.bold ? 'font-bold' : ''}`}>{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'emerald' | 'teal' | 'amber' | 'rose' | 'cyan' | 'violet' | 'orange';
}

const METRIC_TONE_MAP: Record<NonNullable<MetricCardProps['tone']>, string> = {
  emerald: 'text-emerald-500 bg-emerald-500/10',
  teal: 'text-teal-500 bg-teal-500/10',
  amber: 'text-amber-500 bg-amber-500/10',
  rose: 'text-rose-500 bg-rose-500/10',
  cyan: 'text-cyan-500 bg-cyan-500/10',
  violet: 'text-violet-500 bg-violet-500/10',
  orange: 'text-orange-500 bg-orange-500/10',
};

function MetricCard({ icon, label, value, tone = 'emerald' }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className={`flex h-5 w-5 items-center justify-center rounded ${METRIC_TONE_MAP[tone]}`}>
            {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'h-3 w-3' })}
          </span>
        </div>
        <div className="mt-1 text-base font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

interface DiffStatProps {
  label: string;
  value: string;
  tone: 'emerald' | 'teal' | 'amber' | 'violet';
}

const DIFF_TONE_MAP: Record<DiffStatProps['tone'], string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/5',
  teal: 'border-teal-500/30 bg-teal-500/5',
  amber: 'border-amber-500/30 bg-amber-500/5',
  violet: 'border-violet-500/30 bg-violet-500/5',
};

function DiffStat({ label, value, tone }: DiffStatProps) {
  return (
    <div className={`rounded-lg border p-3 ${DIFF_TONE_MAP[tone]}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

interface DeltaRowProps {
  label: string;
  delta: number;
  bold?: boolean;
}

function DeltaRow({ label, delta, bold }: DeltaRowProps) {
  const color = delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground';
  return (
    <div className="flex items-center justify-between rounded border bg-card/50 px-3 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${color} ${bold ? 'text-sm' : ''}`}>
        {fmtSigned(delta)}
      </span>
    </div>
  );
}

interface SnapshotCardProps {
  label: string;
  rows: { label: string; value: number }[];
  tone: 'emerald' | 'violet';
}

function SnapshotCard({ label, rows, tone }: SnapshotCardProps) {
  const toneClass = tone === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-violet-500/30 bg-violet-500/5';
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-mono tabular-nums">{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
