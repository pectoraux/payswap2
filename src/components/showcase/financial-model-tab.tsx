'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Play, DollarSign, TrendingUp, Building2, Users, Calculator,
  Send, Sparkles, ArrowRight, BarChart3,
} from 'lucide-react';
import { postShowcase } from './shared';

// ── Competitor fees (static, for comparison) ──
const COMPETITORS = [
  { name: 'PaySwap', local: 80, crossBorder: 120, note: 'LOCAL_RAIL/RESERVE: 80bps; MARKET: 120-150bps' },
  { name: 'Paystack', local: 150, crossBorder: 390, note: '1.5% local, 3.9% international' },
  { name: 'Flutterwave', local: 140, crossBorder: 380, note: '1.4% local, 3.8% international' },
  { name: 'Stripe', local: 290, crossBorder: 340, note: '2.9%+$0.30, not available in Africa' },
  { name: 'Mobile Money', local: 100, crossBorder: 250, note: 'MTN/Airtel, limited corridors' },
  { name: 'CinetPay', local: 180, crossBorder: 350, note: 'Francophone Africa' },
  { name: 'Western Union', local: 500, crossBorder: 700, note: '5-7%, slow (1-3 days)' },
  { name: 'Bank Transfer', local: 200, crossBorder: 400, note: '$15-40 flat, 1-3 days' },
];

interface SimInputs {
  startingReserve: number;
  numLPs: number;
  startingCountries: string;
  localFeeBps: number;
  crossBorderFeeBps: number;
  dailyTxVolume: number;
  yearlyGrowth: number;
  horizon: '1y' | '2y' | '3y';
}

interface SimOutputs {
  payswapRevenue: number;
  lpRevenue: number;
  totalFees: number;
  finalReserves: number;
  reserveGrowth: number;
  contractsCreated: number;
  avgCustomerCost: number;
  avgCompetitorCost: number;
  savingsPercent: number;
  bootstrapDay: number;
  selfSustainingDay: number;
  breakEvenFeeBps: number;
  recommendedFeeBps: number;
}

function computeOutputs(inputs: SimInputs): SimOutputs {
  const { startingReserve, numLPs, localFeeBps, crossBorderFeeBps, dailyTxVolume, yearlyGrowth, horizon } = inputs;
  const days = horizon === '1y' ? 365 : horizon === '2y' ? 730 : 1095;

  // Simple deterministic model (mirrors the economic simulation logic)
  let reserve = startingReserve;
  let payswapRev = 0;
  let lpRev = 0;
  let totalFees = 0;
  let contracts = 0;
  let bootstrapDay = -1;
  let selfSustainingDay = -1;
  let totalCustomerCost = 0;
  let totalCompetitorCost = 0;
  let count = 0;

  for (let day = 0; day < days; day++) {
    const growth = Math.pow(yearlyGrowth, day / 365);
    const dailyTx = Math.floor(dailyTxVolume * growth * (0.8 + 0.4 * Math.sin(day / 7)));
    for (let t = 0; t < Math.min(dailyTx, 3); t++) {
      const isCrossBorder = Math.random() < 0.6;
      const feeBps = isCrossBorder ? crossBorderFeeBps : localFeeBps;
      const amount = 50 + Math.floor(Math.random() * 4950);
      const fee = (amount * feeBps) / 10000;
      const psShare = isCrossBorder ? fee * 0.2 : fee * 1.0; // MARKET: 20% PS; LOCAL: 100% PS
      const lpShare = fee - psShare;

      payswapRev += psShare;
      lpRev += lpShare;
      totalFees += fee;
      totalCustomerCost += fee;
      totalCompetitorCost += (amount * (isCrossBorder ? 390 : 150)) / 10000; // Paystack comparison
      count++;

      if (isCrossBorder) contracts++;
      // Reinvest 50% of PS revenue into reserves
      reserve += psShare * 0.5;

      if (reserve > 500_000 && selfSustainingDay < 0) selfSustainingDay = day;
      if (reserve > 100_000 && bootstrapDay < 0 && startingReserve < 100_000) bootstrapDay = day;
    }
  }

  const avgCustomerCost = count > 0 ? totalCustomerCost / count : 0;
  const avgCompetitorCost = count > 0 ? totalCompetitorCost / count : 0;
  const savingsPercent = avgCompetitorCost > 0 ? Math.round((1 - avgCustomerCost / avgCompetitorCost) * 100) : 0;

  return {
    payswapRevenue: Math.round(payswapRev),
    lpRevenue: Math.round(lpRev),
    totalFees: Math.round(totalFees),
    finalReserves: Math.round(reserve),
    reserveGrowth: startingReserve > 0 ? Math.round(((reserve / startingReserve) - 1) * 100) : 0,
    contractsCreated: contracts,
    avgCustomerCost: Math.round(avgCustomerCost * 100) / 100,
    avgCompetitorCost: Math.round(avgCompetitorCost * 100) / 100,
    savingsPercent,
    bootstrapDay,
    selfSustainingDay,
    breakEvenFeeBps: 50,
    recommendedFeeBps: Math.round((localFeeBps + crossBorderFeeBps) / 2),
  };
}

function StatCard({ label, value, sub, icon: Icon, color = 'emerald' }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string;
}) {
  const colors: Record<string, string> = {
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600',
    sky: 'border-sky-500/20 bg-sky-500/5 text-sky-600',
    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-600',
    violet: 'border-violet-500/20 bg-violet-500/5 text-violet-600',
    rose: 'border-rose-500/20 bg-rose-500/5 text-rose-600',
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[color] ?? colors.emerald}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide opacity-80">{label}</span>
        <Icon className="h-3.5 w-3.5 opacity-70" />
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] opacity-70">{sub}</div>}
    </div>
  );
}

export function FinancialModelTab() {
  const [inputs, setInputs] = useState<SimInputs>({
    startingReserve: 70000,
    numLPs: 12,
    startingCountries: 'Ghana',
    localFeeBps: 80,
    crossBorderFeeBps: 120,
    dailyTxVolume: 20,
    yearlyGrowth: 1.5,
    horizon: '1y',
  });

  const [outputs, setOutputs] = useState<SimOutputs | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiScrollRef = useRef<HTMLDivElement>(null);

  // Recompute on input change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setOutputs(computeOutputs(inputs));
    }, 300);
    return () => clearTimeout(timer);
  }, [inputs]);

  const updateInput = (key: keyof SimInputs, value: string | number) => {
    setInputs((p) => ({ ...p, [key]: value }));
  };

  async function askAI() {
    if (!aiQuestion.trim() || !outputs) return;
    setAiLoading(true); setAiResponse(null);
    try {
      const r = await fetch('/api/ai/financial-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: aiQuestion, context: { inputs, outputs } }),
      });
      const data = await r.json();
      if (data.ok) {
        setAiResponse(data.response);
      } else {
        setAiResponse(data.fallback ?? 'AI unavailable');
      }
    } catch {
      setAiResponse('Failed to reach AI assistant');
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Input controls */}
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Calculator className="h-4 w-4 text-emerald-500" /> Financial model inputs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <Label className="text-[11px] text-muted-foreground">Starting reserve ($)</Label>
              <Input type="number" value={inputs.startingReserve} onChange={(e) => updateInput('startingReserve', Number(e.target.value))} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Number of LPs</Label>
              <Input type="number" value={inputs.numLPs} onChange={(e) => updateInput('numLPs', Number(e.target.value))} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Starting countries</Label>
              <Input value={inputs.startingCountries} onChange={(e) => updateInput('startingCountries', e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Horizon</Label>
              <select value={inputs.horizon} onChange={(e) => updateInput('horizon', e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
                <option value="1y">1 year</option>
                <option value="2y">2 years</option>
                <option value="3y">3 years</option>
              </select>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Local fee (bps)</Label>
              <Input type="number" value={inputs.localFeeBps} onChange={(e) => updateInput('localFeeBps', Number(e.target.value))} className="h-8 text-xs" />
              <span className="text-[10px] text-muted-foreground">{(inputs.localFeeBps / 100).toFixed(2)}%</span>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Cross-border fee (bps)</Label>
              <Input type="number" value={inputs.crossBorderFeeBps} onChange={(e) => updateInput('crossBorderFeeBps', Number(e.target.value))} className="h-8 text-xs" />
              <span className="text-[10px] text-muted-foreground">{(inputs.crossBorderFeeBps / 100).toFixed(2)}%</span>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Daily tx volume</Label>
              <Input type="number" value={inputs.dailyTxVolume} onChange={(e) => updateInput('dailyTxVolume', Number(e.target.value))} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Yearly growth (x)</Label>
              <Input type="number" step="0.1" value={inputs.yearlyGrowth} onChange={(e) => updateInput('yearlyGrowth', Number(e.target.value))} className="h-8 text-xs" />
              <span className="text-[10px] text-muted-foreground">{((inputs.yearlyGrowth - 1) * 100).toFixed(0)}% YoY</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live outputs */}
      {outputs && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="PaySwap revenue" value={`$${outputs.payswapRevenue.toLocaleString()}`} sub={inputs.horizon} icon={DollarSign} />
            <StatCard label="LP revenue" value={`$${outputs.lpRevenue.toLocaleString()}`} sub={`${inputs.numLPs} LPs`} icon={Users} color="sky" />
            <StatCard label="Total fees" value={`$${outputs.totalFees.toLocaleString()}`} sub="collected" icon={BarChart3} color="amber" />
            <StatCard label="Final reserves" value={`$${outputs.finalReserves.toLocaleString()}`} sub={`${outputs.reserveGrowth}% growth`} icon={Building2} color="violet" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Contracts" value={outputs.contractsCreated.toLocaleString()} sub="settlement contracts" icon={ArrowRight} />
            <StatCard label="Avg customer cost" value={`$${outputs.avgCustomerCost}`} sub="per transaction" icon={DollarSign} />
            <StatCard label="Avg competitor cost" value={`$${outputs.avgCompetitorCost}`} sub="Paystack equivalent" icon={TrendingUp} color="rose" />
            <StatCard label="Customer savings" value={`${outputs.savingsPercent}%`} sub="vs Paystack" icon={Sparkles} color={outputs.savingsPercent > 50 ? 'emerald' : 'amber'} />
          </div>

          {/* Bootstrap analysis */}
          <Card className="border-emerald-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-emerald-500" /> Bootstrap analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Starting capital</div>
                  <div className="text-lg font-bold tabular-nums">${inputs.startingReserve.toLocaleString()}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Final reserves</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-600">${outputs.finalReserves.toLocaleString()}</div>
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Break-even fee</div>
                  <div className="text-lg font-bold tabular-nums">{outputs.breakEvenFeeBps}bps</div>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Recommended fee</div>
                  <div className="text-lg font-bold tabular-nums text-emerald-600">{outputs.recommendedFeeBps}bps</div>
                </div>
              </div>
              {outputs.bootstrapDay >= 0 && (
                <p className="mt-2 text-xs text-emerald-600">✓ Bootstrap complete on day {outputs.bootstrapDay} (~{Math.round(outputs.bootstrapDay / 30)} months)</p>
              )}
              {outputs.selfSustainingDay >= 0 && (
                <p className="mt-1 text-xs text-emerald-600">✓ Self-sustaining from day {outputs.selfSustainingDay} (~{Math.round(outputs.selfSustainingDay / 30)} months)</p>
              )}
            </CardContent>
          </Card>

          {/* Competitor comparison */}
          <Card className="border-emerald-500/20">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart3 className="h-4 w-4 text-emerald-500" /> Cost comparison vs alternatives
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left">Provider</th>
                      <th className="py-2 text-right">Local</th>
                      <th className="py-2 text-right">Cross-border</th>
                      <th className="py-2 text-right">vs PaySwap (local)</th>
                      <th className="py-2 text-right">vs PaySwap (x-border)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPETITORS.map((c) => {
                      const localDiff = c.local - inputs.localFeeBps;
                      const xBorderDiff = c.crossBorder - inputs.crossBorderFeeBps;
                      const isPaySwap = c.name === 'PaySwap';
                      return (
                        <tr key={c.name} className={`border-b border-border/30 ${isPaySwap ? 'bg-emerald-500/5' : ''}`}>
                          <td className="py-2 font-medium">{c.name}{isPaySwap && <Badge className="ml-1 border-emerald-500/40 px-1 py-0 text-[8px] text-emerald-600">YOU</Badge>}</td>
                          <td className="py-2 text-right tabular-nums">{c.local}bps ({(c.local / 100).toFixed(1)}%)</td>
                          <td className="py-2 text-right tabular-nums">{c.crossBorder}bps ({(c.crossBorder / 100).toFixed(1)}%)</td>
                          <td className={`py-2 text-right tabular-nums ${localDiff > 0 ? 'text-emerald-600' : localDiff < 0 ? 'text-rose-600' : ''}`}>
                            {localDiff === 0 ? '—' : `${localDiff > 0 ? '+' : ''}${localDiff}bps`}
                          </td>
                          <td className={`py-2 text-right tabular-nums ${xBorderDiff > 0 ? 'text-emerald-600' : xBorderDiff < 0 ? 'text-rose-600' : ''}`}>
                            {xBorderDiff === 0 ? '—' : `${xBorderDiff > 0 ? '+' : ''}${xBorderDiff}bps`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                At {inputs.localFeeBps}bps local / {inputs.crossBorderFeeBps}bps cross-border, PaySwap is {Math.round((1 - inputs.localFeeBps / 150) * 100)}% cheaper than Paystack locally and {Math.round((1 - inputs.crossBorderFeeBps / 390) * 100)}% cheaper for cross-border.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* AI assistant */}
      <Card className="border-violet-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-violet-500" /> AI financial assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Ask about pricing, reserves, LP economics, competitor positioning, bootstrap strategy, or how the routing system works.
          </p>
          <div className="flex gap-2">
            <Input
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && askAI()}
              placeholder="e.g. How much should I charge to be competitive? When will we be self-sustaining?"
              className="h-8 text-xs"
            />
            <Button size="sm" className="h-8 bg-violet-600 text-white hover:bg-violet-700" onClick={askAI} disabled={aiLoading || !outputs}>
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {/* Quick questions */}
          <div className="flex flex-wrap gap-1.5">
            {[
              'How does route optimization work?',
              'When will we be self-sustaining?',
              'How much do LPs earn?',
              'How do we compare to Paystack?',
              'What fee should I charge?',
              'How much do we need to start?',
            ].map((q) => (
              <button
                key={q}
                onClick={() => setAiQuestion(q)}
                className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-violet-500/30 hover:bg-violet-500/5 hover:text-violet-600"
              >
                {q}
              </button>
            ))}
          </div>
          {aiResponse && (
            <ScrollArea className="max-h-64 pr-2">
              <div ref={aiScrollRef} className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {aiResponse}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
