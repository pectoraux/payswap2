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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowRight,
  ArrowRightCircle,
  Banknote,
  Coins,
  Cpu,
  GitBranch,
  Layers,
  Network,
  Play,
  RotateCcw,
  Scale,
  Send,
  Shield,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { liquidityPolicyEngine } from '@/runtime/liquidity';
import type {
  PolicyEngineInput,
  ReserveState,
  BandwidthPosition,
  BandwidthAssetType,
  LiquidityExecutionPlan,
  SettlementStrategy,
} from '@/runtime/liquidity';
import {
  SectionLabel,
  StackedBar,
  StatTile,
  fmtNum,
  fmtPct,
  fmtUsd,
  fmtX,
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
  bandwidth: number;
  activeLPs: number;
}

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
}

interface Props {
  countries: CountryDTO[];
  bandwidth: BandwidthDTO[];
}

// ─── Strategy metadata ──────────────────────────────────────────────────────

const STRATEGY_INFO: Record<
  SettlementStrategy,
  { label: string; color: string; description: string }
> = {
  LOCAL_RAIL: {
    label: 'LOCAL RAIL',
    color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
    description: 'Same-country transfer — no stablecoins, no LPs. Settles directly through the local rail.',
  },
  RESERVE_TO_RESERVE: {
    label: 'RESERVE → RESERVE',
    color: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/40',
    description: 'Both countries have fiat reserves. Mint twin tokens at the sender, redeem at the receiver.',
  },
  RESERVE_TO_MARKET: {
    label: 'RESERVE → MARKET',
    color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
    description: 'Sender has a reserve, receiver does not. Purchase stablecoins and route through LP/marketplace on the receiver side.',
  },
  MARKET_TO_RESERVE: {
    label: 'MARKET → RESERVE',
    color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/40',
    description: 'Sender has no reserve, receiver does. Obtain stablecoins locally, redeem into the receiver reserve.',
  },
  MARKET_TO_MARKET: {
    label: 'MARKET → MARKET',
    color: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/40',
    description: 'Neither country has a reserve. Stablecoins bridge both sides through LP bandwidth and marketplace escrow.',
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function toReserveState(c: CountryDTO | undefined, country: string): ReserveState {
  if (!c) {
    return {
      country,
      currency: 'USD',
      hasFiatReserve: false,
      fiatReserveAmount: 0,
      hasStablecoinReserve: false,
      stablecoinReserveAmount: 0,
      maturity: 'stablecoin_only',
    };
  }
  return {
    country: c.country,
    currency: c.currency,
    hasFiatReserve: c.fiatReserves > 0,
    fiatReserveAmount: c.fiatReserves,
    hasStablecoinReserve: c.stablecoinReserves > 0,
    stablecoinReserveAmount: c.stablecoinReserves,
    maturity: c.maturity as ReserveState['maturity'],
  };
}

function pickBandwidth(
  bandwidth: BandwidthDTO[],
  country: string,
): BandwidthPosition[] {
  return bandwidth
    .filter((b) => b.country === country)
    .map((b) => ({
      lpId: b.lpId,
      country: b.country,
      assetType: b.assetType as BandwidthAssetType,
      currency: b.currency,
      capacity: b.capacity,
      reserved: b.reserved,
      used: b.used,
      available: b.available,
      escrow: b.escrow,
      bond: b.bond,
      status: b.status as BandwidthPosition['status'],
      participationMode: b.participationMode as BandwidthPosition['participationMode'],
    }));
}

const PIPELINE_STAGES = [
  { key: 'intent', label: 'Intent', icon: Send },
  { key: 'strategy', label: 'Strategy', icon: GitBranch },
  { key: 'reserves', label: 'Reserve Graph', icon: Scale },
  { key: 'marketplace', label: 'Marketplace', icon: Network },
  { key: 'lp', label: 'LP Selection', icon: Wallet },
  { key: 'twin', label: 'Twin Tokens', icon: Coins },
  { key: 'settlement', label: 'Settlement', icon: Shield },
  { key: 'confirm', label: 'Confirmation', icon: Sparkles },
];

export function CompilerExplorer({ countries, bandwidth }: Props) {
  const fromOptions = countries;
  const toOptions = countries;

  const defaultFrom = fromOptions[0]?.country ?? 'GH';
  const defaultTo = toOptions[1]?.country ?? 'KE';
  const defaultFromCurrency =
    fromOptions.find((c) => c.country === defaultFrom)?.currency ?? 'GHS';
  const defaultToCurrency =
    toOptions.find((c) => c.country === defaultTo)?.currency ?? 'KES';

  const [amount, setAmount] = React.useState<number>(500);
  const [fromCountry, setFromCountry] = React.useState<string>(defaultFrom);
  const [toCountry, setToCountry] = React.useState<string>(defaultTo);
  const [fromCurrency, setFromCurrency] = React.useState<string>(defaultFromCurrency);
  const [toCurrency, setToCurrency] = React.useState<string>(defaultToCurrency);
  const [fxRate, setFxRate] = React.useState<number>(1);
  const [plan, setPlan] = React.useState<LiquidityExecutionPlan | null>(null);
  const [activeStage, setActiveStage] = React.useState<number>(-1);

  // Auto-pick currencies + fx rate when countries change.
  React.useEffect(() => {
    const from = countries.find((c) => c.country === fromCountry);
    const to = countries.find((c) => c.country === toCountry);
    if (from) setFromCurrency(from.currency);
    if (to) setToCurrency(to.currency);
    // Synthetic FX rate derived from backing ratio difference (deterministic).
    const r1 = from?.backingRatio ?? 1;
    const r2 = to?.backingRatio ?? 1;
    setFxRate(Number((r2 / (r1 || 1)).toFixed(4)) || 1);
  }, [fromCountry, toCountry, countries]);

  const compile = React.useCallback(() => {
    const sender = countries.find((c) => c.country === fromCountry);
    const receiver = countries.find((c) => c.country === toCountry);
    const senderBW = pickBandwidth(bandwidth, fromCountry);
    const receiverBW = pickBandwidth(bandwidth, toCountry);

    // Treasury stablecoins aggregated across all countries (USDC).
    const treasuryStablecoins = [
      {
        currency: 'USDC',
        amount: countries.reduce((s, c) => s + c.stablecoinReserves, 0),
      },
    ];

    const input: PolicyEngineInput = {
      fromCountry,
      toCountry,
      fromCurrency,
      toCurrency,
      amount,
      fxRate,
      senderReserve: toReserveState(sender, fromCountry),
      receiverReserve: toReserveState(receiver, toCountry),
      senderBandwidth: senderBW,
      receiverBandwidth: receiverBW,
      treasuryStablecoins,
    };

    const result = liquidityPolicyEngine.compile(input);
    setPlan(result);
    setActiveStage(-1);
    // Animate through the pipeline stages.
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setActiveStage(i);
      if (i >= PIPELINE_STAGES.length) clearInterval(interval);
    }, 180);
  }, [amount, fromCountry, toCountry, fromCurrency, toCurrency, fxRate, countries, bandwidth]);

  // Auto-compile on first mount so the dashboard isn't empty.
  React.useEffect(() => {
    compile();
  }, []);

  const reset = () => {
    setPlan(null);
    setActiveStage(-1);
  };

  const sender = countries.find((c) => c.country === fromCountry);
  const receiver = countries.find((c) => c.country === toCountry);

  return (
    <div className="space-y-6">
      {/* Payment input form */}
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.03] to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-emerald-500" />
            Payment intent
          </CardTitle>
          <CardDescription>
            Compile a payment through the liquidity policy engine. The engine is a pure function — same inputs always produce the same plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-7">
            <div className="md:col-span-1">
              <Label className="text-[10px] font-semibold uppercase text-muted-foreground">Amount</Label>
              <Input
                type="number"
                value={amount}
                min={1}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px] font-semibold uppercase text-muted-foreground">From country</Label>
              <Select value={fromCountry} onValueChange={setFromCountry}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fromOptions.map((c) => (
                    <SelectItem key={c.country} value={c.country}>
                      {c.country} · {c.currency}
                    </SelectItem>
                  ))}
                  {fromOptions.length === 0 && <SelectItem value={fromCountry}>{fromCountry}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px] font-semibold uppercase text-muted-foreground">To country</Label>
              <Select value={toCountry} onValueChange={setToCountry}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {toOptions.map((c) => (
                    <SelectItem key={c.country} value={c.country}>
                      {c.country} · {c.currency}
                    </SelectItem>
                  ))}
                  {toOptions.length === 0 && <SelectItem value={toCountry}>{toCountry}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-1">
              <Label className="text-[10px] font-semibold uppercase text-muted-foreground">FX rate</Label>
              <Input
                type="number"
                step="0.0001"
                value={fxRate}
                onChange={(e) => setFxRate(Number(e.target.value) || 0)}
                className="mt-1"
              />
            </div>
            <div className="flex items-end gap-2 md:col-span-1">
              <Button onClick={compile} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">
                <Play className="h-4 w-4" />
                Compile
              </Button>
              <Button onClick={reset} variant="outline" size="icon">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Reserve summary for the selected countries */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ReserveSummaryCard label="Sender reserve" country={sender} currency={fromCurrency} />
            <ReserveSummaryCard label="Receiver reserve" country={receiver} currency={toCurrency} />
          </div>
        </CardContent>
      </Card>

      {/* Strategy badge */}
      {plan && (
        <Card className="border-emerald-500/30 bg-emerald-500/[0.02]">
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <GitBranch className="h-6 w-6" />
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Selected strategy
                </div>
                <div className="text-lg font-bold">
                  {STRATEGY_INFO[plan.strategy].label}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {STRATEGY_INFO[plan.strategy].description}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Badge variant="outline" className={STRATEGY_INFO[plan.strategy].color}>
                {plan.strategy}
              </Badge>
              <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                {plan.feeModel.totalFeeBps} bps total fee
              </Badge>
              <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-400">
                LP {plan.feeModel.lpSharePercent}% · PaySwap {plan.feeModel.payswapSharePercent}%
              </Badge>
              {plan.stablecoinUsage.required && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                  <Coins className="mr-1 h-3 w-3" /> {fmtUsd(plan.stablecoinUsage.amount)} {plan.stablecoinUsage.currency}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Visual pipeline */}
      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-amber-500" />
              Settlement pipeline
            </CardTitle>
            <CardDescription>
              Each stage of the compiled plan, with the deterministic decision and explanation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 overflow-x-auto pb-3">
              {PIPELINE_STAGES.map((s, i) => {
                const Icon = s.icon;
                const isReached = i <= activeStage;
                const isCurrent = i === activeStage;
                return (
                  <React.Fragment key={s.key}>
                    <div
                      className={`flex min-w-[100px] flex-col items-center rounded-lg border p-2 transition-all ${
                        isCurrent
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : isReached
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'border-muted bg-card/30'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 ${
                          isCurrent
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isReached
                              ? 'text-emerald-500/70'
                              : 'text-muted-foreground'
                        }`}
                      />
                      <div
                        className={`mt-1 text-[10px] font-semibold uppercase ${
                          isCurrent ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                        }`}
                      >
                        {s.label}
                      </div>
                    </div>
                    {i < PIPELINE_STAGES.length - 1 && (
                      <ArrowRight
                        className={`h-3.5 w-3.5 shrink-0 ${
                          i < activeStage ? 'text-emerald-500/60' : 'text-muted-foreground/40'
                        }`}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {/* Stage: Intent */}
              <StageCard
                title="1 · Intent"
                icon={<Send className="h-4 w-4" />}
                description="The payment intent captured before compilation."
              >
                <KV k="From" v={`${fromCountry} · ${fromCurrency}`} />
                <KV k="To" v={`${toCountry} · ${toCurrency}`} />
                <KV k="Amount" v={`${fmtNum(amount, 2)} ${fromCurrency}`} />
                <KV k="FX rate" v={fmtX(fxRate, 4)} />
                <KV k="Recipient receives" v={`${fmtNum(amount * fxRate, 2)} ${toCurrency}`} />
              </StageCard>

              {/* Stage: Strategy */}
              <StageCard
                title="2 · Strategy selected"
                icon={<GitBranch className="h-4 w-4" />}
                description="Deterministic strategy chosen from reserve availability."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={STRATEGY_INFO[plan.strategy].color}>{plan.strategy}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {STRATEGY_INFO[plan.strategy].description}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded border bg-card/40 p-2">
                    <div className="text-[10px] text-muted-foreground">Sender has fiat reserve</div>
                    <div className="font-semibold">{plan.fromCountry === plan.toCountry ? 'N/A (local)' : (sender?.fiatReserves ?? 0) > 0 ? 'YES' : 'NO'}</div>
                  </div>
                  <div className="rounded border bg-card/40 p-2">
                    <div className="text-[10px] text-muted-foreground">Receiver has fiat reserve</div>
                    <div className="font-semibold">{plan.fromCountry === plan.toCountry ? 'N/A (local)' : (receiver?.fiatReserves ?? 0) > 0 ? 'YES' : 'NO'}</div>
                  </div>
                </div>
              </StageCard>

              {/* Stage: Reserve graph */}
              <StageCard
                title="3 · Reserve graph"
                icon={<Scale className="h-4 w-4" />}
                description="Treasury actions to credit/debit reserves and mint/burn twin tokens."
              >
                {plan.treasuryActions.length === 0 ? (
                  <Empty>No treasury actions for this strategy.</Empty>
                ) : (
                  <div className="space-y-1.5">
                    {plan.treasuryActions.map((a, i) => (
                      <ActionRow
                        key={i}
                        kind="treasury"
                        type={a.type}
                        country={a.country ?? '—'}
                        currency={a.currency}
                        amount={a.amount}
                        reason={a.reason}
                      />
                    ))}
                  </div>
                )}
              </StageCard>

              {/* Stage: Marketplace */}
              <StageCard
                title="4 · Marketplace"
                icon={<Network className="h-4 w-4" />}
                description="Stablecoin sourcing + escrow requirements."
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border bg-card/40 p-2">
                    <div className="text-[10px] text-muted-foreground">Stablecoin required</div>
                    <div className={`font-semibold ${plan.stablecoinUsage.required ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {plan.stablecoinUsage.required ? 'YES' : 'NO'}
                    </div>
                  </div>
                  <div className="rounded border bg-card/40 p-2">
                    <div className="text-[10px] text-muted-foreground">Source</div>
                    <div className="font-semibold uppercase text-muted-foreground">{plan.stablecoinUsage.source}</div>
                  </div>
                </div>
                {plan.stablecoinUsage.required && (
                  <div className="mt-2 rounded border bg-amber-500/5 p-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Stablecoin amount</span>
                      <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                        {fmtUsd(plan.stablecoinUsage.amount)} {plan.stablecoinUsage.currency}
                      </span>
                    </div>
                  </div>
                )}
                {plan.requiredEscrow.length > 0 && (
                  <div className="mt-2">
                    <SectionLabel>Escrow required</SectionLabel>
                    <div className="mt-1 space-y-1">
                      {plan.requiredEscrow.map((e, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="font-mono text-muted-foreground">{e.assetType} · {e.currency}</span>
                          <span className="font-semibold tabular-nums">{fmtUsd(e.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </StageCard>

              {/* Stage: LP selection */}
              <StageCard
                title="5 · LP selection"
                icon={<Wallet className="h-4 w-4" />}
                description="Bandwidth allocated from LPs in sender / receiver countries."
              >
                {plan.requiredBandwidth.length === 0 ? (
                  <Empty>No LP bandwidth required for this strategy.</Empty>
                ) : (
                  <div className="space-y-1.5">
                    {plan.requiredBandwidth.map((bw, i) => {
                      const matched = bandwidth.find(
                        (b) =>
                          b.country === bw.country &&
                          b.assetType === bw.assetType &&
                          b.currency === bw.currency &&
                          b.available >= bw.amount,
                      );
                      return (
                        <div key={i} className="rounded border bg-card/40 p-2">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono text-muted-foreground">{bw.country} · {bw.assetType}</span>
                            <span className="font-semibold tabular-nums">{fmtUsd(bw.amount)} {bw.currency}</span>
                          </div>
                          {matched && (
                            <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                              ✓ Matched: {matched.lpId}
                            </div>
                          )}
                          {!matched && (
                            <div className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">
                              ✗ No matching bandwidth — marketplace fallback
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </StageCard>

              {/* Stage: Twin tokens */}
              <StageCard
                title="6 · Twin tokens"
                icon={<Coins className="h-4 w-4" />}
                description="Mint / burn twin tokens as part of the treasury action set."
              >
                {plan.treasuryActions.filter((a) => a.type.includes('twin')).length === 0 ? (
                  <Empty>No twin-token operations for this strategy.</Empty>
                ) : (
                  <div className="space-y-1.5">
                    {plan.treasuryActions
                      .filter((a) => a.type.includes('twin'))
                      .map((a, i) => (
                        <ActionRow
                          key={i}
                          kind="twin"
                          type={a.type}
                          country={a.country ?? '—'}
                          currency={a.currency}
                          amount={a.amount}
                          reason={a.reason}
                        />
                      ))}
                  </div>
                )}
                <div className="mt-2">
                  <SectionLabel>Reserve backing after mint</SectionLabel>
                  <div className="mt-1">
                    <StackedBar
                      segments={[
                        { label: 'Fiat', value: sender?.fiatReserves ?? 0, colorClass: 'bg-emerald-500' },
                        { label: 'Stablecoin', value: sender?.stablecoinReserves ?? 0, colorClass: 'bg-amber-500' },
                      ]}
                      height="h-2"
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Sender backing: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtX(sender?.backingRatio ?? 1, 2)}</span>
                  </div>
                </div>
              </StageCard>

              {/* Stage: Settlement */}
              <StageCard
                title="7 · Settlement"
                icon={<Shield className="h-4 w-4" />}
                description="The escrowed contract lifecycle actions."
              >
                {plan.settlementActions.length === 0 ? (
                  <Empty>No settlement actions for this strategy.</Empty>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {plan.settlementActions.map((a, i) => (
                      <div key={i} className="rounded border bg-card/40 p-1.5 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                            {a.type.replace(/_/g, ' ')}
                          </span>
                          <span className="font-semibold tabular-nums">{fmtUsd(a.amount)} {a.currency}</span>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">{a.reason}</div>
                      </div>
                    ))}
                  </div>
                )}
              </StageCard>

              {/* Stage: Confirmation */}
              <StageCard
                title="8 · Confirmation"
                icon={<Sparkles className="h-4 w-4" />}
                description="Recipient confirmation + escrow release + contract closure."
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded border bg-card/40 p-2">
                    <div className="text-[10px] text-muted-foreground">Recipient confirms</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">REQUIRED</div>
                  </div>
                  <div className="rounded border bg-card/40 p-2">
                    <div className="text-[10px] text-muted-foreground">Escrow released</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">AFTER CONFIRM</div>
                  </div>
                </div>
                <div className="mt-2">
                  <SectionLabel>Fallback graph</SectionLabel>
                  <div className="mt-1 space-y-1">
                    <div className="rounded border bg-violet-500/5 p-1.5 text-[10px]">
                      <span className="font-mono font-bold text-violet-600 dark:text-violet-400">PRIMARY</span>{' '}
                      <span className="text-muted-foreground">{plan.fallbackGraph.primary}</span>
                    </div>
                    {plan.fallbackGraph.fallbacks.map((f, i) => (
                      <div key={i} className="rounded border bg-amber-500/5 p-1.5 text-[10px]">
                        <span className="font-mono font-bold text-amber-600 dark:text-amber-400">FALLBACK</span>{' '}
                        <span className="text-muted-foreground">{f.condition}</span>
                        <div className="mt-0.5 pl-2 text-muted-foreground">
                          → {f.strategy.replace(/_/g, ' ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </StageCard>
            </div>

            {/* Rollback plan */}
            <div className="mt-4">
              <SectionLabel>Rollback plan (executed if any stage fails)</SectionLabel>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {plan.rollbackPlan.steps.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No rollback steps required.</div>
                ) : (
                  plan.rollbackPlan.steps.slice(0, 8).map((s, i) => (
                    <div key={i} className="rounded border bg-rose-500/5 p-2 text-[10px]">
                      <div className="font-mono font-bold text-rose-600 dark:text-rose-400">{s.step}</div>
                      <div className="mt-0.5 text-muted-foreground">{s.action}</div>
                      <div className="mt-0.5 text-[9px] italic text-muted-foreground">{s.condition}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan KPI strip */}
      {plan && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Plan ID"
            value={<span className="font-mono text-xs">{plan.planId.slice(0, 16)}</span>}
            hint={`Compiled at ${new Date(plan.compiledAt).toLocaleTimeString()}`}
            tone="emerald"
            icon={<Cpu className="h-4 w-4" />}
          />
          <StatTile
            label="Total fee"
            value={`${plan.feeModel.totalFeeBps} bps`}
            hint={`LP ${plan.feeModel.lpSharePercent}% · PaySwap ${plan.feeModel.payswapSharePercent}%`}
            tone="amber"
            icon={<Banknote className="h-4 w-4" />}
          />
          <StatTile
            label="Reserve-aware"
            value={plan.reserveAware ? 'YES' : 'NO'}
            hint={plan.reserveAware ? 'Honors all reserve constraints' : 'Bypasses reserves'}
            tone="teal"
            icon={<Scale className="h-4 w-4" />}
          />
          <StatTile
            label="Stablecoin usage"
            value={plan.stablecoinUsage.required ? fmtUsd(plan.stablecoinUsage.amount) : 'NONE'}
            hint={plan.stablecoinUsage.required ? `via ${plan.stablecoinUsage.source}` : 'No stablecoins needed'}
            tone="violet"
            icon={<Coins className="h-4 w-4" />}
          />
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ReserveSummaryCard({
  label,
  country,
  currency,
}: {
  label: string;
  country?: CountryDTO;
  currency: string;
}) {
  if (!country) {
    return (
      <div className="rounded-lg border bg-card/40 p-3">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm text-muted-foreground">No reserve data</div>
      </div>
    );
  }
  const total = country.fiatReserves + country.stablecoinReserves;
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
        <Badge variant="outline" className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400">
          {country.maturity.replace(/_/g, ' ')}
        </Badge>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-sm font-bold">{country.country}</span>
        <span className="text-[10px] text-muted-foreground">{currency}</span>
      </div>
      <div className="mt-2">
        <StackedBar
          segments={[
            { label: 'Fiat', value: country.fiatReserves, colorClass: 'bg-emerald-500' },
            { label: 'Stablecoin', value: country.stablecoinReserves, colorClass: 'bg-amber-500' },
          ]}
          height="h-2"
        />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] tabular-nums">
        <div>
          <div className="text-muted-foreground">Fiat</div>
          <div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtUsd(country.fiatReserves)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Stable</div>
          <div className="font-semibold text-amber-600 dark:text-amber-400">{fmtUsd(country.stablecoinReserves)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Backing</div>
          <div className="font-semibold">{fmtX(country.backingRatio, 2)}</div>
        </div>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {fmtPct(country.reserveCoverage, 0)} fiat coverage · {country.activeLPs} LPs · {fmtUsd(country.bandwidth)} bandwidth
      </div>
      {total === 0 && <div className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">No reserve — will use marketplace</div>}
    </div>
  );
}

function StageCard({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/30 p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          {icon}
        </div>
        <div>
          <div className="text-xs font-bold">{title}</div>
          <div className="text-[10px] text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-semibold tabular-nums">{v}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-2 text-center text-[11px] text-muted-foreground">{children}</div>;
}

function ActionRow({
  kind,
  type,
  country,
  currency,
  amount,
  reason,
}: {
  kind: 'treasury' | 'twin';
  type: string;
  country: string;
  currency: string;
  amount: number;
  reason: string;
}) {
  const isMint = type.includes('mint') || type.includes('credit');
  return (
    <div className="rounded border bg-card/40 p-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span
          className={`font-mono font-bold uppercase ${
            isMint ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {type.replace(/_/g, ' ')}
        </span>
        <span className="font-semibold tabular-nums">{fmtUsd(amount)} {currency}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{country}</span>
        <Badge variant="outline" className="text-[9px]">
          {kind}
        </Badge>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{reason}</div>
    </div>
  );
}
