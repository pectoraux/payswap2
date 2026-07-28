'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Play, Loader2, CheckCircle2, XCircle, AlertTriangle, Cpu, GitBranch,
  ArrowRight, Zap, Shield, TrendingUp, Clock, Activity,
} from 'lucide-react';

interface SimulationResult {
  runId: string;
  kernelVersion: string;
  settled: boolean;
  scenario: {
    name: string;
    transaction: {
      type: string;
      buyer: { country: string; currency: string; method: string };
      merchant: { country: string; currency: string; method: string };
      amount: number;
      currency: string;
      priority: string;
    };
  };
  plan: {
    metrics: {
      costPercent: number;
      totalFees: number;
      settlementTimeMs: number;
      settlementTimeLabel: string;
      riskScore: number;
      riskLabel: string;
      confidence: number;
    };
    reasoning: {
      narrative: string;
      decisions: { step: string; rationale: string }[];
      objectiveScores: { objective: string; score: number; rationale: string }[];
    };
    alternatives: { description: string; costPercent: number; settlementTimeMs: number; riskScore: number }[];
  };
  amendments: { description: string; reason: string }[];
  ledger: { accountId: string; accountLabel: string; debit: number; credit: number; balanceAfter: number; memo: string }[];
  events: { id: string; type: string; ts: number; frame: number }[];
  twinTokens: { symbol: string; amount: number; currency: string; status: string }[];
  resultHash: string;
}

const presetScenarios = [
  { label: 'GHS → KES (5,000)', buyerCountry: 'Ghana', buyerCurrency: 'GHS', merchantCountry: 'Kenya', merchantCurrency: 'KES', amount: 5000, priority: 'balanced' },
  { label: 'KES → GHS (10,000)', buyerCountry: 'Kenya', buyerCurrency: 'KES', merchantCountry: 'Ghana', merchantCurrency: 'GHS', amount: 10000, priority: 'cheapest' },
  { label: 'NGN → GHS (50,000)', buyerCountry: 'Nigeria', buyerCurrency: 'NGN', merchantCountry: 'Ghana', merchantCurrency: 'GHS', amount: 50000, priority: 'fastest' },
  { label: 'USD → KES (1,000)', buyerCountry: 'United States', buyerCurrency: 'USD', merchantCountry: 'Kenya', merchantCurrency: 'KES', amount: 1000, priority: 'safest' },
  { label: 'GHS → USD (2,000)', buyerCountry: 'Ghana', buyerCurrency: 'GHS', merchantCountry: 'United States', merchantCurrency: 'USD', amount: 2000, priority: 'balanced' },
];

export function KernelSimulationConsole() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [scenario, setScenario] = useState({
    buyerCountry: 'Ghana',
    buyerCurrency: 'GHS',
    merchantCountry: 'Kenya',
    merchantCurrency: 'KES',
    amount: 5000,
    currency: 'GHS',
    priority: 'balanced',
  });

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario: {
            name: `${scenario.buyerCountry} → ${scenario.merchantCountry} (${scenario.amount} ${scenario.currency})`,
            description: 'Admin runtime simulation',
            transaction: {
              type: scenario.buyerCountry === scenario.merchantCountry ? 'domestic' : 'cross_border',
              buyer: { country: scenario.buyerCountry, currency: scenario.buyerCurrency, method: 'mobile_money' },
              merchant: { country: scenario.merchantCountry, currency: scenario.merchantCurrency, method: 'bank' },
              amount: scenario.amount,
              currency: scenario.currency,
              merchantType: 'business',
              customerType: 'individual',
              priority: scenario.priority,
            },
            treasury: {
              originReserve: { country: scenario.buyerCountry, currency: scenario.buyerCurrency, available: 500000, minThreshold: 50000 },
              destinationReserve: { country: scenario.merchantCountry, currency: scenario.merchantCurrency, available: 500000, minThreshold: 50000 },
              stablecoinBalance: 1000000,
              emergencyTreasury: 200000,
              reservePolicy: 'tiered',
            },
            liquidityProviders: [
              { id: 'lp_1', name: 'Acacia LP', jurisdiction: 'Kenya', currencies: ['KES', 'GHS'], settlementSpeedMs: 50000, capacity: 200000, reputation: 0.85, historicalSuccess: 0.95, manualOnly: false, online: true, feeBps: 80 },
              { id: 'lp_2', name: 'Sahara LP', jurisdiction: 'Ghana', currencies: ['GHS', 'NGN'], settlementSpeedMs: 30000, capacity: 150000, reputation: 0.80, historicalSuccess: 0.92, manualOnly: false, online: true, feeBps: 90 },
            ],
            financialOperators: [
              { id: 'fo_buyer', name: 'Buyer Wallet', type: 'wallet', country: scenario.buyerCountry, currency: scenario.buyerCurrency, balance: 100000 },
              { id: 'fo_merchant', name: 'Merchant Wallet', type: 'wallet', country: scenario.merchantCountry, currency: scenario.merchantCurrency, balance: 0 },
            ],
            policies: { reservePolicy: 'tiered', maxLpShare: 0.6, maxCostPercent: 3, maxRiskScore: 0.8, requireInsurance: false },
            failures: [],
            aiWeights: { cost: 0.3, speed: 0.25, risk: 0.25, confidence: 0.2 },
          },
        }),
      });

      if (!res.ok) throw new Error('Simulation failed');
      const data: SimulationResult = await res.json();
      setResult(data);
      toast.success(`Kernel run ${data.runId.slice(0, 16)}`, {
        description: data.settled ? 'Payment settled successfully' : 'Payment blocked by kernel',
      });
    } catch (e) {
      toast.error('Simulation failed', { description: e instanceof Error ? e.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }, [scenario]);

  const applyPreset = (preset: typeof presetScenarios[0]) => {
    setScenario({
      ...preset,
      currency: preset.buyerCurrency,
    });
  };

  return (
    <div className="space-y-4">
      <Card className="border-emerald-500/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-4 w-4 text-emerald-500" />
            Kernel Scenario Runner
          </CardTitle>
          <CardDescription>
            Run a transaction through the frozen 7-primitive kernel — planner, executor, evidence, transitions, events, ledger. This is the same pipeline production uses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset scenarios */}
          <div>
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preset Scenarios</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {presetScenarios.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Scenario configuration */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label className="text-xs">Buyer Country</Label>
              <Input value={scenario.buyerCountry} onChange={(e) => setScenario({ ...scenario, buyerCountry: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Buyer Currency</Label>
              <Input value={scenario.buyerCurrency} onChange={(e) => setScenario({ ...scenario, buyerCurrency: e.target.value, currency: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Merchant Country</Label>
              <Input value={scenario.merchantCountry} onChange={(e) => setScenario({ ...scenario, merchantCountry: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Merchant Currency</Label>
              <Input value={scenario.merchantCurrency} onChange={(e) => setScenario({ ...scenario, merchantCurrency: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Amount</Label>
              <Input type="number" value={scenario.amount} onChange={(e) => setScenario({ ...scenario, amount: Number(e.target.value) })} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Priority</Label>
              <Select value={scenario.priority} onValueChange={(v) => setScenario({ ...scenario, priority: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cheapest">Cheapest</SelectItem>
                  <SelectItem value="fastest">Fastest</SelectItem>
                  <SelectItem value="safest">Safest</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={runSimulation} disabled={loading} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? 'Running through kernel...' : 'Run Kernel Simulation'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Verdict */}
          <Card className={result.settled ? 'border-emerald-500/30' : 'border-rose-500/30'}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {result.settled ? (
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  ) : (
                    <XCircle className="h-8 w-8 text-rose-500" />
                  )}
                  <div>
                    <div className="text-lg font-bold">{result.settled ? 'SETTLED' : 'BLOCKED'}</div>
                    <div className="text-xs text-muted-foreground font-mono">{result.runId.slice(0, 24)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Kernel Version</div>
                  <div className="text-sm font-mono">{result.kernelVersion}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Metrics */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-medium uppercase text-muted-foreground">Cost</span><TrendingUp className="h-3.5 w-3.5 text-emerald-500" /></div>
              <div className="mt-1 text-xl font-bold tabular-nums">{result.plan.metrics.costPercent}%</div>
              <div className="text-[10px] text-muted-foreground">{result.plan.metrics.totalFees} {result.scenario.transaction.currency}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-medium uppercase text-muted-foreground">Settlement Time</span><Clock className="h-3.5 w-3.5 text-teal-500" /></div>
              <div className="mt-1 text-xl font-bold">{result.plan.metrics.settlementTimeLabel}</div>
              <div className="text-[10px] text-muted-foreground">{result.plan.metrics.settlementTimeMs}ms</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-medium uppercase text-muted-foreground">Risk</span><Shield className="h-3.5 w-3.5 text-amber-500" /></div>
              <div className="mt-1 text-xl font-bold tabular-nums">{result.plan.metrics.riskScore.toFixed(2)}</div>
              <div className="text-[10px] text-muted-foreground">{result.plan.metrics.riskLabel}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="flex items-center justify-between"><span className="text-[10px] font-medium uppercase text-muted-foreground">Confidence</span><Zap className="h-3.5 w-3.5 text-emerald-500" /></div>
              <div className="mt-1 text-xl font-bold tabular-nums">{result.plan.metrics.confidence}%</div>
            </CardContent></Card>
          </div>

          {/* AI Narrative */}
          {result.plan.reasoning.narrative && (
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-500" /> AI Reasoning</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{result.plan.reasoning.narrative}</p>
                {result.plan.reasoning.decisions.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Decisions</div>
                    {result.plan.reasoning.decisions.map((d, i) => (
                      <div key={i} className="text-xs">
                        <span className="font-medium text-foreground">{d.step}:</span>{' '}
                        <span className="text-muted-foreground">{d.rationale}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Transaction flow */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2"><GitBranch className="h-4 w-4 text-teal-500" /> Transaction Flow</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 text-sm">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Buyer</div>
                  <div className="font-semibold">{result.scenario.transaction.buyer.country}</div>
                  <div className="text-xs text-muted-foreground">{result.scenario.transaction.buyer.method}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="font-semibold">{result.scenario.transaction.amount} {result.scenario.transaction.currency}</div>
                  <div className="text-xs text-muted-foreground">{result.scenario.transaction.priority}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Merchant</div>
                  <div className="font-semibold">{result.scenario.transaction.merchant.country}</div>
                  <div className="text-xs text-muted-foreground">{result.scenario.transaction.merchant.method}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Amendments */}
          {result.amendments.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Plan Amendments ({result.amendments.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.amendments.map((a, i) => (
                    <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                      <div className="font-medium">{a.description}</div>
                      <div className="text-muted-foreground mt-0.5">{a.reason}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ledger entries */}
          {result.ledger.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Ledger Entries ({result.ledger.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-y-auto overflow-x-auto pr-1
                  [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full
                  [&::-webkit-scrollbar-thumb]:bg-muted [&::-webkit-scrollbar-track]:bg-transparent">
                  <div className="space-y-1">
                    {result.ledger.map((entry, i) => (
                      <div key={i} className="flex items-center gap-3 rounded border p-2 text-xs font-mono">
                        <span className="flex-1 truncate">{entry.accountLabel}</span>
                        {entry.debit > 0 && <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">DR {entry.debit}</Badge>}
                        {entry.credit > 0 && <Badge variant="outline" className="text-rose-600 border-rose-500/30">CR {entry.credit}</Badge>}
                        <span className="text-muted-foreground">Bal: {entry.balanceAfter}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Events */}
          {result.events.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Event Stream ({result.events.length} events)</CardTitle></CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto overflow-x-auto pr-1
                  [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full
                  [&::-webkit-scrollbar-thumb]:bg-muted [&::-webkit-scrollbar-track]:bg-transparent">
                  <div className="space-y-1">
                    {result.events.slice(0, 30).map((evt) => (
                      <div key={evt.id} className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-muted-foreground w-8">f{evt.frame}</span>
                        <Badge variant="outline" className="text-[9px]">{evt.type.split('.')[0]}</Badge>
                        <span className="flex-1 truncate">{evt.type}</span>
                      </div>
                    ))}
                    {result.events.length > 30 && (
                      <div className="text-xs text-muted-foreground text-center pt-2">...and {result.events.length - 30} more</div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Twin Tokens */}
          {result.twinTokens.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Twin Tokens ({result.twinTokens.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.twinTokens.map((tt, i) => (
                    <div key={i} className="flex items-center gap-3 rounded border p-2 text-sm">
                      <Badge variant="outline" className="font-mono">{tt.symbol}</Badge>
                      <span className="font-semibold tabular-nums">{tt.amount}</span>
                      <span className="text-muted-foreground">{tt.currency}</span>
                      <Badge variant={tt.status === 'minted' ? 'default' : 'secondary'} className="ml-auto text-[10px]">{tt.status}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Result hash */}
          <div className="text-center text-xs text-muted-foreground font-mono">
            Result hash: {result.resultHash}
          </div>
        </div>
      )}
    </div>
  );
}
