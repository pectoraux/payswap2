'use client';

import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Plus, Trash2, Play, RotateCcw, Loader2, ArrowLeftRight, Zap, Wallet, Building2, Scale,
  AlertTriangle, Cpu, Database, Network, Skull, ShieldAlert, Banknote, Wifi, Server,
} from 'lucide-react';
import {
  type SimulationScenario, type RoutingPriority, type CurrencyCode,
  type LiquidityProvider, type FinancialOperator, type FinancialOperatorType,
  type LiquiditySourceKind, type FailureInjection, type FailureType,
  type OptimizationWeights, type ReservePolicy,
} from '@/kernel';
import { flag, foIcon, foLabel, sourceKindLabel } from './format';

type CountryOption = { country: string; currency: CurrencyCode; methods: string[] };

interface Props {
  scenario: SimulationScenario;
  onChange: (s: SimulationScenario) => void;
  onRun: () => void;
  onReset: () => void;
  loading: boolean;
  countryOptions: CountryOption[];
}

const PRIORITIES: { value: RoutingPriority; label: string; icon: typeof Zap; hint: string }[] = [
  { value: 'cheapest', label: 'Cheapest', icon: Wallet, hint: 'Lowest fee first' },
  { value: 'fastest', label: 'Fastest', icon: Zap, hint: 'Fewest LP hops' },
  { value: 'safest', label: 'Safest', icon: Building2, hint: 'Diversified liquidity' },
  { value: 'balanced', label: 'Balanced', icon: Scale, hint: 'Even multi-objective' },
  { value: 'impact', label: 'Impact', icon: Network, hint: 'Community-first' },
];

const SOURCE_KINDS: LiquiditySourceKind[] = ['community_lp', 'merchant_lp', 'cooperative_pool', 'diaspora_pool', 'bank_credit_line'];
const FO_TYPES: FinancialOperatorType[] = ['mobile_money', 'bank_account', 'visa', 'mastercard', 'instant_transfer', 'card_processor', 'psp_wallet', 'ach', 'sepa'];

const FAILURE_TYPES: { type: FailureType; label: string; icon: typeof Skull }[] = [
  { type: 'lp_disappear', label: 'LP disappears', icon: Skull },
  { type: 'reserve_exhaustion', label: 'Reserve exhaustion', icon: Database },
  { type: 'psp_timeout', label: 'PSP timeout', icon: Server },
  { type: 'fx_spike', label: 'FX spike', icon: Banknote },
  { type: 'network_partition', label: 'Network partition', icon: Wifi },
  { type: 'treasury_depletion', label: 'Treasury depletion', icon: AlertTriangle },
  { type: 'fraud_alert', label: 'Fraud alert', icon: ShieldAlert },
  { type: 'compliance_block', label: 'Compliance block', icon: Scale },
  { type: 'manual_settlement_required', label: 'Manual settlement', icon: Building2 },
  { type: 'insurance_claim', label: 'Insurance claim', icon: AlertTriangle },
];

const RESERVE_POLICIES: { value: ReservePolicy; label: string }[] = [
  { value: 'reserve_first', label: 'Reserve-first' },
  { value: 'lp_first', label: 'LP-first' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'preserve_reserves', label: 'Preserve reserves' },
];

const AI_WEIGHTS: { key: keyof OptimizationWeights; label: string }[] = [
  { key: 'cost', label: 'Cost' },
  { key: 'speed', label: 'Speed' },
  { key: 'safety', label: 'Safety' },
  { key: 'liquidityPreservation', label: 'Liquidity preservation' },
  { key: 'merchantSatisfaction', label: 'Merchant satisfaction' },
  { key: 'communityImpact', label: 'Community impact' },
  { key: 'carbonImpact', label: 'Carbon impact' },
  { key: 'treasuryHealth', label: 'Treasury health' },
];

export function ScenarioBuilder({ scenario, onChange, onRun, onReset, loading, countryOptions }: Props) {
  const t = scenario.transaction;
  const setT = (patch: Partial<SimulationScenario['transaction']>) => onChange({ ...scenario, transaction: { ...t, ...patch } });

  const setBuyerCountry = (country: string) => {
    const opt = countryOptions.find((c) => c.country === country);
    if (!opt) return;
    setT({ buyer: { ...t.buyer, country, currency: opt.currency, method: opt.methods[0] } });
  };
  const setMerchantCountry = (country: string) => {
    const opt = countryOptions.find((c) => c.country === country);
    if (!opt) return;
    setT({ merchant: { ...t.merchant, country, currency: opt.currency, method: opt.methods[0] }, currency: opt.currency });
  };

  const buyerMethods = countryOptions.find((c) => c.country === t.buyer.country)?.methods ?? [];
  const merchantMethods = countryOptions.find((c) => c.country === t.merchant.country)?.methods ?? [];

  const updateLp = (i: number, patch: Partial<LiquidityProvider>) => {
    const liquidityProviders = scenario.liquidityProviders.map((lp, idx) => (idx === i ? { ...lp, ...patch } : lp));
    onChange({ ...scenario, liquidityProviders });
  };
  const addLp = () => {
    const nextId = String(scenario.liquidityProviders.length + 1);
    onChange({ ...scenario, liquidityProviders: [...scenario.liquidityProviders, {
      id: nextId, name: `LP ${nextId}`, country: t.buyer.country, currency: t.merchant.currency,
      sourceKind: 'community_lp', twinTokenPosition: 10000, fiatPosition: 20000, financialOperators: [],
      tradingFees: 1.0, tradingCapacity: 20000, riskProfile: 0.2, settlementSpeedMs: 50000,
      insuranceCoverage: 10000, availability: 0.95, historicalPerformance: 0.97, aiReputation: 0.85,
      manualOnly: false, online: true,
    }] });
  };
  const removeLp = (i: number) => onChange({ ...scenario, liquidityProviders: scenario.liquidityProviders.filter((_, idx) => idx !== i) });

  const updateFo = (i: number, patch: Partial<FinancialOperator>) => {
    const financialOperators = scenario.financialOperators.map((fo, idx) => (idx === i ? { ...fo, ...patch } : fo));
    onChange({ ...scenario, financialOperators });
  };
  const addFo = () => {
    const nextId = `fo-${scenario.financialOperators.length + 1}`;
    onChange({ ...scenario, financialOperators: [...scenario.financialOperators, {
      id: nextId, type: 'mobile_money', name: `Operator ${nextId}`, country: t.buyer.country,
      supportedCurrencies: [t.buyer.currency], latencyMs: 12000, feeBps: 80, feeFixed: 0,
      uptime: 0.985, failureRate: 0.015, maxAmount: 500000, minAmount: 10,
      supportedRoutes: ['domestic', 'cross_border'], online: true, manualOnly: false,
    }] });
  };
  const removeFo = (i: number) => onChange({ ...scenario, financialOperators: scenario.financialOperators.filter((_, idx) => idx !== i) });

  const addFailure = (type: FailureType) => {
    const def = FAILURE_TYPES.find((f) => f.type === type)!;
    const failure: FailureInjection = {
      id: `fail-${Date.now().toString(36)}`,
      type, label: def.label,
      targetId: type === 'lp_disappear' ? scenario.liquidityProviders[0]?.id : type === 'psp_timeout' ? scenario.financialOperators[0]?.id : t.merchant.country,
      atFrame: 4,
    };
    onChange({ ...scenario, failures: [...scenario.failures, failure] });
  };
  const removeFailure = (id: string) => onChange({ ...scenario, failures: scenario.failures.filter((f) => f.id !== id) });
  const updateFailureFrame = (id: string, atFrame: number) => onChange({ ...scenario, failures: scenario.failures.map((f) => (f.id === id ? { ...f, atFrame } : f)) });

  const setWeight = (key: keyof OptimizationWeights, value: number) => onChange({ ...scenario, aiWeights: { ...scenario.aiWeights, [key]: value } });
  const setPolicy = (patch: Partial<SimulationScenario['policies']>) => onChange({ ...scenario, policies: { ...scenario.policies, ...patch } });

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </span>
              Scenario Builder
            </CardTitle>
            <CardDescription className="mt-1 text-xs">Configure the Digital Twin network state</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onReset} className="h-7 text-xs text-muted-foreground">
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <Accordion type="multiple" defaultValue={['tx']} className="w-full">
          {/* Transaction */}
          <AccordionItem value="tx">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide py-2">Transaction</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              <div className="grid grid-cols-2 gap-3">
                <Select value={t.buyer.country} onValueChange={setBuyerCountry}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{countryOptions.map((c) => <SelectItem key={c.country} value={c.country} className="text-xs"><span className="mr-1">{flag(c.country)}</span>{c.country}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={t.merchant.country} onValueChange={setMerchantCountry}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{countryOptions.map((c) => <SelectItem key={c.country} value={c.country} className="text-xs"><span className="mr-1">{flag(c.country)}</span>{c.country}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select value={t.buyer.method} onValueChange={(m) => setT({ buyer: { ...t.buyer, method: m } })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{buyerMethods.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={t.merchant.method} onValueChange={(m) => setT({ merchant: { ...t.merchant, method: m } })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{merchantMethods.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Input type="number" value={t.amount} onChange={(e) => setT({ amount: Number(e.target.value) || 0 })} className="h-8 font-mono text-xs" />
                <Badge variant="secondary" className="font-mono text-[10px]">{t.currency}</Badge>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {PRIORITIES.map((p) => {
                  const active = t.priority === p.value;
                  const Icon = p.icon;
                  return (
                    <Button key={p.value} size="sm" variant={active ? 'default' : 'outline'} onClick={() => setT({ priority: p.value })}
                      className="h-9 flex-col gap-0 py-1 text-[10px]" title={p.hint}>
                      <Icon className="h-3 w-3" />{p.label}
                    </Button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Treasury */}
          <AccordionItem value="treasury">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide py-2">Treasury & Reserves</AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Origin reserve ({scenario.treasury.originReserve.country})</Label>
                  <Input type="number" value={scenario.treasury.originReserve.available} onChange={(e) => onChange({ ...scenario, treasury: { ...scenario.treasury, originReserve: { ...scenario.treasury.originReserve, available: Number(e.target.value) || 0 } } })} className="h-8 font-mono text-xs" />
                  <Input type="number" value={scenario.treasury.originReserve.minThreshold} onChange={(e) => onChange({ ...scenario, treasury: { ...scenario.treasury, originReserve: { ...scenario.treasury.originReserve, minThreshold: Number(e.target.value) || 0 } } })} className="h-8 font-mono text-[10px]" placeholder="min threshold" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Destination reserve ({scenario.treasury.destinationReserve.country})</Label>
                  <Input type="number" value={scenario.treasury.destinationReserve.available} onChange={(e) => onChange({ ...scenario, treasury: { ...scenario.treasury, destinationReserve: { ...scenario.treasury.destinationReserve, available: Number(e.target.value) || 0 } } })} className="h-8 font-mono text-xs" />
                  <Input type="number" value={scenario.treasury.destinationReserve.minThreshold} onChange={(e) => onChange({ ...scenario, treasury: { ...scenario.treasury, destinationReserve: { ...scenario.treasury.destinationReserve, minThreshold: Number(e.target.value) || 0 } } })} className="h-8 font-mono text-[10px]" placeholder="min threshold" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Stablecoin treasury</Label>
                  <Input type="number" value={scenario.treasury.stablecoinBalance} onChange={(e) => onChange({ ...scenario, treasury: { ...scenario.treasury, stablecoinBalance: Number(e.target.value) || 0 } })} className="h-8 font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Emergency treasury</Label>
                  <Input type="number" value={scenario.treasury.emergencyTreasury} onChange={(e) => onChange({ ...scenario, treasury: { ...scenario.treasury, emergencyTreasury: Number(e.target.value) || 0 } })} className="h-8 font-mono text-xs" />
                </div>
              </div>
              <Select value={scenario.policies.reservePolicy} onValueChange={(v) => setPolicy({ reservePolicy: v as ReservePolicy })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{RESERVE_POLICIES.map((p) => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </AccordionContent>
          </AccordionItem>

          {/* Liquidity Providers */}
          <AccordionItem value="lp">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide py-2">Liquidity Providers ({scenario.liquidityProviders.length})</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              {scenario.liquidityProviders.map((lp, i) => (
                <div key={lp.id} className="rounded-lg border bg-muted/30 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="font-mono text-[9px]">{flag(lp.country)}</Badge>
                    <Input value={lp.name} onChange={(e) => updateLp(i, { name: e.target.value })} className="h-7 flex-1 text-xs" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeLp(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <Select value={lp.sourceKind} onValueChange={(v) => updateLp(i, { sourceKind: v as LiquiditySourceKind })}>
                      <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{SOURCE_KINDS.map((k) => <SelectItem key={k} value={k} className="text-[10px]">{sourceKindLabel(k)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" value={lp.tradingCapacity} onChange={(e) => updateLp(i, { tradingCapacity: Number(e.target.value) || 0 })} className="h-7 font-mono text-[10px]" placeholder="cap" />
                    <Input type="number" step="0.1" value={lp.tradingFees} onChange={(e) => updateLp(i, { tradingFees: Number(e.target.value) || 0 })} className="h-7 font-mono text-[10px]" placeholder="fee%" />
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={lp.manualOnly} onChange={(e) => updateLp(i, { manualOnly: e.target.checked })} className="h-3 w-3" /> Manual
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={lp.online} onChange={(e) => updateLp(i, { online: e.target.checked })} className="h-3 w-3" /> Online
                    </label>
                  </div>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addLp} className="w-full h-7 text-xs"><Plus className="mr-1 h-3 w-3" /> Add LP</Button>
            </AccordionContent>
          </AccordionItem>

          {/* Financial Operators */}
          <AccordionItem value="fo">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide py-2">Financial Operators ({scenario.financialOperators.length})</AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              {scenario.financialOperators.map((fo, i) => (
                <div key={fo.id} className="rounded-lg border bg-muted/30 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span>{foIcon(fo.type)}</span>
                    <Input value={fo.name} onChange={(e) => updateFo(i, { name: e.target.value })} className="h-7 flex-1 text-xs" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeFo(i)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <Select value={fo.type} onValueChange={(v) => updateFo(i, { type: v as FinancialOperatorType })}>
                      <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{FO_TYPES.map((ft) => <SelectItem key={ft} value={ft} className="text-[10px]">{foLabel(ft)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" value={fo.uptime} step="0.001" onChange={(e) => updateFo(i, { uptime: Number(e.target.value) || 0, failureRate: 1 - (Number(e.target.value) || 0) })} className="h-7 font-mono text-[10px]" placeholder="uptime" />
                  </div>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px]">
                    <input type="checkbox" checked={fo.online} onChange={(e) => updateFo(i, { online: e.target.checked })} className="h-3 w-3" /> Online
                  </label>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addFo} className="w-full h-7 text-xs"><Plus className="mr-1 h-3 w-3" /> Add FO</Button>
            </AccordionContent>
          </AccordionItem>

          {/* Failure Injection */}
          <AccordionItem value="failures">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide py-2">
              <span className="flex items-center gap-1.5">Failure Injection {scenario.failures.length > 0 && <Badge className="h-4 px-1 text-[9px] bg-rose-600 hover:bg-rose-600 text-white">{scenario.failures.length}</Badge>}</span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              {scenario.failures.map((f) => {
                const def = FAILURE_TYPES.find((x) => x.type === f.type)!;
                const Icon = def.icon;
                return (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2">
                    <Icon className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium truncate">{f.label}</div>
                      <div className="text-[9px] text-muted-foreground">frame {f.atFrame} · {f.targetId ?? '—'}</div>
                    </div>
                    <Input type="number" min={1} max={9} value={f.atFrame} onChange={(e) => updateFailureFrame(f.id, Number(e.target.value) || 1)} className="h-7 w-12 font-mono text-[10px]" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => removeFailure(f.id)}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                );
              })}
              <div className="grid grid-cols-2 gap-1 pt-1">
                {FAILURE_TYPES.map((ft) => {
                  const Icon = ft.icon;
                  return (
                    <Button key={ft.type} variant="outline" size="sm" onClick={() => addFailure(ft.type)} className="h-7 justify-start text-[10px]">
                      <Icon className="mr-1 h-3 w-3" /> {ft.label}
                    </Button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* AI Weights */}
          <AccordionItem value="ai">
            <AccordionTrigger className="text-xs font-semibold uppercase tracking-wide py-2">
              <span className="flex items-center gap-1.5"><Cpu className="h-3 w-3" /> AI Weights</span>
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pb-3">
              {AI_WEIGHTS.map(({ key, label }) => (
                <div key={key} className="space-y-0.5">
                  <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">{label}</span><span className="font-mono">{scenario.aiWeights[key].toFixed(2)}</span></div>
                  <Slider value={[scenario.aiWeights[key] * 100]} onValueChange={(v) => setWeight(key, v[0] / 100)} max={100} step={5} className="h-1" />
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Button onClick={onRun} disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" size="lg">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {loading ? 'Simulating…' : 'Run Simulation'}
        </Button>
      </CardContent>
    </Card>
  );
}
