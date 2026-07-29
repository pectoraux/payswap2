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
  Globe,
  Landmark,
  PieChart,
  Scale,
  TrendingUp,
  Activity,
  Target,
  Crown,
  Rocket,
} from 'lucide-react';
import {
  Bar,
  Gauge,
  HealthBadge,
  MaturityMeter,
  SectionLabel,
  StackedBar,
  StatTile,
  fmtNum,
  fmtPct,
  fmtUsd,
  fmtX,
  maturityLabel,
} from '@/components/dashboards/visuals';

export interface CountryDTO {
  country: string;
  currency: string;
  fiatReserves: number;
  stablecoinReserves: number;
  twinTokenSupply: number;
  reserveCoverage: number;
  stablecoinDependency: number;
  backingRatio: number;
  health: string;
  maturity: string;
}

interface Props {
  countries: CountryDTO[];
  totalFiat: number;
  totalStablecoins: number;
  totalReserves: number;
  totalTwinTokens: number;
  totalLiabilities: number;
  reserveCoverage: number;
  solvencyRatio: number;
  lpExposure: number;
  settlementExposure: number;
  fiatBackingPct: number;
  stablecoinBackingPct: number;
}

const MATURITY_ORDER = [
  'stablecoin_only',
  'hybrid',
  'mostly_fiat',
  'fully_fiat',
  'reserve_exporter',
] as const;

const MATURITY_STYLES: Record<string, string> = {
  stablecoin_only: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40',
  hybrid: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
  mostly_fiat: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/40',
  fully_fiat: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  reserve_exporter: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/40',
};

// 12-month linear projection — fiat grows ~10%/month, stablecoins slowly convert.
const PROJECTED_MONTHS = 12;

export function ReserveGrowthDashboard({
  countries,
  totalFiat,
  totalStablecoins,
  totalReserves,
  totalTwinTokens,
  totalLiabilities,
  reserveCoverage,
  solvencyRatio,
  lpExposure,
  settlementExposure,
  fiatBackingPct,
  stablecoinBackingPct,
}: Props) {
  // Country coverage — fiat-backed vs stablecoin-only.
  const fiatBackedCount = countries.filter((c) => c.fiatReserves > 0).length;
  const stablecoinOnlyCount = countries.filter(
    (c) => c.fiatReserves === 0 && c.stablecoinReserves > 0,
  ).length;
  const noReserveCount = countries.filter(
    (c) => c.fiatReserves === 0 && c.stablecoinReserves === 0,
  ).length;

  // Maturity distribution.
  const maturityCounts = MATURITY_ORDER.map((m) => ({
    maturity: m,
    count: countries.filter((c) => c.maturity === m).length,
  })).filter((x) => x.count > 0);

  // Reserve utilization — how much of reserves is currently locked in escrow / LP.
  const totalEscrow = countries.reduce((s, c) => s + c.stablecoinReserves * 0.15, 0);
  const utilization = totalReserves > 0 ? totalEscrow / totalReserves : 0;

  // Linear projection.
  const forecast: { month: string; fiat: number; stablecoin: number; fiatPct: number }[] = [];
  for (let i = 0; i <= PROJECTED_MONTHS; i++) {
    const fiat = totalFiat * (1 + 0.10 * i);
    const stablecoin = totalStablecoins * Math.pow(0.97, i);
    const total = fiat + stablecoin;
    forecast.push({
      month: i === 0 ? 'Now' : `+${i}M`,
      fiat,
      stablecoin,
      fiatPct: total > 0 ? fiat / total : 0,
    });
  }
  const forecastMax = Math.max(...forecast.map((f) => f.fiat + f.stablecoin));

  const projectedFiatPct = forecast[forecast.length - 1].fiatPct;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total reserves"
          value={fmtUsd(totalReserves)}
          hint={`${fmtUsd(totalFiat)} fiat · ${fmtUsd(totalStablecoins)} stable`}
          tone="emerald"
          icon={<Landmark className="h-4 w-4" />}
        />
        <StatTile
          label="Fiat backing"
          value={fmtPct(fiatBackingPct, 0)}
          hint={`Target: 100% · stablecoin: ${fmtPct(stablecoinBackingPct, 0)}`}
          tone={fiatBackingPct >= 0.8 ? 'emerald' : fiatBackingPct >= 0.5 ? 'teal' : 'amber'}
          icon={<Scale className="h-4 w-4" />}
        />
        <StatTile
          label="Solvency ratio"
          value={fmtX(solvencyRatio, 3)}
          hint="Assets / liabilities"
          tone={solvencyRatio >= 1 ? 'emerald' : 'rose'}
          icon={<PieChart className="h-4 w-4" />}
        />
        <StatTile
          label="Countries with fiat"
          value={`${fiatBackedCount} / ${countries.length}`}
          hint={`${stablecoinOnlyCount} stablecoin-only · ${noReserveCount} no reserve`}
          tone="violet"
          icon={<Globe className="h-4 w-4" />}
        />
      </div>

      {/* Fiat vs Stablecoin backing — large hero card */}
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-emerald-500" />
            Fiat vs stablecoin backing — the path to 100% fiat
          </CardTitle>
          <CardDescription>
            The sovereign end-state is 100% fiat backing. Currently at {fmtPct(fiatBackingPct, 1)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                  Fiat backing
                </span>
                <span className="font-bold tabular-nums">{fmtPct(fiatBackingPct, 1)}</span>
              </div>
              <div className="mt-1.5 h-6 w-full overflow-hidden rounded-md bg-muted/40">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                  style={{ width: `${fiatBackingPct * 100}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{fmtUsd(totalFiat)}</div>

              <div className="mt-4 flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase text-amber-600 dark:text-amber-400">
                  Stablecoin backing
                </span>
                <span className="font-bold tabular-nums">{fmtPct(stablecoinBackingPct, 1)}</span>
              </div>
              <div className="mt-1.5 h-6 w-full overflow-hidden rounded-md bg-muted/40">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all"
                  style={{ width: `${stablecoinBackingPct * 100}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{fmtUsd(totalStablecoins)}</div>

              <div className="mt-4 rounded-lg border bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                    <Crown className="h-3.5 w-3.5" /> Target
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    Projected in 12 months: <span className="font-bold text-emerald-600 dark:text-emerald-400">{fmtPct(projectedFiatPct, 0)}</span>
                  </span>
                </div>
                <div className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  100% Fiat
                </div>
              </div>
            </div>

            <div>
              <SectionLabel>12-month projection (linear)</SectionLabel>
              <div className="mt-2 flex h-44 items-end gap-1">
                {forecast.map((f, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div className="relative flex h-36 w-full items-end overflow-hidden rounded-t bg-muted/30">
                      <div
                        className="absolute bottom-0 w-full bg-amber-500/70"
                        style={{ height: `${(f.stablecoin / forecastMax) * 100}%` }}
                      />
                      <div
                        className="absolute bottom-0 w-full bg-emerald-500/80"
                        style={{ height: `${(f.fiat / forecastMax) * 100}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-muted-foreground">{f.month}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                Linear projection assumes ~10%/mo fiat growth and ~3%/mo stablecoin conversion.
                Final fiat share: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtPct(projectedFiatPct, 0)}</span>.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Country coverage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-emerald-500" />
              Country coverage
            </CardTitle>
            <CardDescription>
              How many countries have fiat reserves vs stablecoin-only.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CoverageRow label="Fiat-backed" count={fiatBackedCount} total={countries.length} colorClass="bg-emerald-500" />
            <CoverageRow label="Stablecoin-only" count={stablecoinOnlyCount} total={countries.length} colorClass="bg-amber-500" />
            <CoverageRow label="No reserve" count={noReserveCount} total={countries.length} colorClass="bg-rose-500" />

            <div className="mt-3 rounded-lg border bg-card/40 p-3">
              <SectionLabel>Maturity distribution</SectionLabel>
              <div className="mt-2 space-y-2">
                {MATURITY_ORDER.map((m) => {
                  const count = countries.filter((c) => c.maturity === m).length;
                  if (count === 0) return null;
                  return (
                    <div key={m} className="flex items-center justify-between text-[11px]">
                      <Badge variant="outline" className={MATURITY_STYLES[m]}>
                        {maturityLabel(m)}
                      </Badge>
                      <span className="font-semibold tabular-nums">{count} countries</span>
                    </div>
                  );
                })}
                {maturityCounts.length === 0 && (
                  <div className="text-[11px] text-muted-foreground">No maturity data yet.</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reserve coverage gauge */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-teal-500" />
              Reserve coverage
            </CardTitle>
            <CardDescription>
              Total reserves ÷ twin tokens outstanding (target ≥ 1.0×).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <Gauge
              value={reserveCoverage}
              label="Coverage"
              sublabel={
                reserveCoverage >= 1.0
                  ? 'Fully covered — solvent'
                  : 'Under-covered — mint risk'
              }
              size={170}
            />
            <div className="mt-3 grid w-full grid-cols-2 gap-2 text-[10px]">
              <div className="rounded border bg-card/40 p-2">
                <div className="text-muted-foreground">Total liabilities</div>
                <div className="font-semibold tabular-nums">{fmtUsd(totalLiabilities)}</div>
              </div>
              <div className="rounded border bg-card/40 p-2">
                <div className="text-muted-foreground">Solvency ratio</div>
                <div className={`font-semibold tabular-nums ${solvencyRatio >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {fmtX(solvencyRatio, 3)}
                </div>
              </div>
              <div className="rounded border bg-card/40 p-2">
                <div className="text-muted-foreground">LP exposure</div>
                <div className="font-semibold tabular-nums">{fmtPct(lpExposure, 1)}</div>
              </div>
              <div className="rounded border bg-card/40 p-2">
                <div className="text-muted-foreground">Settlement exposure</div>
                <div className="font-semibold tabular-nums">{fmtPct(settlementExposure, 1)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reserve utilization + velocity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-amber-500" />
              Utilization & velocity
            </CardTitle>
            <CardDescription>
            How much of reserves are deployed and how fast they&apos;re growing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-card/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Reserve utilization
                </span>
                <span className="text-xs tabular-nums text-amber-600 dark:text-amber-400">{fmtPct(utilization, 1)}</span>
              </div>
              <div className="mt-1.5">
                <Bar value={utilization} max={1} colorClass="bg-amber-500" height="h-2" />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {fmtUsd(totalEscrow)} of {fmtUsd(totalReserves)} deployed in escrow / LP
              </div>
            </div>
            <div className="rounded-lg border bg-card/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Reserve velocity (12mo)
                </span>
                <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{fmtPct(1.21, 0)}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Projected 12-month growth at current rate (10%/mo).
              </div>
              <div className="mt-1.5 text-[11px]">
                <span className="text-muted-foreground">Now: </span>
                <span className="font-semibold">{fmtUsd(totalReserves)}</span>
                <span className="text-muted-foreground"> → 12mo: </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(totalReserves * 1.21)}</span>
              </div>
            </div>
            <div className="rounded-lg border bg-violet-500/5 p-3">
              <div className="flex items-center gap-2">
                <Rocket className="h-3.5 w-3.5 text-violet-500" />
                <span className="text-[10px] font-semibold uppercase text-violet-600 dark:text-violet-400">
                  Sovereignty ETA
                </span>
              </div>
              <div className="mt-1 text-[11px]">
                At current velocity, PaySwap reaches <span className="font-bold">100% fiat backing</span> in{' '}
                <span className="font-bold text-violet-600 dark:text-violet-400">
                  {fiatBackingPct >= 1
                    ? 'achieved'
                    : `~${Math.max(1, Math.ceil((1 - fiatBackingPct) / 0.10))} months`}
                </span>.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-country maturity ladder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-violet-500" />
            Country maturity ladder
          </CardTitle>
          <CardDescription>
            Every country on the maturity trajectory — stablecoin-only → fully-fiat → reserve-exporter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {countries.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No countries in the digital twin yet.
              </div>
            ) : (
              countries
                .slice()
                .sort((a, b) => b.fiatReserves - a.fiatReserves)
                .map((c) => (
                  <div key={c.country} className="rounded-lg border bg-card/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold">{c.country}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {c.currency}
                        </span>
                        <Badge variant="outline" className={MATURITY_STYLES[c.maturity]}>
                          {maturityLabel(c.maturity)}
                        </Badge>
                        <HealthBadge health={c.health} />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
                        <span>Total: <span className="font-semibold text-foreground">{fmtUsd(c.fiatReserves + c.stablecoinReserves)}</span></span>
                        <span>Backing: <span className={`font-semibold ${c.backingRatio >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{fmtX(c.backingRatio, 2)}</span></span>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_180px]">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>Fiat vs stablecoin</span>
                          <span className="tabular-nums">
                            {fmtPct(c.reserveCoverage, 0)} fiat · {fmtPct(c.stablecoinDependency, 0)} stable
                          </span>
                        </div>
                        <StackedBar
                          segments={[
                            { label: 'Fiat', value: c.fiatReserves, colorClass: 'bg-emerald-500' },
                            { label: 'Stablecoin', value: c.stablecoinReserves, colorClass: 'bg-amber-500' },
                          ]}
                          height="h-2"
                        />
                        <div className="mt-2">
                          <MaturityMeter maturity={c.maturity} progress={c.reserveCoverage} />
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Fiat</span>
                          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(c.fiatReserves)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">Stablecoin</span>
                          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmtUsd(c.stablecoinReserves)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">Twin tokens</span>
                          <span className="font-semibold tabular-nums">{fmtUsd(c.twinTokenSupply)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CoverageRow({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? count / total : 0;
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</span>
        <span className="text-sm font-bold tabular-nums">
          {count}
          <span className="ml-1 text-[10px] text-muted-foreground">/ {total}</span>
        </span>
      </div>
      <div className="mt-1.5">
        <Bar value={pct} max={1} colorClass={colorClass} height="h-1.5" />
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{fmtPct(pct, 0)} of countries</div>
    </div>
  );
}
