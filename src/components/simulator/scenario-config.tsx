'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Trash2,
  Play,
  RotateCcw,
  Loader2,
  ArrowLeftRight,
  Zap,
  Wallet,
  Building2,
} from 'lucide-react';
import {
  type SimulationScenario,
  type RoutingPreference,
  type CurrencyCode,
  type ReserveConfig,
  type LiquidityProviderConfig,
  type PartyDescriptor,
} from '@/kernel';
import { flag } from './format';

type CountryOption = { country: string; currency: CurrencyCode; methods: string[] };

interface Props {
  scenario: SimulationScenario;
  onChange: (s: SimulationScenario) => void;
  onRun: () => void;
  onReset: () => void;
  loading: boolean;
  countryOptions: CountryOption[];
}

const PREFERENCES: { value: RoutingPreference; label: string; icon: typeof Zap; hint: string }[] = [
  { value: 'cheapest', label: 'Cheapest', icon: Wallet, hint: 'Lowest fee rate first' },
  { value: 'fastest', label: 'Fastest', icon: Zap, hint: 'Fewest LP hops' },
  { value: 'safest', label: 'Safest', icon: Building2, hint: 'Diversified liquidity' },
];

export function ScenarioConfig({ scenario, onChange, onRun, onReset, loading, countryOptions }: Props) {
  const setBuyerCountry = (country: string) => {
    const opt = countryOptions.find((c) => c.country === country);
    if (!opt) return;
    const buyer: PartyDescriptor = { ...scenario.buyer, country, currency: opt.currency, method: opt.methods[0] };
    // LP country follows buyer corridor by default.
    const liquidityProviders = scenario.liquidityProviders.map((lp) => ({ ...lp, country, currency: buyer.currency }));
    onChange({ ...scenario, buyer, liquidityProviders });
  };
  const setMerchantCountry = (country: string) => {
    const opt = countryOptions.find((c) => c.country === country);
    if (!opt) return;
    const merchant: PartyDescriptor = { ...scenario.merchant, country, currency: opt.currency, method: opt.methods[0] };
    onChange({ ...scenario, merchant, currency: opt.currency });
  };

  const setAmount = (v: string) => onChange({ ...scenario, amount: Number(v) || 0 });

  const updateReserve = (i: number, patch: Partial<ReserveConfig>) => {
    const reserves = scenario.reserves.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange({ ...scenario, reserves });
  };
  const addReserve = () => {
    const opt = countryOptions[0];
    onChange({
      ...scenario,
      reserves: [...scenario.reserves, { country: opt.country, currency: opt.currency, balance: 50000, minThreshold: 5000 }],
    });
  };
  const removeReserve = (i: number) => onChange({ ...scenario, reserves: scenario.reserves.filter((_, idx) => idx !== i) });

  const updateLp = (i: number, patch: Partial<LiquidityProviderConfig>) => {
    const liquidityProviders = scenario.liquidityProviders.map((lp, idx) => (idx === i ? { ...lp, ...patch } : lp));
    onChange({ ...scenario, liquidityProviders });
  };
  const addLp = () => {
    const nextId = String(scenario.liquidityProviders.length + 1);
    onChange({
      ...scenario,
      liquidityProviders: [
        ...scenario.liquidityProviders,
        { id: nextId, country: scenario.buyer.country, currency: scenario.buyer.currency, capacity: 20000, rate: 1.0, speedMs: 50000 },
      ],
    });
  };
  const removeLp = (i: number) => onChange({ ...scenario, liquidityProviders: scenario.liquidityProviders.filter((_, idx) => idx !== i) });

  const buyerMethods = countryOptions.find((c) => c.country === scenario.buyer.country)?.methods ?? [];
  const merchantMethods = countryOptions.find((c) => c.country === scenario.merchant.country)?.methods ?? [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </span>
              Scenario
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Configure a cross-border payment corridor
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} className="h-7 text-xs text-muted-foreground">
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Buyer / Merchant */}
        <div className="grid gap-4 sm:grid-cols-2">
          <PartyField
            title="Buyer"
            accent="text-sky-600 dark:text-sky-400"
            country={scenario.buyer.country}
            method={scenario.buyer.method}
            methods={buyerMethods}
            onCountry={setBuyerCountry}
            onMethod={(m) => onChange({ ...scenario, buyer: { ...scenario.buyer, method: m } })}
            countryOptions={countryOptions}
          />
          <PartyField
            title="Merchant"
            accent="text-emerald-600 dark:text-emerald-400"
            country={scenario.merchant.country}
            method={scenario.merchant.method}
            methods={merchantMethods}
            onCountry={setMerchantCountry}
            onMethod={(m) => onChange({ ...scenario, merchant: { ...scenario.merchant, method: m } })}
            countryOptions={countryOptions}
          />
        </div>

        {/* Amount */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-xs font-medium text-muted-foreground">Amount (merchant currency)</Label>
            <div className="flex items-center gap-2">
              <Input id="amount" type="number" value={scenario.amount} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
              <Badge variant="secondary" className="font-mono">{scenario.currency}</Badge>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Merchant preference</Label>
            <div className="grid grid-cols-3 gap-1">
              {PREFERENCES.map((p) => {
                const active = scenario.preference === p.value;
                const Icon = p.icon;
                return (
                  <Button
                    key={p.value}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    onClick={() => onChange({ ...scenario, preference: p.value })}
                    className="h-9 flex-col gap-0 py-1 text-[11px]"
                    title={p.hint}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <Separator />

        {/* Reserves */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reserves</Label>
            <Button variant="ghost" size="sm" onClick={addReserve} className="h-6 px-2 text-xs">
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {scenario.reserves.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
                <span className="text-base">{flag(r.country)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{r.country}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.currency}</div>
                </div>
                <Input
                  type="number"
                  value={r.balance}
                  onChange={(e) => updateReserve(i, { balance: Number(e.target.value) || 0 })}
                  className="h-8 w-24 font-mono text-xs"
                  aria-label="balance"
                />
                <span className="text-[10px] text-muted-foreground">min</span>
                <Input
                  type="number"
                  value={r.minThreshold}
                  onChange={(e) => updateReserve(i, { minThreshold: Number(e.target.value) || 0 })}
                  className="h-8 w-20 font-mono text-xs"
                  aria-label="threshold"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeReserve(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Liquidity Providers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Liquidity Providers ({scenario.buyer.country})</Label>
            <Button variant="ghost" size="sm" onClick={addLp} className="h-6 px-2 text-xs">
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
          <div className="space-y-2">
            {scenario.liquidityProviders.map((lp, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
                <Badge variant="outline" className="font-mono text-[10px]">LP{lp.id}</Badge>
                <div className="flex flex-1 items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">cap</span>
                  <Input
                    type="number"
                    value={lp.capacity}
                    onChange={(e) => updateLp(i, { capacity: Number(e.target.value) || 0 })}
                    className="h-8 w-24 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">rate%</span>
                  <Input
                    type="number"
                    step="0.1"
                    value={lp.rate}
                    onChange={(e) => updateLp(i, { rate: Number(e.target.value) || 0 })}
                    className="h-8 w-16 font-mono text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">s</span>
                  <Input
                    type="number"
                    value={Math.round(lp.speedMs / 1000)}
                    onChange={(e) => updateLp(i, { speedMs: (Number(e.target.value) || 0) * 1000 })}
                    className="h-8 w-14 font-mono text-xs"
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeLp(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <Button onClick={onRun} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" size="lg">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {loading ? 'Simulating…' : 'Run Simulation'}
        </Button>
      </CardContent>
    </Card>
  );
}

function PartyField({
  title,
  accent,
  country,
  method,
  methods,
  onCountry,
  onMethod,
  countryOptions,
}: {
  title: string;
  accent: string;
  country: string;
  method: string;
  methods: string[];
  onCountry: (c: string) => void;
  onMethod: (m: string) => void;
  countryOptions: CountryOption[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className={`text-xs font-medium ${accent}`}>{title}</Label>
      <Select value={country} onValueChange={onCountry}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {countryOptions.map((c) => (
            <SelectItem key={c.country} value={c.country}>
              <span className="mr-1.5">{flag(c.country)}</span>{c.country} <span className="ml-1 text-muted-foreground">{c.currency}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={method} onValueChange={onMethod}>
        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {methods.map((m) => (
            <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
