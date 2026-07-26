'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  Wand2, Play, Loader2, Settings2, ChevronDown, ChevronRight,
  Store, Briefcase, CheckCircle2, Globe, Sliders, Shield, Activity,
  AlertTriangle, Sparkles,
} from 'lucide-react';

interface MerchantOption {
  id: string;
  name: string;
  country: string;
  currency: string;
  businessType?: string | null;
  tier?: string | null;
}

interface LpOption {
  id: string;
  name: string;
  country: string;
  currencies: string;
  stake: number;
  tier?: string | null;
  reputation: number;
}

interface WorldEvent {
  ts: number;
  actor: string;
  action: string;
  description: string;
  resourceType?: string;
  resourceId?: string;
}

interface NetworkImpact {
  before: { totalPayments: number; totalVolume: number; totalLpRevenue: number; amlAlerts: number; webhooksDelivered: number; webhooksFailed: number; };
  after: { totalPayments: number; totalVolume: number; totalLpRevenue: number; amlAlerts: number; webhooksDelivered: number; webhooksFailed: number; };
  delta: { payments: number; volume: number; lpRevenue: number; amlAlerts: number; webhooksDelivered: number; webhooksFailed: number; };
}

interface CustomSimResult {
  runId: string;
  scenario: string;
  duration: string;
  paymentsCreated: number;
  payoutsCreated: number;
  refundsCreated: number;
  invoicesCreated: number;
  webhooksCreated: number;
  ledgerEntries: number;
  auditLogs: number;
  complianceAlerts: number;
  lpRevenue: number;
  totalVolume: number;
  errors: string[];
  duration_ms: number;
  events: WorldEvent[];
  networkImpact?: NetworkImpact;
}

interface CustomParams {
  successRate: number;          // percentage 0-100
  refundRate: number;           // 0-20
  webhookFailureRate: number;   // 0-50
  complianceAlertRate: number;  // 0-10
  highValueRate: number;        // 0-30
  payoutFrequency: number;      // 0-50
}

const DURATION_STEPS = [
  { value: '1h', label: '1 Hour', desc: '~5 payments', hours: 1 },
  { value: '1d', label: '1 Day', desc: '~30 payments', hours: 24 },
  { value: '1w', label: '1 Week', desc: '~80 payments', hours: 168 },
  { value: '1m', label: '1 Month', desc: '~200 payments', hours: 720 },
] as const;

const DEFAULT_PARAMS: CustomParams = {
  successRate: 95,
  refundRate: 3,
  webhookFailureRate: 5,
  complianceAlertRate: 1,
  highValueRate: 5,
  payoutFrequency: 15,
};

export function ScenarioBuilder() {
  const [duration, setDuration] = useState<string>('1d');
  const [params, setParams] = useState<CustomParams>(DEFAULT_PARAMS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [actorsOpen, setActorsOpen] = useState(true);

  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [lps, setLps] = useState<LpOption[]>([]);
  const [selectedMerchants, setSelectedMerchants] = useState<Set<string>>(new Set());
  const [selectedLps, setSelectedLps] = useState<Set<string>>(new Set());
  const [loadingActors, setLoadingActors] = useState(true);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CustomSimResult | null>(null);

  // Load actor options on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/network/actors', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load actors');
        const data = await res.json();
        if (cancelled) return;
        const ms: MerchantOption[] = data.merchants || [];
        const ls: LpOption[] = data.lps || [];
        setMerchants(ms);
        setLps(ls);
        // Default: select all
        setSelectedMerchants(new Set(ms.map((m) => m.id)));
        setSelectedLps(new Set(ls.map((l) => l.id)));
      } catch (e) {
        if (!cancelled) {
          toast.error('Failed to load actors', {
            description: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      } finally {
        if (!cancelled) setLoadingActors(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMerchant = (id: string) => {
    setSelectedMerchants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLp = (id: string) => {
    setSelectedLps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllMerchants = () => setSelectedMerchants(new Set(merchants.map((m) => m.id)));
  const clearMerchants = () => setSelectedMerchants(new Set());
  const selectAllLps = () => setSelectedLps(new Set(lps.map((l) => l.id)));
  const clearLps = () => setSelectedLps(new Set());

  const runCustom = async () => {
    if (selectedMerchants.size === 0 || selectedLps.size === 0) {
      toast.error('Select at least one merchant and one LP', {
        description: 'The simulation needs actors to generate activity.',
      });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      // Convert percentage values to 0-1 probabilities
      const customParams = {
        successRate: params.successRate / 100,
        refundRate: params.refundRate / 100,
        webhookFailureRate: params.webhookFailureRate / 100,
        complianceAlertRate: params.complianceAlertRate / 100,
        highValueRate: params.highValueRate / 100,
        payoutFrequency: params.payoutFrequency / 100,
      };
      const actorFilter = {
        merchantIds: Array.from(selectedMerchants),
        lpIds: Array.from(selectedLps),
      };
      const res = await fetch('/api/simulate/world/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration, customParams, actorFilter }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || err.error || 'Simulation failed');
      }
      const data: CustomSimResult = await res.json();
      setResult(data);
      toast.success('Custom scenario complete', {
        description: `${data.paymentsCreated} payments · ${data.totalVolume.toLocaleString()} GHS · ${data.complianceAlerts} AML alerts`,
      });
    } catch (e) {
      toast.error('Custom scenario failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setRunning(false);
    }
  };

  const durationIdx = DURATION_STEPS.findIndex((d) => d.value === duration);

  return (
    <Card className="border-teal-500/20">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-teal-500" />
          Scenario Builder
        </CardTitle>
        <CardDescription>
          Configure custom world scenarios with granular control over probabilities, durations, and participating actors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Duration slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duration</label>
            <Badge variant="outline" className="text-[10px] border-teal-500/40 text-teal-600 dark:text-teal-400">
              {DURATION_STEPS[durationIdx]?.label}
            </Badge>
          </div>
          <div className="px-2">
            <Slider
              value={[durationIdx]}
              min={0}
              max={DURATION_STEPS.length - 1}
              step={1}
              onValueChange={(v) => setDuration(DURATION_STEPS[v[0]]?.value ?? '1d')}
            />
            <div className="flex justify-between mt-2 px-0.5">
              {DURATION_STEPS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDuration(d.value)}
                  className={`flex flex-col items-center gap-0.5 transition-colors ${duration === d.value ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <span className="text-[10px] font-semibold">{d.label}</span>
                  <span className="text-[9px] opacity-70">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Scenario presets */}
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 block">
            Scenario Presets
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {[
              { label: 'Normal', icon: '📊', params: DEFAULT_PARAMS },
              { label: 'Holiday', icon: '🎉', params: { successRate: 93, refundRate: 5, webhookFailureRate: 5, complianceAlertRate: 1, highValueRate: 15, payoutFrequency: 20 } },
              { label: 'Outage', icon: '⚠️', params: { successRate: 80, refundRate: 3, webhookFailureRate: 25, complianceAlertRate: 2, highValueRate: 5, payoutFrequency: 10 } },
              { label: 'Growth', icon: '🚀', params: { successRate: 97, refundRate: 2, webhookFailureRate: 3, complianceAlertRate: 0.5, highValueRate: 8, payoutFrequency: 25 } },
              { label: 'Stress', icon: '🔥', params: { successRate: 88, refundRate: 4, webhookFailureRate: 15, complianceAlertRate: 2, highValueRate: 5, payoutFrequency: 15 } },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => setParams(p.params)}
                className="rounded-lg border border-border p-2 text-center hover:bg-muted/50 transition-colors"
              >
                <div className="text-base mb-0.5">{p.icon}</div>
                <div className="text-[10px] font-semibold">{p.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Custom parameters — collapsible */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2">
              {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Settings2 className="h-3.5 w-3.5" />
              Custom Parameters
              <span className="text-[10px] text-muted-foreground ml-auto">
                {advancedOpen ? 'Hide' : 'Show'}
              </span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2">
                <Sliders className="h-3 w-3" />
                Adjust probability sliders to design a custom scenario. Presets override these values.
              </div>
              <ParamSlider
                label="Payment Success Rate"
                icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                value={params.successRate}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => setParams((p) => ({ ...p, successRate: v }))}
              />
              <ParamSlider
                label="Refund Rate"
                icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                value={params.refundRate}
                min={0}
                max={20}
                step={0.5}
                unit="%"
                onChange={(v) => setParams((p) => ({ ...p, refundRate: v }))}
              />
              <ParamSlider
                label="Webhook Failure Rate"
                icon={<AlertTriangle className="h-3.5 w-3.5 text-rose-500" />}
                value={params.webhookFailureRate}
                min={0}
                max={50}
                step={1}
                unit="%"
                onChange={(v) => setParams((p) => ({ ...p, webhookFailureRate: v }))}
              />
              <ParamSlider
                label="Compliance Alert Probability"
                icon={<Shield className="h-3.5 w-3.5 text-rose-500" />}
                value={params.complianceAlertRate}
                min={0}
                max={10}
                step={0.1}
                unit="%"
                onChange={(v) => setParams((p) => ({ ...p, complianceAlertRate: v }))}
              />
              <ParamSlider
                label="High-Value Transaction Probability"
                icon={<Sparkles className="h-3.5 w-3.5 text-teal-500" />}
                value={params.highValueRate}
                min={0}
                max={30}
                step={0.5}
                unit="%"
                onChange={(v) => setParams((p) => ({ ...p, highValueRate: v }))}
              />
              <ParamSlider
                label="Merchant Payout Frequency"
                icon={<Briefcase className="h-3.5 w-3.5 text-teal-500" />}
                value={params.payoutFrequency}
                min={0}
                max={50}
                step={1}
                unit="%"
                onChange={(v) => setParams((p) => ({ ...p, payoutFrequency: v }))}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setParams(DEFAULT_PARAMS)}
                className="text-[11px] h-7"
              >
                Reset to defaults
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Actor selection — collapsible */}
        <Collapsible open={actorsOpen} onOpenChange={setActorsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2">
              {actorsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Store className="h-3.5 w-3.5" />
              Actor Selection
              <Badge variant="secondary" className="text-[10px] ml-auto">
                {selectedMerchants.size} merchants · {selectedLps.size} LPs
              </Badge>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {/* Merchants */}
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Store className="h-3.5 w-3.5 text-emerald-500" />
                  Merchants
                  <Badge variant="outline" className="text-[9px]">{selectedMerchants.size}/{merchants.length}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={selectAllMerchants}>All</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={clearMerchants}>None</Button>
                </div>
              </div>
              {loadingActors ? (
                <div className="text-[11px] text-muted-foreground py-4 text-center">Loading merchants...</div>
              ) : merchants.length === 0 ? (
                <div className="text-[11px] text-muted-foreground py-4 text-center">No active merchants. Seed the database first.</div>
              ) : (
                <ScrollArea className="h-40 w-full rounded border bg-background/50">
                  <div className="p-2 space-y-1">
                    {merchants.map((m) => {
                      const checked = selectedMerchants.has(m.id);
                      return (
                        <label
                          key={m.id}
                          className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted/50 ${checked ? 'bg-emerald-500/5' : ''}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleMerchant(m.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate">{m.name}</div>
                            <div className="text-[9px] text-muted-foreground">
                              {m.country} · {m.currency}{m.businessType ? ` · ${m.businessType}` : ''}
                            </div>
                          </div>
                          {m.tier && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                              {m.tier}
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* LPs */}
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Briefcase className="h-3.5 w-3.5 text-teal-500" />
                  Liquidity Providers
                  <Badge variant="outline" className="text-[9px]">{selectedLps.size}/{lps.length}</Badge>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={selectAllLps}>All</Button>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={clearLps}>None</Button>
                </div>
              </div>
              {loadingActors ? (
                <div className="text-[11px] text-muted-foreground py-4 text-center">Loading LPs...</div>
              ) : lps.length === 0 ? (
                <div className="text-[11px] text-muted-foreground py-4 text-center">
                  No active LPs. The simulator will use a fallback simulated LP.
                </div>
              ) : (
                <ScrollArea className="h-40 w-full rounded border bg-background/50">
                  <div className="p-2 space-y-1">
                    {lps.map((lp) => {
                      const checked = selectedLps.has(lp.id);
                      return (
                        <label
                          key={lp.id}
                          className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer hover:bg-muted/50 ${checked ? 'bg-teal-500/5' : ''}`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleLp(lp.id)}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate">{lp.name}</div>
                            <div className="text-[9px] text-muted-foreground">
                              {lp.country} · Stake {lp.stake.toLocaleString()} · Rep {(lp.reputation * 100).toFixed(0)}%
                            </div>
                          </div>
                          {lp.tier && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                              {lp.tier}
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Run button */}
        <Button
          onClick={runCustom}
          disabled={running || selectedMerchants.size === 0 || selectedLps.size === 0}
          className="w-full gap-2 bg-teal-600 hover:bg-teal-700 text-white"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'Running custom scenario...' : 'Run Custom Scenario'}
        </Button>

        {/* Result preview */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-teal-500/30 bg-teal-500/5 p-3">
              <CheckCircle2 className="h-6 w-6 text-teal-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">Custom Scenario Complete</div>
                <div className="text-[10px] text-muted-foreground font-mono">{result.runId.slice(0, 24)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-muted-foreground">Duration</div>
                <div className="text-xs font-mono">{(result.duration_ms / 1000).toFixed(1)}s</div>
              </div>
            </div>

            {/* Result stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <ResultStat label="Payments" value={result.paymentsCreated} icon={<Activity className="h-3 w-3" />} color="text-emerald-600 dark:text-emerald-400" />
              <ResultStat label="Volume" value={`${result.totalVolume.toLocaleString()} GHS`} icon={<Globe className="h-3 w-3" />} color="text-teal-600 dark:text-teal-400" />
              <ResultStat label="LP Revenue" value={`${result.lpRevenue.toLocaleString()} GHS`} icon={<Briefcase className="h-3 w-3" />} color="text-teal-600 dark:text-teal-400" />
              <ResultStat label="AML Alerts" value={result.complianceAlerts} icon={<Shield className="h-3 w-3" />} color="text-rose-600 dark:text-rose-400" />
              <ResultStat label="Payouts" value={result.payoutsCreated} icon={<Briefcase className="h-3 w-3" />} color="text-teal-600 dark:text-teal-400" />
              <ResultStat label="Refunds" value={result.refundsCreated} icon={<AlertTriangle className="h-3 w-3" />} color="text-amber-600 dark:text-amber-400" />
              <ResultStat label="Invoices" value={result.invoicesCreated} icon={<Sparkles className="h-3 w-3" />} color="text-emerald-600 dark:text-emerald-400" />
              <ResultStat label="Webhooks" value={result.webhooksCreated} icon={<Activity className="h-3 w-3" />} color="text-emerald-600 dark:text-emerald-400" />
            </div>

            {/* Network impact delta */}
            {result.networkImpact && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Network Impact Delta
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                  <DeltaItem label="Payments" delta={result.networkImpact.delta.payments} />
                  <DeltaItem label="Volume" delta={result.networkImpact.delta.volume} suffix="GHS" />
                  <DeltaItem label="LP Revenue" delta={result.networkImpact.delta.lpRevenue} suffix="GHS" />
                  <DeltaItem label="AML Alerts" delta={result.networkImpact.delta.amlAlerts} inverted />
                  <DeltaItem label="WH Delivered" delta={result.networkImpact.delta.webhooksDelivered} />
                  <DeltaItem label="WH Failed" delta={result.networkImpact.delta.webhooksFailed} inverted />
                </div>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700 dark:text-amber-400">
                {result.errors.length} non-fatal errors. First: {result.errors[0]}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ParamSlider({
  label,
  icon,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[11px] font-medium">{label}</span>
        </div>
        <span className="text-xs font-mono tabular-nums px-1.5 py-0.5 rounded bg-background border">
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[9px] text-muted-foreground tabular-nums">{min}{unit}</span>
        <span className="text-[9px] text-muted-foreground tabular-nums">{max}{unit}</span>
      </div>
    </div>
  );
}

function ResultStat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className={`flex items-center gap-1 mb-0.5 ${color}`}>
        {icon}
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

function DeltaItem({
  label,
  delta,
  suffix,
  inverted = false,
}: {
  label: string;
  delta: number;
  suffix?: string;
  inverted?: boolean;
}) {
  const isFlat = delta === 0;
  const isUp = delta > 0;
  // For "inverted" metrics (AML alerts, webhook failures), up is bad
  const isGood = isFlat ? true : inverted ? !isUp : isUp;
  const color = isFlat
    ? 'text-muted-foreground'
    : isGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400';
  const fmt = (n: number) => (suffix ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toLocaleString());
  return (
    <div className="flex items-center justify-between rounded border bg-background/50 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${color}`}>
        {isUp ? '+' : ''}{fmt(delta)}{suffix ? ` ${suffix}` : ''}
      </span>
    </div>
  );
}
