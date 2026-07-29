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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Globe,
  Gauge as GaugeIcon,
  Coins,
  Scale,
  Layers,
  Clock,
  Activity,
  Search,
  Banknote,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  HealthBadge,
  SectionLabel,
  StackedBar,
  StatTile,
  fmtNum,
  fmtPct,
  fmtUsd,
  fmtX,
} from '@/components/dashboards/visuals';

export interface BandwidthDTO {
  lpId: string;
  country: string;
  assetType: string;
  currency: string;
  capacity: number;
  reserved: number;
  used: number;
  available: number;
  escrow: number;
  bond: number;
  status: string;
  participationMode: string;
  debitAuthorized: boolean;
  debitConnector: string | null;
}

export interface SettlementContractDTO {
  id: string;
  status: string;
  fromCountry: string;
  toCountry: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  escrowAmount: number;
  escrowCurrency: string;
  lpId?: string;
  recipientId?: string;
  createdAt: number;
  fundedAt?: number;
  claimedAt?: number;
  confirmedAt?: number;
  releasedAt?: number;
  closedAt?: number;
  expiresAt: number;
  strategy: string;
}

export interface CountryDTO {
  country: string;
  currency: string;
  fiatReserves: number;
  stablecoinReserves: number;
  twinTokenSupply: number;
  reserveCoverage: number;
  backingRatio: number;
  health: string;
}

export interface CorridorDTO {
  from: string;
  to: string;
  demand: number;
  supply: number;
  cost: number;
  latency: number;
  health: string;
}

interface Props {
  bandwidth: BandwidthDTO[];
  contracts: SettlementContractDTO[];
  countries: CountryDTO[];
  corridors: CorridorDTO[];
  totalBandwidth: number;
  totalStablecoins: number;
  totalReserves: number;
  totalTwinTokens: number;
  settlementQueueCount: number;
  settlementQueueValue: number;
  fiatReserves: number;
  stablecoinReserves: number;
}

const ASSET_STYLES: Record<string, string> = {
  fiat: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  stablecoin: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  twin_token: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  suspended: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  exhausted: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  slashed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

const CORRIDOR_HEALTH_STYLES: Record<string, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  growing: 'text-teal-600 dark:text-teal-400',
  constrained: 'text-amber-600 dark:text-amber-400',
  critical: 'text-rose-600 dark:text-rose-400',
};

export function LiquidityMarketViewer({
  bandwidth,
  contracts,
  countries,
  corridors,
  totalBandwidth,
  totalStablecoins,
  totalReserves,
  totalTwinTokens,
  settlementQueueCount,
  settlementQueueValue,
  fiatReserves,
  stablecoinReserves,
}: Props) {
  const [search, setSearch] = React.useState('');
  const [assetFilter, setAssetFilter] = React.useState<string>('all');
  const [countryFilter, setCountryFilter] = React.useState<string>('all');

  const countriesList = React.useMemo(
    () => [...new Set(bandwidth.map((b) => b.country))].sort(),
    [bandwidth],
  );

  const filteredBandwidth = React.useMemo(() => {
    return bandwidth.filter((b) => {
      if (assetFilter !== 'all' && b.assetType !== assetFilter) return false;
      if (countryFilter !== 'all' && b.country !== countryFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.lpId.toLowerCase().includes(q) &&
          !b.country.toLowerCase().includes(q) &&
          !b.currency.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [bandwidth, assetFilter, countryFilter, search]);

  const maxCorridorDemand = Math.max(1, ...corridors.map((c) => c.demand));
  const totalLPS = new Set(bandwidth.map((b) => b.lpId)).size;

  return (
    <div className="space-y-6">
      {/* Top KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total LP bandwidth"
          value={fmtUsd(totalBandwidth)}
          hint={`${totalLPS} LPs · ${bandwidth.length} positions`}
          tone="emerald"
          icon={<GaugeIcon className="h-4 w-4" />}
        />
        <StatTile
          label="Stablecoin inventory"
          value={fmtUsd(stablecoinReserves)}
          hint={fmtPct(stablecoinReserves / (totalReserves || 1), 0) + ' of total reserves'}
          tone="amber"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatTile
          label="Reserve coverage"
          value={fmtX(totalReserves / (totalTwinTokens || 1), 2)}
          hint={`${fmtUsd(fiatReserves)} fiat · ${fmtUsd(stablecoinReserves)} stable`}
          tone="teal"
          icon={<Scale className="h-4 w-4" />}
        />
        <StatTile
          label="Settlement queue"
          value={settlementQueueCount.toString()}
          hint={fmtUsd(settlementQueueValue) + ' pending'}
          tone="violet"
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Global LP Map — table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4 text-emerald-500" />
                  Global LP map
                </CardTitle>
                <CardDescription>
                  Every bandwidth position: capacity, available, escrow, participation and health.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Filter strip */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search LP / country / currency…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
              <Select value={assetFilter} onValueChange={setAssetFilter}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Asset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All assets</SelectItem>
                  <SelectItem value="fiat">Fiat</SelectItem>
                  <SelectItem value="stablecoin">Stablecoin</SelectItem>
                  <SelectItem value="twin_token">Twin token</SelectItem>
                </SelectContent>
              </Select>
              <Select value={countryFilter} onValueChange={setCountryFilter}>
                <SelectTrigger className="h-8 w-[120px] text-xs">
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All countries</SelectItem>
                  {countriesList.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-[10px] uppercase text-muted-foreground">
                    <th className="py-2">LP</th>
                    <th className="py-2">Country</th>
                    <th className="py-2">Asset</th>
                    <th className="py-2 text-right">Capacity</th>
                    <th className="py-2 text-right">Avail</th>
                    <th className="py-2 text-right">Used</th>
                    <th className="py-2 text-right">Escrow</th>
                    <th className="py-2 text-right">Bond</th>
                    <th className="py-2">Mode</th>
                    <th className="py-2">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBandwidth.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-muted-foreground">
                        No bandwidth positions match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredBandwidth.map((b, i) => {
                      const utilization = b.capacity > 0 ? (b.used + b.reserved) / b.capacity : 0;
                      const health = utilization > 0.9 ? 'exhausted' : utilization > 0.5 ? 'constrained' : 'healthy';
                      return (
                        <tr key={`${b.lpId}-${b.country}-${b.assetType}-${b.currency}-${i}`} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 font-mono text-[10px]">{b.lpId}</td>
                          <td className="py-2 font-mono font-semibold">{b.country}</td>
                          <td className="py-2">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${ASSET_STYLES[b.assetType] ?? 'bg-muted text-muted-foreground'}`}>
                              {b.assetType}
                            </span>
                          </td>
                          <td className="py-2 text-right font-semibold tabular-nums">{fmtUsd(b.capacity)}</td>
                          <td className="py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(b.available)}</td>
                          <td className="py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtUsd(b.used)}</td>
                          <td className="py-2 text-right tabular-nums text-violet-600 dark:text-violet-400">{fmtUsd(b.escrow)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{fmtUsd(b.bond)}</td>
                          <td className="py-2">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${b.participationMode === 'automatic' ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400' : 'bg-muted text-muted-foreground'}`}>
                              {b.participationMode === 'automatic' ? 'AUTO' : 'MANUAL'}
                            </span>
                            {b.debitAuthorized && (
                              <span className="ml-1 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-600 dark:text-emerald-400" title={`Debit via ${b.debitConnector}`}>
                                DEBIT
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${STATUS_STYLES[health] ?? STATUS_STYLES[b.status] ?? 'bg-muted text-muted-foreground'}`}>
                              {health}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Settlement Queue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-violet-500" />
              Settlement queue
            </CardTitle>
            <CardDescription>
              Pending escrowed contracts awaiting settlement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 rounded-lg border bg-violet-500/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                In queue
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold tabular-nums text-violet-600 dark:text-violet-400">
                  {settlementQueueCount}
                </span>
                <span className="text-xs text-muted-foreground">contracts</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {fmtUsd(settlementQueueValue)} total value
              </div>
            </div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {contracts
                .filter((c) => !['closed', 'expired'].includes(c.status))
                .slice(0, 12)
                .map((c) => (
                  <div key={c.id} className="rounded border bg-card/40 p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">{c.id}</span>
                      <span className="text-[9px] font-bold uppercase text-violet-600 dark:text-violet-400">
                        {c.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono">
                        {c.fromCountry} → {c.toCountry}
                      </span>
                      <span className="font-semibold tabular-nums">{fmtUsd(c.amount)}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Escrow: {fmtUsd(c.escrowAmount)} {c.escrowCurrency}
                    </div>
                  </div>
                ))}
              {contracts.filter((c) => !['closed', 'expired'].includes(c.status)).length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  Settlement queue is empty.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Marketplace depth */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-teal-500" />
              Marketplace depth by corridor
            </CardTitle>
            <CardDescription>
              Available bandwidth (supply) vs demand across each corridor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {corridors.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No corridors in the digital twin yet.
                </div>
              ) : (
                corridors.map((c, i) => {
                  const fillPct = c.demand > 0 ? c.supply / c.demand : 1;
                  return (
                    <div key={`${c.from}-${c.to}-${i}`} className="rounded-lg border bg-card/40 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                          {c.from} <span className="text-muted-foreground">→</span> {c.to}
                          <span className={`text-[10px] font-bold uppercase ${CORRIDOR_HEALTH_STYLES[c.health] ?? 'text-muted-foreground'}`}>
                            {c.health}
                          </span>
                        </div>
                        <div className="text-[10px] tabular-nums text-muted-foreground">
                          fill: <span className={fillPct >= 1 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-amber-600 dark:text-amber-400'}>
                            {fmtPct(fillPct, 0)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <div className="text-[9px] w-12 text-amber-600 dark:text-amber-400">DEMAND</div>
                        <div className="flex-1">
                          <Bar value={c.demand} max={maxCorridorDemand} colorClass="bg-amber-500/60" height="h-2" />
                        </div>
                        <div className="text-[9px] w-16 text-right tabular-nums">{fmtNum(c.demand)}</div>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <div className="text-[9px] w-12 text-emerald-600 dark:text-emerald-400">SUPPLY</div>
                        <div className="flex-1">
                          <Bar value={c.supply} max={maxCorridorDemand} colorClass="bg-emerald-500/80" height="h-2" />
                        </div>
                        <div className="text-[9px] w-16 text-right tabular-nums">{fmtNum(c.supply)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Reserve coverage per country */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Reserve coverage by country
            </CardTitle>
            <CardDescription>
              Reserves ÷ outstanding twin tokens — ratio of fiat backing per country.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {countries.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No countries in the digital twin yet.
                </div>
              ) : (
                countries.map((c) => (
                  <div key={c.country} className="rounded-lg border bg-card/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold">{c.country}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {c.currency}
                        </span>
                        <HealthBadge health={c.health} />
                      </div>
                      <div className="text-[11px] tabular-nums">
                        <span className="font-semibold">{fmtX(c.backingRatio, 2)}</span>
                        <span className="text-muted-foreground"> backing</span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <SectionLabel>Fiat / stablecoin mix</SectionLabel>
                      <div className="mt-1">
                        <StackedBar
                          segments={[
                            { label: 'Fiat', value: c.fiatReserves, colorClass: 'bg-emerald-500' },
                            { label: 'Stablecoin', value: c.stablecoinReserves, colorClass: 'bg-amber-500' },
                          ]}
                          height="h-2"
                        />
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Twin tokens: <span className="font-semibold text-foreground tabular-nums">{fmtUsd(c.twinTokenSupply)}</span></span>
                      <span>Coverage: <span className="font-semibold text-foreground tabular-nums">{fmtPct(c.reserveCoverage, 0)}</span></span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stablecoin inventory */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-amber-500" />
            Stablecoin inventory (treasury holdings)
          </CardTitle>
          <CardDescription>
            Stablecoin reserves per country — the treasury&apos;s depeg exposure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {countries
              .filter((c) => c.stablecoinReserves > 0)
              .sort((a, b) => b.stablecoinReserves - a.stablecoinReserves)
              .map((c) => (
                <div key={c.country} className="rounded-lg border bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold">{c.country}</span>
                    <Banknote className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                    {fmtUsd(c.stablecoinReserves)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {fmtPct(c.stablecoinReserves / ((c.fiatReserves + c.stablecoinReserves) || 1), 0)} of country reserves
                  </div>
                </div>
              ))}
            {countries.filter((c) => c.stablecoinReserves > 0).length === 0 && (
              <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                No stablecoin inventory recorded.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
