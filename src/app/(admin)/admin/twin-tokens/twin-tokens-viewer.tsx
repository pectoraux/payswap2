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
import {
  Coins,
  Flame,
  Gauge as GaugeIcon,
  Globe,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
  Activity,
} from 'lucide-react';
import {
  Bar,
  Gauge,
  SectionLabel,
  StackedBar,
  StatTile,
  fmtNum,
  fmtPct,
  fmtUsd,
  fmtX,
} from '@/components/dashboards/visuals';

export interface TwinTokenDTO {
  accountId: string;
  tokenType: string;
  currency: string;
  balance: number;
}

export interface CountryDTO {
  country: string;
  currency: string;
  twinTokenSupply: number;
  fiatReserves: number;
  stablecoinReserves: number;
  backingRatio: number;
}

interface Props {
  totalSupply: number;
  totalBacking: number;
  backingRatio: number;
  backedByFiat: number;
  backedByStablecoins: number;
  fiatBackingPct: number;
  stablecoinBackingPct: number;
  reserveRatio: number;
  mintedTodayCount: number;
  mintedTodayAmount: number;
  burnedTodayCount: number;
  burnedTodayAmount: number;
  circulation: number;
  outstandingLiabilities: number;
  twinTokenSupplyByCurrency: { currency: string; amount: number }[];
  positions: TwinTokenDTO[];
  countries: CountryDTO[];
}

const TOKEN_TYPE_STYLES: Record<string, string> = {
  claim: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  settlement: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  reserve: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  liquidity: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};

export function TwinTokensDashboard({
  totalSupply,
  totalBacking,
  backingRatio,
  backedByFiat,
  backedByStablecoins,
  fiatBackingPct,
  stablecoinBackingPct,
  reserveRatio,
  mintedTodayCount,
  mintedTodayAmount,
  burnedTodayCount,
  burnedTodayAmount,
  circulation,
  outstandingLiabilities,
  twinTokenSupplyByCurrency,
  positions,
  countries,
}: Props) {
  const netMintToday = mintedTodayAmount - burnedTodayAmount;
  const maxSupplyByCurrency = Math.max(
    1,
    ...twinTokenSupplyByCurrency.map((s) => s.amount),
  );

  return (
    <div className="space-y-6">
      {/* Top KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total twin-token supply"
          value={fmtUsd(totalSupply)}
          hint={`${twinTokenSupplyByCurrency.length} currencies`}
          tone="violet"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatTile
          label="Reserve backing"
          value={fmtUsd(totalBacking)}
          hint={fmtX(backingRatio, 3) + ' backing ratio'}
          tone="emerald"
          icon={<Scale className="h-4 w-4" />}
        />
        <StatTile
          label="Net minted today"
          value={fmtUsd(netMintToday)}
          hint={`${mintedTodayCount} minted · ${burnedTodayCount} burned`}
          tone={netMintToday >= 0 ? 'teal' : 'amber'}
          icon={netMintToday >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        />
        <StatTile
          label="Outstanding liabilities"
          value={fmtUsd(outstandingLiabilities)}
          hint="Twin tokens owed to holders"
          tone="amber"
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Backing gauge — prominent */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GaugeIcon className="h-4 w-4 text-emerald-500" />
              Reserve backing
            </CardTitle>
            <CardDescription>
              Total reserves ÷ twin tokens (target ≥ 1.0×)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <Gauge
              value={backingRatio}
              label="Backing ratio"
              sublabel={
                backingRatio >= 1.0
                  ? 'Fully backed — solvent'
                  : 'Under-backed — increase reserves'
              }
              size={180}
            />
            <div className="mt-4 w-full space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                  Fiat backing
                </span>
                <span className="tabular-nums">{fmtPct(fiatBackingPct, 1)}</span>
              </div>
              <Bar value={fiatBackingPct} max={1} colorClass="bg-emerald-500" />
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="font-semibold uppercase text-amber-600 dark:text-amber-400">
                  Stablecoin backing
                </span>
                <span className="tabular-nums">{fmtPct(stablecoinBackingPct, 1)}</span>
              </div>
              <Bar value={stablecoinBackingPct} max={1} colorClass="bg-amber-500" />
            </div>
          </CardContent>
        </Card>

        {/* Mint / Burn activity today */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-teal-500" />
              Mint / burn activity (24h)
            </CardTitle>
            <CardDescription>
              Daily twin-token mint and burn events.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                  <TrendingUp className="h-3.5 w-3.5" /> Minted today
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {mintedTodayCount} events
                </span>
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                +{fmtUsd(mintedTodayAmount)}
              </div>
            </div>
            <div className="rounded-lg border bg-rose-500/5 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">
                  <Flame className="h-3.5 w-3.5" /> Burned today
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {burnedTodayCount} events
                </span>
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                −{fmtUsd(burnedTodayAmount)}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Net change
                </span>
                <span className={`text-lg font-bold tabular-nums ${netMintToday >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {netMintToday >= 0 ? '+' : '−'}
                  {fmtUsd(Math.abs(netMintToday))}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Circulation + coverage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4 text-violet-500" />
              Circulation & coverage
            </CardTitle>
            <CardDescription>
              Tokens in circulation vs total reserve coverage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-card/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                In circulation (custodial wallets)
              </div>
              <div className="mt-1 text-xl font-bold tabular-nums">
                {fmtUsd(circulation)}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {fmtPct(totalSupply > 0 ? circulation / totalSupply : 0, 1)} of total supply
              </div>
            </div>
            <div className="rounded-lg border bg-card/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Reserve ratio
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-xl font-bold tabular-nums ${reserveRatio >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {fmtX(reserveRatio, 3)}
                </span>
                {reserveRatio >= 1 ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400">
                    FULLY BACKED
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-rose-500/40 text-[10px] text-rose-600 dark:text-rose-400">
                    UNDER-BACKED
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                Reserves / twin tokens outstanding
              </div>
            </div>
            <div className="rounded-lg border bg-card/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Backed by
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <div className="text-muted-foreground">Fiat</div>
                  <div className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(backedByFiat)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Stablecoin</div>
                  <div className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmtUsd(backedByStablecoins)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Supply by currency */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4 text-violet-500" />
              Supply by currency
            </CardTitle>
            <CardDescription>
              Twin tokens outstanding per currency.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {twinTokenSupplyByCurrency.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No twin tokens minted yet.
                </div>
              ) : (
                twinTokenSupplyByCurrency
                  .slice()
                  .sort((a, b) => b.amount - a.amount)
                  .map((s) => (
                    <div key={s.currency} className="rounded-lg border bg-card/40 p-2">
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-600 dark:text-violet-400">
                          {s.currency}
                        </span>
                        <span className="font-semibold tabular-nums">{fmtUsd(s.amount)}</span>
                      </div>
                      <div className="mt-1.5">
                        <Bar value={s.amount} max={maxSupplyByCurrency} colorClass="bg-violet-500" height="h-1.5" />
                      </div>
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Per-country twin-token supply vs backing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-emerald-500" />
              Per-country twin tokens vs backing
            </CardTitle>
            <CardDescription>
              Twin-token supply per country, with the local backing ratio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {countries.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No country twin-token data yet.
                </div>
              ) : (
                countries
                  .slice()
                  .sort((a, b) => b.twinTokenSupply - a.twinTokenSupply)
                  .map((c) => (
                    <div key={c.country} className="rounded-lg border bg-card/40 p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold">{c.country}</span>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-muted-foreground">Supply</span>
                          <span className="font-semibold tabular-nums">{fmtUsd(c.twinTokenSupply)}</span>
                          <span className="text-muted-foreground">Backing</span>
                          <span className={`font-semibold tabular-nums ${c.backingRatio >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {fmtX(c.backingRatio, 2)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-1.5">
                        <SectionLabel>Reserve mix</SectionLabel>
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
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Twin token positions table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-emerald-500" />
            Twin token positions
          </CardTitle>
          <CardDescription>
            Every twin-token position in the runtime — derived from events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 overflow-y-auto pr-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-[10px] uppercase text-muted-foreground">
                  <th className="py-2">Account</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Currency</th>
                  <th className="py-2 text-right">Balance</th>
                  <th className="py-2 w-1/3">Bar</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No twin-token positions yet.
                    </td>
                  </tr>
                ) : (
                  positions
                    .slice()
                    .sort((a, b) => b.balance - a.balance)
                    .map((p, i) => {
                      const maxBalance = Math.max(...positions.map((x) => x.balance), 1);
                      return (
                        <tr key={`${p.accountId}-${p.tokenType}-${p.currency}-${i}`} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 font-mono text-[10px]">{p.accountId}</td>
                          <td className="py-2">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${TOKEN_TYPE_STYLES[p.tokenType] ?? 'bg-muted text-muted-foreground'}`}>
                              {p.tokenType}
                            </span>
                          </td>
                          <td className="py-2 text-muted-foreground">{p.currency}</td>
                          <td className="py-2 text-right font-semibold tabular-nums">{fmtNum(p.balance, 2)}</td>
                          <td className="py-2">
                            <Bar value={p.balance} max={maxBalance} colorClass="bg-violet-500" height="h-1.5" />
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
    </div>
  );
}
