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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Vault,
  Coins,
  Scale,
  TrendingUp,
  Activity,
  MapPin,
  ArrowUpRight,
  Lightbulb,
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
  bandwidth: number;
  activeLPs: number;
  reserveCoverage: number;
  stablecoinDependency: number;
  backingRatio: number;
  health: string;
  maturity: string;
}

export interface RecommendationDTO {
  kind: 'capital' | 'inventory';
  id: string;
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

export interface ReserveEvolutionDTO {
  country: string;
  currentMaturity: string;
  targetMaturity: string;
  fiatRatio: number;
  stablecoinRatio: number;
  evolutionProgress: number;
  recommendedActions: string[];
}

interface Props {
  countries: CountryDTO[];
  totalFiat: number;
  totalStablecoins: number;
  totalReserves: number;
  twinTokenSupply: number;
  backingRatio: number;
  fiatBackingPct: number;
  stablecoinBackingPct: number;
  recommendations: RecommendationDTO[];
  reserveEvolution: ReserveEvolutionDTO[];
}

const APPROVAL_STYLES: Record<string, string> = {
  automatic: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  operator_approval: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  treasury_approval: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  governance_vote: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  constitution_forbidden: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

// Linear projection: assume each country grows fiat 8%/month, stablecoins 4%/month.
const PROJECTED_MONTHS = 6;

export function ControlCenterViewer({
  countries,
  totalFiat,
  totalStablecoins,
  totalReserves,
  twinTokenSupply,
  backingRatio,
  fiatBackingPct,
  stablecoinBackingPct,
  recommendations,
  reserveEvolution,
}: Props) {
  const maxCountryReserve = Math.max(
    1,
    ...countries.map((c) => c.fiatReserves + c.stablecoinReserves),
  );

  // Linear projection of total reserves over PROJECTED_MONTHS months.
  const monthlyGrowth = totalReserves * 0.06;
  const forecast: { month: string; fiat: number; stablecoin: number; total: number }[] = [];
  for (let i = 0; i <= PROJECTED_MONTHS; i++) {
    forecast.push({
      month: i === 0 ? 'Now' : `+${i}M`,
      fiat: totalFiat * (1 + 0.08 * i),
      stablecoin: totalStablecoins * (1 + 0.04 * i),
      total: 0,
    });
  }
  forecast.forEach((f) => (f.total = f.fiat + f.stablecoin));
  const forecastMax = Math.max(...forecast.map((f) => f.total));

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total reserves"
          value={fmtUsd(totalReserves)}
          hint={`${countries.length} countries · ${fmtUsd(totalFiat)} fiat`}
          tone="emerald"
          icon={<Vault className="h-4 w-4" />}
        />
        <StatTile
          label="Stablecoin inventory"
          value={fmtUsd(totalStablecoins)}
          hint={fmtPct(stablecoinBackingPct, 0) + ' of reserves'}
          tone="amber"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatTile
          label="Twin tokens outstanding"
          value={fmtUsd(twinTokenSupply)}
          hint={fmtX(backingRatio, 3) + ' backing'}
          tone="violet"
          icon={<Scale className="h-4 w-4" />}
        />
        <StatTile
          label="Countries tracked"
          value={countries.length}
          hint={`${countries.filter((c) => c.maturity === 'fully_fiat' || c.maturity === 'reserve_exporter').length} fully fiat-backed`}
          tone="teal"
          icon={<MapPin className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Twin Token Backing Gauge — prominent */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-emerald-500" />
              Twin Token Backing
            </CardTitle>
            <CardDescription>
              Total reserves ÷ twin tokens outstanding (target ≥ 1.0×)
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
                  Fiat backed
                </span>
                <span className="tabular-nums">{fmtPct(fiatBackingPct, 1)}</span>
              </div>
              <Bar
                value={fiatBackingPct}
                max={1}
                colorClass="bg-emerald-500"
              />
              <div className="flex items-center justify-between pt-1 text-[11px]">
                <span className="font-semibold uppercase text-amber-600 dark:text-amber-400">
                  Stablecoin backed
                </span>
                <span className="tabular-nums">{fmtPct(stablecoinBackingPct, 1)}</span>
              </div>
              <Bar
                value={stablecoinBackingPct}
                max={1}
                colorClass="bg-amber-500"
              />
            </div>
          </CardContent>
        </Card>

        {/* Reserve Forecast */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-teal-500" />
              Reserve forecast (6-month linear projection)
            </CardTitle>
            <CardDescription>
              Linear projection from current reserve trajectory · monthly growth ~{fmtUsd(monthlyGrowth)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-56 items-end gap-3">
              {forecast.map((f, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="relative flex h-44 w-full items-end overflow-hidden rounded-t-md bg-muted/30">
                          <div
                            className="absolute bottom-0 w-full bg-amber-500/70"
                            style={{ height: `${(f.stablecoin / forecastMax) * 100}%` }}
                          />
                          <div
                            className="absolute bottom-0 w-full bg-emerald-500/80"
                            style={{ height: `${(f.fiat / forecastMax) * 100}%` }}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-[11px]">
                          <div className="font-semibold">{f.month}</div>
                          <div>Fiat: {fmtUsd(f.fiat)}</div>
                          <div>Stable: {fmtUsd(f.stablecoin)}</div>
                          <div>Total: {fmtUsd(f.total)}</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <div className="text-[10px] font-medium text-muted-foreground">{f.month}</div>
                  <div className="text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
                    {fmtUsd(f.total)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Fiat reserves
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Stablecoin reserves
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reserve utilization per country */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-emerald-500" />
            Reserve utilization by country
          </CardTitle>
          <CardDescription>
            Fiat vs stablecoin reserves, twin-token backing, maturity stage and health for every country in the twin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {countries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No country reserves yet — the digital twin will populate as treasury accounts are opened.
            </div>
          ) : (
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {countries.map((c) => {
                const total = c.fiatReserves + c.stablecoinReserves;
                return (
                  <div key={c.country} className="rounded-lg border bg-card/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold">{c.country}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {c.currency}
                        </span>
                        <HealthBadge health={c.health} />
                      </div>
                      <div className="flex items-center gap-3 text-[11px] tabular-nums">
                        <span className="text-muted-foreground">
                          Total: <span className="font-semibold text-foreground">{fmtUsd(total)}</span>
                        </span>
                        <span className="text-muted-foreground">
                          LPs: <span className="font-semibold text-foreground">{c.activeLPs}</span>
                        </span>
                        <span className="text-muted-foreground">
                          BW: <span className="font-semibold text-foreground">{fmtUsd(c.bandwidth)}</span>
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-[1fr_180px]">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>Fiat vs stablecoin reserves</span>
                          <span className="tabular-nums">
                            {fmtPct(c.reserveCoverage, 0)} fiat · {fmtPct(c.stablecoinDependency, 0)} stable
                          </span>
                        </div>
                        <StackedBar
                          segments={[
                            { label: 'Fiat', value: c.fiatReserves, colorClass: 'bg-emerald-500' },
                            { label: 'Stablecoin', value: c.stablecoinReserves, colorClass: 'bg-amber-500' },
                          ]}
                          height="h-3"
                        />
                        <div className="mt-1.5 flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground">{maturityLabel(c.maturity)}</span>
                          <span className="text-muted-foreground">
                            Backing: <span className={c.backingRatio >= 1 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-rose-600 dark:text-rose-400'}>
                              {fmtX(c.backingRatio, 2)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1">
                          <MaturityMeter maturity={c.maturity} progress={c.reserveCoverage} />
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/30 p-2 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Twin tokens</span>
                          <span className="font-semibold tabular-nums">{fmtUsd(c.twinTokenSupply)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">Fiat</span>
                          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmtUsd(c.fiatReserves)}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">Stablecoin</span>
                          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmtUsd(c.stablecoinReserves)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rebalance Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Rebalance recommendations
            </CardTitle>
            <CardDescription>
              Live output from runtime.controlPlane — capital allocations + inventory actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recommendations.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                All clear — no rebalance recommendations at this time.
              </div>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {recommendations.map((r) => (
                  <div key={r.id} className="rounded-lg border bg-card/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            r.kind === 'capital'
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                              : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                          }
                        >
                          {r.action}
                        </Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {r.country}
                          {r.currency ? ` · ${r.currency}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold tabular-nums">{fmtUsd(r.amount)}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${APPROVAL_STYLES[r.approvalClass] ?? 'bg-muted text-muted-foreground'}`}
                        >
                          {r.approvalClass.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground">{r.reason}</div>
                    {r.kind === 'capital' && (
                      <div className="mt-2 flex flex-wrap gap-3 text-[10px] tabular-nums text-muted-foreground">
                        <span>ROI: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{(r.expectedROI * 100).toFixed(1)}%</span></span>
                        <span>Risk: <span className="font-semibold text-amber-600 dark:text-amber-400">{(r.expectedRisk * 100).toFixed(1)}%</span></span>
                        <span>Conf: <span className="font-semibold">{(r.confidence * 100).toFixed(0)}%</span></span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reserve Evolution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowUpRight className="h-4 w-4 text-violet-500" />
              Reserve evolution plan
            </CardTitle>
            <CardDescription>
              Maturity trajectory for each country — stablecoin-only → fully-fiat → reserve-exporter.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reserveEvolution.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No evolution plans yet.
              </div>
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {reserveEvolution.map((e) => (
                  <div key={e.country} className="rounded-lg border bg-card/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold">{e.country}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {maturityLabel(e.currentMaturity)} → {maturityLabel(e.targetMaturity)}
                        </span>
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {fmtPct(e.evolutionProgress, 0)} progress
                      </span>
                    </div>
                    <div className="mt-2">
                      <SectionLabel>Fiat / stablecoin mix</SectionLabel>
                      <div className="mt-1">
                        <StackedBar
                          segments={[
                            { label: 'Fiat', value: e.fiatRatio, colorClass: 'bg-emerald-500' },
                            { label: 'Stablecoin', value: e.stablecoinRatio, colorClass: 'bg-amber-500' },
                          ]}
                          height="h-2"
                        />
                      </div>
                    </div>
                    {e.recommendedActions.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                        {e.recommendedActions.map((a, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="mt-0.5 text-amber-500">›</span>
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stablecoin inventory table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-amber-500" />
            Stablecoin inventory by country
          </CardTitle>
          <CardDescription>
            Stablecoin reserves per country — exposure to depeg risk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-y-auto pr-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-[10px] uppercase text-muted-foreground">
                  <th className="pb-2">Country</th>
                  <th className="pb-2">Currency</th>
                  <th className="pb-2 text-right">Stablecoin</th>
                  <th className="pb-2 text-right">% of country</th>
                  <th className="pb-2 w-1/3">Bar</th>
                </tr>
              </thead>
              <tbody>
                {countries
                  .slice()
                  .sort((a, b) => b.stablecoinReserves - a.stablecoinReserves)
                  .map((c) => {
                    const total = c.fiatReserves + c.stablecoinReserves || 1;
                    return (
                      <tr key={c.country} className="border-b last:border-0">
                        <td className="py-2 font-mono font-semibold">{c.country}</td>
                        <td className="py-2 text-muted-foreground">{c.currency}</td>
                        <td className="py-2 text-right font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                          {fmtUsd(c.stablecoinReserves)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{fmtPct(c.stablecoinDependency, 0)}</td>
                        <td className="py-2">
                          <Bar
                            value={c.stablecoinReserves}
                            max={maxCountryReserve}
                            colorClass="bg-amber-500"
                            height="h-1.5"
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
