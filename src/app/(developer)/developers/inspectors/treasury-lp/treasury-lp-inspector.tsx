'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Layers, Loader2, ChevronRight, ChevronDown, CheckCircle2, XCircle } from 'lucide-react';

interface ReserveView {
  accountId: string;
  country: string;
  currency: string;
  fiatAmount: number;
  stablecoinAmount: number;
  total: number;
  reference: string | null;
  isActive: boolean;
}

interface TwinTokenView {
  accountId: string;
  tokenType: string;
  currency: string;
  balance: number;
  backedAmount: number;
  lastUpdated: number;
}

interface LPView {
  lpId: string;
  name: string;
  isActive: boolean;
  supportedCorridors: Array<{ from: string; to: string; capacity: number; spreadBps: number; latencyMs: number }>;
  totalCapacity: number;
  reserveRequirement: number;
  confidence: number;
  riskScore: number;
  registeredAt: number;
  lastUpdated: number;
  bandwidthPositions: Array<{
    country: string;
    assetType: string;
    capacity: number;
    reserved: number;
    used: number;
    available: number;
    escrow: number;
    bond: number;
    status: string;
  }>;
  treasuryAccounts: Array<{
    id: string;
    currency: string;
    availableBalance: number;
    reservedBalance: number;
  }>;
  tier: string;
}

interface LPOfferView {
  offerId: string;
  lpId: string;
  from: string;
  to: string;
  capacity: number;
  spreadBps: number;
  latencyMs: number;
  confidence: number;
  riskScore: number;
  expiresAt: number;
  publishedAt: number;
}

interface TreasuryLpResponse {
  ok: boolean;
  treasury?: {
    reserves: ReserveView[];
    twinTokens: TwinTokenView[];
    balanceSheet: {
      fiatReserves: number;
      stablecoinReserves: number;
      totalReserves: number;
      escrow: number;
      treasuryInventory: number;
      totalAssets: number;
      twinTokensOutstanding: number;
      totalLiabilities: number;
      isBalanced: boolean;
    };
    solvency: {
      reserveCoverage: number;
      twinCoverage: number;
      solvencyRatio: number;
      networkSolvent: boolean;
      countryExposure: Record<string, number>;
    };
    twinTokenProof: {
      totalSupply: number;
      totalBacking: number;
      backingRatio: number;
      isFullyBacked: boolean;
    };
  };
  lp?: {
    lps: LPView[];
    offers: LPOfferView[];
    totalLPs: number;
    activeLPs: number;
    totalOffers: number;
    totalCapacity: number;
    totalBandwidth: number;
  };
  stats?: {
    totalReserves: number;
    twinTokenSupply: number;
    solvencyRatio: number;
    networkSolvent: boolean;
    totalLPs: number;
    totalLPCapacity: number;
  };
  error?: string;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function tierColor(tier: string): string {
  switch (tier) {
    case 'Platinum': return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
    case 'Gold': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'Silver': return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
    case 'Bronze': return 'bg-orange-500/15 text-orange-600 dark:text-orange-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

function tokenTypeColor(t: string): string {
  switch (t) {
    case 'claim': return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'settlement': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'reserve': return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
    case 'liquidity': return 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function TreasuryLpInspector() {
  const [data, setData] = useState<TreasuryLpResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedLP, setExpandedLP] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/inspectors/treasury-lp', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as TreasuryLpResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const treasury = data?.treasury;
  const lp = data?.lp;
  const stats = data?.stats;

  const sortedLPs = useMemo(() => {
    if (!lp) return [];
    return [...lp.lps].sort((a, b) => b.totalCapacity - a.totalCapacity);
  }, [lp]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total reserves</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{fmtNum(stats.totalReserves)}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">fiat + stablecoin</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Twin token supply</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{fmtNum(stats.twinTokenSupply)}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">claim tokens outstanding</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Solvency ratio</div>
              <div className={`mt-1 text-2xl font-bold tabular-nums ${stats.networkSolvent ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {fmtPct(stats.solvencyRatio)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {stats.networkSolvent ? 'network solvent' : 'under stress'}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Active LPs</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{stats.totalLPs}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{fmtNum(stats.totalLPCapacity)} capacity</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Layers className="mr-1.5 h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-rose-500/40">
          <CardContent className="p-4 text-sm text-rose-600 dark:text-rose-400">
            Error: {error}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="treasury">
        <TabsList>
          <TabsTrigger value="treasury">Treasury</TabsTrigger>
          <TabsTrigger value="lp">Liquidity Providers ({lp?.totalLPs ?? 0})</TabsTrigger>
          <TabsTrigger value="offers">LP Offers ({lp?.totalOffers ?? 0})</TabsTrigger>
        </TabsList>

        {/* Treasury tab */}
        <TabsContent value="treasury">
          <div className="space-y-4">
            {/* Balance sheet summary */}
            {treasury && (
              <Card className={treasury.balanceSheet.isBalanced ? 'border-emerald-500/30' : 'border-rose-500/30'}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">Treasury balance sheet</CardTitle>
                      <CardDescription>Reserves, escrow, twin tokens, solvency.</CardDescription>
                    </div>
                    {treasury.balanceSheet.isBalanced ? (
                      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> balanced
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-rose-500/15 text-rose-600 dark:text-rose-400">
                        <XCircle className="mr-1 h-3 w-3" /> imbalanced
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Stat label="Fiat reserves" value={fmtNum(treasury.balanceSheet.fiatReserves)} tone="emerald" />
                    <Stat label="Stablecoin reserves" value={fmtNum(treasury.balanceSheet.stablecoinReserves)} tone="amber" />
                    <Stat label="Escrow" value={fmtNum(treasury.balanceSheet.escrow)} tone="rose" />
                    <Stat label="Treasury inventory" value={fmtNum(treasury.balanceSheet.treasuryInventory)} tone="cyan" />
                    <Stat label="Twin tokens outstanding" value={fmtNum(treasury.balanceSheet.twinTokensOutstanding)} tone="violet" />
                    <Stat label="Total assets" value={fmtNum(treasury.balanceSheet.totalAssets)} tone="emerald" />
                    <Stat label="Total liabilities" value={fmtNum(treasury.balanceSheet.totalLiabilities)} tone="amber" />
                    <Stat
                      label="Solvency ratio"
                      value={fmtPct(treasury.solvency.solvencyRatio)}
                      tone={treasury.solvency.networkSolvent ? 'emerald' : 'rose'}
                    />
                  </div>
                  <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Twin token backing</div>
                    <div className="mt-1 flex items-center gap-3">
                      {treasury.twinTokenProof.isFullyBacked ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                      )}
                      <span className="font-mono">
                        ratio: <span className="font-bold">{treasury.twinTokenProof.backingRatio.toFixed(4)}</span>
                        {' · '}supply: {fmtNum(treasury.twinTokenProof.totalSupply)}
                        {' · '}backing: {fmtNum(treasury.twinTokenProof.totalBacking)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reserves by country */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reserves by country</CardTitle>
                <CardDescription>Fiat + stablecoin reserves grouped by country (reference).</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[50vh]">
                  <div className="min-w-[700px]">
                    <div className="grid grid-cols-[100px_80px_140px_140px_140px_120px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <div>Country</div>
                      <div>Currency</div>
                      <div>Fiat</div>
                      <div>Stablecoin</div>
                      <div>Total</div>
                      <div>Status</div>
                    </div>
                    {(treasury?.reserves ?? []).length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No reserves. Treasury accounts appear once backfilled.
                      </div>
                    ) : (
                      (treasury?.reserves ?? []).map((r, idx) => (
                        <div
                          key={`${r.country}-${r.currency}-${idx}`}
                          className="grid grid-cols-[100px_80px_140px_140px_140px_120px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                        >
                          <div className="font-mono text-[11px]">{r.country}</div>
                          <div className="font-mono text-[11px]">{r.currency}</div>
                          <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">{fmtNum(r.fiatAmount)}</div>
                          <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{fmtNum(r.stablecoinAmount)}</div>
                          <div className="font-mono text-[11px] font-semibold">{fmtNum(r.total)}</div>
                          <div>
                            {r.isActive ? (
                              <Badge variant="secondary" className="bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400">active</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-muted text-[9px] text-muted-foreground">inactive</Badge>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Twin tokens */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Twin token positions</CardTitle>
                <CardDescription>4 token types: claim, settlement, reserve, liquidity.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[40vh]">
                  <div className="min-w-[700px]">
                    <div className="grid grid-cols-[200px_100px_80px_140px_140px_140px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <div>Account ID</div>
                      <div>Type</div>
                      <div>Currency</div>
                      <div>Balance</div>
                      <div>Backed amount</div>
                      <div>Last updated</div>
                    </div>
                    {(treasury?.twinTokens ?? []).length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No twin token positions. Mint twin tokens to populate.
                      </div>
                    ) : (
                      (treasury?.twinTokens ?? []).map((t, idx) => (
                        <div
                          key={`${t.accountId}-${t.tokenType}-${t.currency}-${idx}`}
                          className="grid grid-cols-[200px_100px_80px_140px_140px_140px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                        >
                          <div className="truncate font-mono text-[11px]" title={t.accountId}>{t.accountId}</div>
                          <div>
                            <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] ${tokenTypeColor(t.tokenType)}`}>
                              {t.tokenType}
                            </span>
                          </div>
                          <div className="font-mono text-[11px]">{t.currency}</div>
                          <div className="font-mono text-[11px] font-semibold">{fmtNum(t.balance)}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{fmtNum(t.backedAmount)}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(t.lastUpdated)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* LP tab */}
        <TabsContent value="lp">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Liquidity providers</CardTitle>
              <CardDescription>
                LPs as first-class runtime actors — corridors, capacity, confidence, risk score, tier.
                Click to expand bandwidth positions + treasury accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[1000px]">
                  <div className="grid grid-cols-[160px_140px_80px_120px_100px_100px_100px_120px_40px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>LP ID</div>
                    <div>Name</div>
                    <div>Tier</div>
                    <div>Total capacity</div>
                    <div>Confidence</div>
                    <div>Risk</div>
                    <div>Corridors</div>
                    <div>Last updated</div>
                    <div />
                  </div>
                  {sortedLPs.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No LPs registered. LPs appear once they fire <code className="font-mono text-[10px]">lp.registered</code> events.
                    </div>
                  ) : (
                    sortedLPs.map((l) => (
                      <div key={l.lpId} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setExpandedLP(expandedLP === l.lpId ? null : l.lpId)}
                          className="grid w-full grid-cols-[160px_140px_80px_120px_100px_100px_100px_120px_40px] items-center gap-2 px-4 py-2 text-left text-xs hover:bg-emerald-500/5"
                        >
                          <div className="truncate font-mono text-[11px]" title={l.lpId}>{l.lpId}</div>
                          <div className="truncate text-[11px]" title={l.name}>{l.name}</div>
                          <div>
                            <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[9px] ${tierColor(l.tier)}`}>
                              {l.tier}
                            </span>
                          </div>
                          <div className="font-mono text-[11px] font-semibold">{fmtNum(l.totalCapacity)}</div>
                          <div className={`font-mono text-[11px] ${l.confidence >= 0.7 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {fmtPct(l.confidence)}
                          </div>
                          <div className={`font-mono text-[11px] ${l.riskScore < 0.3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {fmtPct(l.riskScore)}
                          </div>
                          <div className="font-mono text-[11px]">{l.supportedCorridors.length}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(l.lastUpdated)}</div>
                          <div>
                            {expandedLP === l.lpId ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </button>
                        {expandedLP === l.lpId && (
                          <div className="grid gap-3 bg-muted/30 px-4 py-3 lg:grid-cols-3">
                            <div className="space-y-2 text-xs">
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Profile</div>
                              <div className="space-y-0.5 font-mono text-[11px]">
                                <div><span className="text-muted-foreground">active:</span> {l.isActive ? 'yes' : 'no'}</div>
                                <div><span className="text-muted-foreground">reserve req:</span> {fmtNum(l.reserveRequirement)}</div>
                                <div><span className="text-muted-foreground">registered:</span> {fmtTime(l.registeredAt)}</div>
                              </div>
                              <div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Corridors</div>
                              <div className="space-y-0.5">
                                {l.supportedCorridors.map((c, i) => (
                                  <div key={i} className="font-mono text-[10px]">
                                    {c.from}→{c.to}: {fmtNum(c.capacity)} @ {c.spreadBps}bps ({c.latencyMs}ms)
                                  </div>
                                ))}
                                {l.supportedCorridors.length === 0 && (
                                  <span className="text-[10px] text-muted-foreground">No corridors.</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Bandwidth positions</div>
                              <div className="mt-1 space-y-1">
                                {l.bandwidthPositions.map((b, i) => (
                                  <div key={i} className="rounded border bg-card/50 px-2 py-1 text-[11px]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono">{b.country}</span>
                                      <Badge variant="secondary" className="text-[9px]">{b.assetType}</Badge>
                                      <Badge variant="secondary" className={`text-[9px] ${b.status === 'active' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                                        {b.status}
                                      </Badge>
                                    </div>
                                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                      cap: {fmtNum(b.capacity)} · avail: {fmtNum(b.available)} · reserved: {fmtNum(b.reserved)} · escrow: {fmtNum(b.escrow)} · bond: {fmtNum(b.bond)}
                                    </div>
                                  </div>
                                ))}
                                {l.bandwidthPositions.length === 0 && (
                                  <span className="text-[10px] text-muted-foreground">No bandwidth positions.</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Treasury accounts</div>
                              <div className="mt-1 space-y-1">
                                {l.treasuryAccounts.map((a) => (
                                  <div key={a.id} className="rounded border bg-card/50 px-2 py-1 text-[11px]">
                                    <div className="truncate font-mono text-[10px] text-muted-foreground" title={a.id}>{a.id}</div>
                                    <div className="mt-0.5 font-mono text-[10px]">
                                      {a.currency}: avail {fmtNum(a.availableBalance)} · reserved {fmtNum(a.reservedBalance)}
                                    </div>
                                  </div>
                                ))}
                                {l.treasuryAccounts.length === 0 && (
                                  <span className="text-[10px] text-muted-foreground">No treasury accounts.</span>
                                )}
                              </div>
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
        </TabsContent>

        {/* Offers tab */}
        <TabsContent value="offers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active LP offers</CardTitle>
              <CardDescription>Live offers published to the marketplace, sorted by spread (cheapest first).</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[70vh]">
                <div className="min-w-[900px]">
                  <div className="grid grid-cols-[160px_140px_80px_80px_120px_100px_100px_100px_140px] gap-2 border-b bg-muted/40 px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <div>Offer ID</div>
                    <div>LP ID</div>
                    <div>From</div>
                    <div>To</div>
                    <div>Capacity</div>
                    <div>Spread</div>
                    <div>Latency</div>
                    <div>Confidence</div>
                    <div>Published</div>
                  </div>
                  {(lp?.offers ?? []).length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No active offers. LPs publish offers via <code className="font-mono text-[10px]">lp.offer.published</code> events.
                    </div>
                  ) : (
                    (lp?.offers ?? []).map((o) => (
                      <div
                        key={o.offerId}
                        className="grid grid-cols-[160px_140px_80px_80px_120px_100px_100px_100px_140px] gap-2 border-b px-4 py-1.5 text-xs last:border-b-0"
                      >
                        <div className="truncate font-mono text-[11px]" title={o.offerId}>{o.offerId}</div>
                        <div className="truncate font-mono text-[11px] text-muted-foreground" title={o.lpId}>{o.lpId}</div>
                        <div className="font-mono text-[11px]">{o.from}</div>
                        <div className="font-mono text-[11px]">{o.to}</div>
                        <div className="font-mono text-[11px] font-semibold">{fmtNum(o.capacity)}</div>
                        <div className="font-mono text-[11px] text-amber-600 dark:text-amber-400">{o.spreadBps}bps</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{o.latencyMs}ms</div>
                        <div className="font-mono text-[11px]">{fmtPct(o.confidence)}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(o.publishedAt)}</div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'cyan' | 'rose' | 'violet' }) {
  const toneClass = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    cyan: 'text-cyan-600 dark:text-cyan-400',
    rose: 'text-rose-600 dark:text-rose-400',
    violet: 'text-violet-600 dark:text-violet-400',
  }[tone];
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
