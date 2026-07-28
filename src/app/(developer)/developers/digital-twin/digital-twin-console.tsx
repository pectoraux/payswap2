'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Globe,
  RefreshCw,
  Loader2,
  Activity,
  Briefcase,
  Wallet,
  Coins,
  Route,
  TrendingUp,
  TrendingDown,
  Shield,
  Zap,
  Boxes,
  ArrowRight,
  CircleDot,
  Gauge,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types (mirror the API response) ───────────────────────────────────────

interface CountryTwin {
  country: string;
  currency: string;
  fiatReserves: number;
  stablecoinReserves: number;
  twinTokenSupply: number;
  bandwidth: number;
  activeLPs: number;
  settlementLatency: number;
  demand: number;
  fxRate: number;
  reserveCoverage: number;
  stablecoinDependency: number;
  backingRatio: number;
  health: 'healthy' | 'growing' | 'constrained' | 'critical' | 'emerging';
  forecastDemand: number;
  forecastDepletion: number;
  maturity: 'stablecoin_only' | 'hybrid' | 'mostly_fiat' | 'fully_fiat' | 'reserve_exporter';
}

interface CorridorTwin {
  from: string;
  to: string;
  demand: number;
  supply: number;
  cost: number;
  latency: number;
  health: string;
}

interface DigitalTwin {
  countries: CountryTwin[];
  corridors: CorridorTwin[];
  totalReserves: number;
  totalBandwidth: number;
  totalTwinTokens: number;
  totalStablecoins: number;
  stablecoinDependency: number;
  generatedAt: number;
}

interface NetworkOptimization {
  totalLPs: number;
  totalBandwidth: number;
  networkDensity: number;
  averageSettlementSuccess: number;
  averageLatency: number;
  capitalEfficiency: number;
  bandwidthDistribution: Record<string, number>;
  recommendations: string[];
}

interface BalanceSheet {
  assets: {
    fiatReserves: number;
    stablecoinReserves: number;
    escrow: number;
    receivables: number;
    treasuryInventory: number;
    outstandingLPAdvances: number;
    totalAssets: number;
  };
  liabilities: {
    twinTokensOutstanding: number;
    pendingSettlements: number;
    pendingRedemptions: number;
    lpRewards: number;
    treasuryObligations: number;
    totalLiabilities: number;
  };
  equity: {
    retainedEarnings: number;
    feesCollected: number;
    treasuryProfit: number;
    fxGainLoss: number;
    lpIncentiveExpense: number;
    totalEquity: number;
  };
  isBalanced: boolean;
  imbalance: number;
  generatedAt: number;
}

interface SolvencyReport {
  reserveCoverage: number;
  twinCoverage: number;
  stablecoinCoverage: number;
  escrowCoverage: number;
  settlementExposure: number;
  lpExposure: number;
  countryExposure: Record<string, number>;
  networkSolvent: boolean;
  solvencyRatio: number;
  generatedAt: number;
}

interface YearProjection {
  year: number;
  projectedReserves: number;
  projectedTwinTokens: number;
  projectedStablecoins: number;
  projectedBandwidth: number;
  projectedLPs: number;
  projectedProfit: number;
}

interface Projection {
  simulationId: string;
  scenario: string;
  yearsProjected: number;
  projectedROI: number;
  projectedRisk: number;
  projectedTwinTokenGrowth: number;
  projectedStablecoinReduction: number;
  projectedReserveGrowth: number;
  yearByYear: YearProjection[];
  recommendation: string;
  confidence: number;
  simulatedAt: number;
}

interface Allocation {
  allocationId: string;
  action: string;
  country: string;
  currency: string;
  amount: number;
  reason: string;
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  approvalClass: string;
}

interface ReserveEvolution {
  country: string;
  currentMaturity: string;
  targetMaturity: string;
  fiatRatio: number;
  stablecoinRatio: number;
  recommendedActions: string[];
  evolutionProgress: number;
}

interface LpRow {
  lpId: string;
  name: string;
  confidence: number;
  riskScore: number;
  totalCapacity: number;
  supportedCorridors: number;
}

interface TwinApiResponse {
  ok: boolean;
  generatedAt: number;
  twin: DigitalTwin;
  network: NetworkOptimization;
  balanceSheet: BalanceSheet;
  solvency: SolvencyReport;
  projection: Projection;
  allocations: Allocation[];
  reserveEvolution: ReserveEvolution[];
  lps: LpRow[];
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n: number, opts?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, ...opts }).format(n || 0);

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const fmtRelative = (ts: number) => {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

const maturityColor = (m: string): string => {
  switch (m) {
    case 'stablecoin_only':
      return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30';
    case 'hybrid':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    case 'mostly_fiat':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 'fully_fiat':
      return 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30';
    case 'reserve_exporter':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const healthColor = (h: string): string => {
  switch (h) {
    case 'healthy':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'growing':
      return 'bg-teal-500/15 text-teal-600 dark:text-teal-400';
    case 'constrained':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'critical':
      return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
    case 'emerging':
      return 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
};

const costColor = (bps: number): string => {
  if (bps <= 50) return 'text-emerald-600 dark:text-emerald-400';
  if (bps <= 150) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
};

const SCROLL_CLASS =
  'max-h-[calc(100vh-12rem)] overflow-y-auto overflow-x-hidden pr-1 ' +
  '[&::-webkit-scrollbar]:w-1.5 ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full ' +
  '[&::-webkit-scrollbar-thumb]:bg-muted ' +
  '[&::-webkit-scrollbar-track]:bg-transparent';

// Country code → emoji flag (ISO 3166-1 alpha-2).
const flag = (code: string): string => {
  if (!code || code.length !== 2) return '🏳️';
  const upper = code.toUpperCase();
  const cp = [...upper].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...cp);
};

// ─── Component ──────────────────────────────────────────────────────────────

export function DigitalTwinConsole() {
  const [data, setData] = React.useState<TwinApiResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/developer/digital-twin', { cache: 'no-store' });
      const json = (await res.json()) as TwinApiResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      if (!silent) toast.error('Failed to load Digital Twin', { description: msg });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    // Auto-refresh every 30s.
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Digital Twin…
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                <div className="mt-3 h-7 w-20 rounded bg-muted animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Card className="border-rose-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Shield className="h-5 w-5" />
              <h3 className="text-sm font-semibold">Failed to load Digital Twin</h3>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{error ?? 'Unknown error'}</p>
            <Button className="mt-3" size="sm" onClick={() => load()}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { twin, network, balanceSheet, solvency, projection, allocations, reserveEvolution, lps } = data;
  const totalCountries = twin.countries.length;
  const totalCorridors = twin.corridors.length;
  const totalReserves = twin.totalReserves;
  const twinTokenSupply = twin.totalTwinTokens;
  const networkDensity = network.networkDensity;
  const maxCountryReserves = Math.max(...twin.countries.map((c) => c.fiatReserves + c.stablecoinReserves), 1);
  const maxProjectionReserves = Math.max(...projection.yearByYear.map((y) => y.projectedReserves), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6 text-emerald-500" />
            Digital Twin Console
          </h1>
          <p className="text-sm text-muted-foreground">
            Live snapshot of every country, reserve pool, LP, corridor, and flow in the PaySwap network.
            Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
          >
            <CircleDot className="h-3 w-3 animate-pulse" />
            <span className="text-[10px] font-medium uppercase tracking-wide">Live</span>
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            Last refreshed {fmtRelative(data.generatedAt)}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className={SCROLL_CLASS}>
        <div className="space-y-6">
          {/* Overview stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <OverviewStat
              icon={<Globe className="h-4 w-4" />}
              tone="emerald"
              label="Countries"
              value={fmt(totalCountries)}
              hint="Active reserves"
            />
            <OverviewStat
              icon={<Wallet className="h-4 w-4" />}
              tone="teal"
              label="Total Reserves"
              value={fmtUsd(totalReserves)}
              hint={`Fiat ${fmt(balanceSheet.assets.fiatReserves)} · Stable ${fmt(balanceSheet.assets.stablecoinReserves)}`}
            />
            <OverviewStat
              icon={<Briefcase className="h-4 w-4" />}
              tone="cyan"
              label="Total LPs"
              value={fmt(network.totalLPs)}
              hint={`${twin.totalBandwidth.toFixed(0)} bandwidth`}
            />
            <OverviewStat
              icon={<Route className="h-4 w-4" />}
              tone="violet"
              label="Corridors"
              value={fmt(totalCorridors)}
              hint="Active routes"
            />
            <OverviewStat
              icon={<Coins className="h-4 w-4" />}
              tone="amber"
              label="Twin Token Supply"
              value={fmt(twinTokenSupply)}
              hint={`Backing: ${fmtPct(solvency.twinCoverage)}`}
            />
            <OverviewStat
              icon={<Gauge className="h-4 w-4" />}
              tone="orange"
              label="Network Density"
              value={networkDensity.toFixed(2)}
              hint="LPs / corridor"
            />
          </div>

          {/* Solvency banner */}
          <Card className={solvency.networkSolvent ? 'border-emerald-500/30' : 'border-rose-500/30'}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Shield
                  className={`h-4 w-4 ${
                    solvency.networkSolvent
                      ? 'text-emerald-500'
                      : 'text-rose-500'
                  }`}
                />
                <span className="text-sm font-semibold">
                  Network {solvency.networkSolvent ? 'solvent' : 'insolvent'}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  Solvency ratio {solvency.solvencyRatio.toFixed(2)}×
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                <span>
                  Reserve coverage: <span className="font-mono font-semibold">{fmtPct(solvency.reserveCoverage)}</span>
                </span>
                <span>
                  Twin coverage: <span className="font-mono font-semibold">{fmtPct(solvency.twinCoverage)}</span>
                </span>
                <span>
                  LP exposure: <span className="font-mono font-semibold">{fmtPct(solvency.lpExposure)}</span>
                </span>
                <span>
                  Settlement exposure: <span className="font-mono font-semibold">{fmtPct(solvency.settlementExposure)}</span>
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Countries grid */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Globe className="h-4 w-4 text-emerald-500" />
                    Countries
                  </CardTitle>
                  <CardDescription>Per-country reserves, maturity, and bandwidth</CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {totalCountries} active
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {twin.countries.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
                  No countries yet. Run a simulation to populate the digital twin.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {twin.countries.map((c) => {
                    const total = c.fiatReserves + c.stablecoinReserves;
                    const fiatPct = total > 0 ? (c.fiatReserves / total) * 100 : 0;
                    const stablePct = 100 - fiatPct;
                    return (
                      <div
                        key={c.country}
                        className="rounded-xl border bg-card p-4 transition-colors hover:border-emerald-500/40"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl" aria-hidden>
                              {flag(c.country)}
                            </span>
                            <div>
                              <div className="text-sm font-semibold">{c.country}</div>
                              <div className="text-[10px] font-mono text-muted-foreground">{c.currency}</div>
                            </div>
                          </div>
                          <Badge variant="outline" className={`text-[9px] capitalize ${maturityColor(c.maturity)}`}>
                            {c.maturity.replace('_', ' ')}
                          </Badge>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <div className="text-muted-foreground">Fiat reserves</div>
                            <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              {fmt(c.fiatReserves)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Stablecoin</div>
                            <div className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                              {fmt(c.stablecoinReserves)}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Active LPs</div>
                            <div className="font-mono font-semibold">{c.activeLPs}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Bandwidth</div>
                            <div className="font-mono font-semibold">{fmt(c.bandwidth)}</div>
                          </div>
                        </div>

                        {/* Reserves bar */}
                        <div className="mt-3">
                          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="bg-emerald-500"
                              style={{ width: `${fiatPct}%` }}
                              title={`Fiat ${fiatPct.toFixed(0)}%`}
                            />
                            <div
                              className="bg-amber-500"
                              style={{ width: `${stablePct}%` }}
                              title={`Stablecoin ${stablePct.toFixed(0)}%`}
                            />
                          </div>
                          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                            <span>{fiatPct.toFixed(0)}% fiat</span>
                            <span>{stablePct.toFixed(0)}% stablecoin</span>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <Badge variant="secondary" className={`text-[9px] capitalize ${healthColor(c.health)}`}>
                            {c.health}
                          </Badge>
                          <span className="text-[9px] text-muted-foreground">
                            Coverage {(c.reserveCoverage * 100).toFixed(0)}%
                          </span>
                        </div>

                        {/* Mini reserves bar relative to the largest country */}
                        <div className="mt-2">
                          <Progress
                            value={(total / maxCountryReserves) * 100}
                            className="h-1"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reserves visualization (full breakdown) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-teal-500" />
                Reserves — Fiat vs Stablecoin by Country
              </CardTitle>
              <CardDescription>Each bar shows the absolute reserve composition</CardDescription>
            </CardHeader>
            <CardContent>
              {twin.countries.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No reserves yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {twin.countries.map((c) => {
                    const total = c.fiatReserves + c.stablecoinReserves;
                    const widthPct = maxCountryReserves > 0 ? (total / maxCountryReserves) * 100 : 0;
                    const fiatPct = total > 0 ? (c.fiatReserves / total) * 100 : 0;
                    const stablePct = 100 - fiatPct;
                    return (
                      <div key={c.country} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span>{flag(c.country)}</span>
                            <span className="font-medium">{c.country}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{c.currency}</span>
                          </div>
                          <span className="font-mono tabular-nums">{fmt(total)}</span>
                        </div>
                        <div className="flex h-3 overflow-hidden rounded-full bg-muted" style={{ width: `${widthPct}%` }}>
                          <div className="bg-emerald-500" style={{ width: `${fiatPct}%` }} />
                          <div className="bg-amber-500" style={{ width: `${stablePct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Corridors table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Route className="h-4 w-4 text-violet-500" />
                    Corridors
                  </CardTitle>
                  <CardDescription>Active settlement routes between countries</CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {totalCorridors} corridors
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {twin.corridors.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No corridors yet. Run a simulation to seed corridor activity.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto overflow-x-auto pr-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>From → To</TableHead>
                        <TableHead className="text-right">Demand</TableHead>
                        <TableHead className="text-right">Supply</TableHead>
                        <TableHead className="text-right">Cost (bps)</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                        <TableHead>Health</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {twin.corridors.map((c, idx) => (
                        <TableRow key={`${c.from}-${c.to}-${idx}`}>
                          <TableCell className="font-medium">
                            <span className="flex items-center gap-1.5">
                              <span>{flag(c.from)}</span>
                              <span>{c.from}</span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                              <span>{flag(c.to)}</span>
                              <span>{c.to}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{fmt(c.demand)}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{fmt(c.supply)}</TableCell>
                          <TableCell className={`text-right tabular-nums text-xs font-semibold ${costColor(c.cost)}`}>
                            {c.cost}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            {c.latency > 0 ? `${(c.latency / 1000).toFixed(1)}s` : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={`text-[9px] capitalize ${healthColor(c.health)}`}>
                              {c.health}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* LP network table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Briefcase className="h-4 w-4 text-cyan-500" />
                    LP Network
                  </CardTitle>
                  <CardDescription>Liquidity providers registered with the runtime</CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {lps.length} LPs
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {lps.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No LPs registered with the runtime yet.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto overflow-x-auto pr-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>LP</TableHead>
                        <TableHead className="text-right">Capacity</TableHead>
                        <TableHead className="text-right">Corridors</TableHead>
                        <TableHead className="text-right">Confidence</TableHead>
                        <TableHead className="text-right">Risk</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lps.map((lp) => (
                        <TableRow key={lp.lpId}>
                          <TableCell>
                            <div className="font-medium text-sm">{lp.name}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{lp.lpId}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold">
                            {fmt(lp.totalCapacity)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{lp.supportedCorridors}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            <span className={lp.confidence > 0.7 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                              {fmtPct(lp.confidence)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            <span className={lp.riskScore < 0.3 ? 'text-emerald-600 dark:text-emerald-400' : lp.riskScore < 0.6 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>
                              {fmtPct(lp.riskScore)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px]">
                              Active
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Flows / Recommendations (from capital allocations) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-amber-500" />
                    Flows &amp; Capital Recommendations
                  </CardTitle>
                  <CardDescription>
                    Live recommendations from the Economic Control Plane — what capital should move where
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {allocations.length} recommendations
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {allocations.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  No active capital recommendations — the network is in equilibrium.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto overflow-x-auto pr-1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">ROI</TableHead>
                        <TableHead className="text-right">Risk</TableHead>
                        <TableHead>Approval</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allocations.map((a) => (
                        <TableRow key={a.allocationId}>
                          <TableCell>
                            <Badge variant="secondary" className="text-[9px] font-mono">
                              {a.action.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="flex items-center gap-1">
                              <span>{flag(a.country)}</span>
                              <span>{a.country}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold">
                            {fmt(a.amount)} <span className="text-muted-foreground">{a.currency}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-emerald-600 dark:text-emerald-400">
                            {fmtPct(a.expectedROI)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs">
                            <span className={a.expectedRisk < 0.3 ? 'text-emerald-600 dark:text-emerald-400' : a.expectedRisk < 0.6 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>
                              {fmtPct(a.expectedRisk)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[9px] capitalize">
                              {a.approvalClass.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs text-[10px] text-muted-foreground">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help truncate">
                                    {a.reason}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-sm">
                                  <p className="text-xs">{a.reason}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Predictions panel: 5-year expansion projection */}
          <Card className="border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-transparent to-transparent">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TrendingUp className="h-4 w-4 text-violet-500" />
                    5-Year Expansion Projection
                  </CardTitle>
                  <CardDescription>
                    Year-by-year projection from the Global Economic Directorate. {projection.scenario}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    ROI {fmtPct(projection.projectedROI)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    Risk {fmtPct(projection.projectedRisk)}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    Confidence {fmtPct(projection.confidence)}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
                <span className="font-semibold">Recommendation: </span>
                <span className="text-muted-foreground">{projection.recommendation}</span>
              </div>

              {/* Mini chart: projected reserves over years */}
              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Projected reserves (USD)
                </div>
                <div className="flex h-32 items-end gap-2 rounded-lg border bg-card/50 p-3">
                  {projection.yearByYear.map((y) => {
                    const h = maxProjectionReserves > 0 ? (y.projectedReserves / maxProjectionReserves) * 100 : 0;
                    return (
                      <TooltipProvider key={y.year}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="group flex flex-1 flex-col items-center gap-1">
                              <div
                                className="w-full rounded-t bg-gradient-to-t from-violet-500 to-violet-400 transition-all group-hover:from-violet-600 group-hover:to-violet-500"
                                style={{ height: `${Math.max(h, 4)}%` }}
                              />
                              <span className="text-[9px] font-mono text-muted-foreground">Y{y.year}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div>Year {y.year}</div>
                              <div>Reserves: {fmt(y.projectedReserves)}</div>
                              <div>Profit: {fmt(y.projectedProfit)}</div>
                              <div>LPs: {y.projectedLPs}</div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
              </div>

              {/* Year-by-year table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Year</TableHead>
                      <TableHead className="text-right">Reserves</TableHead>
                      <TableHead className="text-right">Twin Tokens</TableHead>
                      <TableHead className="text-right">Stablecoins</TableHead>
                      <TableHead className="text-right">Bandwidth</TableHead>
                      <TableHead className="text-right">LPs</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projection.yearByYear.map((y) => (
                      <TableRow key={y.year}>
                        <TableCell className="font-mono text-xs font-semibold">Y{y.year}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{fmt(y.projectedReserves)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{fmt(y.projectedTwinTokens)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{fmt(y.projectedStablecoins)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{fmt(y.projectedBandwidth)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs">{y.projectedLPs}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {fmt(y.projectedProfit)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-emerald-500" /> Reserve Growth
                  </div>
                  <div className="mt-1 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                    +{fmtPct(projection.projectedReserveGrowth)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <Coins className="h-3 w-3 text-violet-500" /> Twin Token Growth
                  </div>
                  <div className="mt-1 font-mono font-semibold text-violet-600 dark:text-violet-400">
                    +{fmtPct(projection.projectedTwinTokenGrowth)}
                  </div>
                </div>
                <div className="rounded-lg border bg-card/50 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <TrendingDown className="h-3 w-3 text-amber-500" /> Stablecoin Reduction
                  </div>
                  <div className="mt-1 font-mono font-semibold text-amber-600 dark:text-amber-400">
                    {fmtPct(projection.projectedStablecoinReduction)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Reserve Evolution + Simulations link */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-teal-500" />
                  Reserve Maturity Evolution
                </CardTitle>
                <CardDescription>Planned progression for each country</CardDescription>
              </CardHeader>
              <CardContent>
                {reserveEvolution.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    No evolution plans.
                  </div>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {reserveEvolution.map((r) => (
                      <div key={r.country} className="rounded-lg border bg-card/50 p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span>{flag(r.country)}</span>
                            {r.country}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Badge variant="outline" className="text-[9px] capitalize">{r.currentMaturity.replace('_', ' ')}</Badge>
                            <ArrowRight className="h-3 w-3" />
                            <Badge variant="outline" className="text-[9px] capitalize">{r.targetMaturity.replace('_', ' ')}</Badge>
                          </span>
                        </div>
                        <div className="mt-2">
                          <Progress value={r.evolutionProgress * 100} className="h-1.5" />
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {(r.evolutionProgress * 100).toFixed(0)}% progressed
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Boxes className="h-4 w-4 text-emerald-500" />
                  Simulations
                </CardTitle>
                <CardDescription>Run a scenario through the kernel pipeline</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  The simulator runs the exact same kernel as production. Use it to stress-test the
                  digital twin before executing real capital moves.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/developers/simulator">
                      <Zap className="mr-1.5 h-3.5 w-3.5" /> Open Simulator
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/developers/time-machine">
                      <Activity className="mr-1.5 h-3.5 w-3.5" /> Open Time Machine
                    </Link>
                  </Button>
                </div>
                {network.recommendations.length > 0 && (
                  <div className="mt-3 rounded-lg border bg-card/50 p-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Network optimization recommendations
                    </div>
                    <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      {network.recommendations.map((rec, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-emerald-500">•</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

interface OverviewStatProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'emerald' | 'teal' | 'amber' | 'rose' | 'cyan' | 'violet' | 'orange';
}

const TONE_MAP: Record<NonNullable<OverviewStatProps['tone']>, string> = {
  emerald: 'text-emerald-500 bg-emerald-500/10',
  teal: 'text-teal-500 bg-teal-500/10',
  amber: 'text-amber-500 bg-amber-500/10',
  rose: 'text-rose-500 bg-rose-500/10',
  cyan: 'text-cyan-500 bg-cyan-500/10',
  violet: 'text-violet-500 bg-violet-500/10',
  orange: 'text-orange-500 bg-orange-500/10',
};

function OverviewStat({ icon, label, value, hint, tone = 'emerald' }: OverviewStatProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className={`flex h-6 w-6 items-center justify-center rounded-md ${TONE_MAP[tone]}`}>
            {icon}
          </span>
        </div>
        <div className="mt-2 text-xl font-bold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
