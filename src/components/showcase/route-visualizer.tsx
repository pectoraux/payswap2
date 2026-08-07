'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Play, Trophy, ArrowRight, ArrowDown, Zap, Shield, Clock,
  Droplets, Smile, Users, Leaf, Building2, ChevronRight,
} from 'lucide-react';
import { postShowcase } from './shared';

// ── Objective icons + colors ──
const OBJECTIVES = [
  { key: 'cost', label: 'Cost', icon: Zap, color: '#10b981' },
  { key: 'speed', label: 'Speed', icon: Clock, color: '#0ea5e9' },
  { key: 'safety', label: 'Safety', icon: Shield, color: '#8b5cf6' },
  { key: 'liquidityPreservation', label: 'Liquidity', icon: Droplets, color: '#06b6d4' },
  { key: 'merchantSatisfaction', label: 'Merchant', icon: Smile, color: '#f59e0b' },
  { key: 'communityImpact', label: 'Community', icon: Users, color: '#ec4899' },
  { key: 'carbonImpact', label: 'Carbon', icon: Leaf, color: '#22c55e' },
  { key: 'treasuryHealth', label: 'Treasury', icon: Building2, color: '#6366f1' },
];

interface Candidate {
  label: string;
  strategy: string;
  weightedScore: number;
  objectiveScores: Array<{ objective: string; score: number; raw: number; rationale: string }>;
  notes: string;
  isWinner: boolean;
}

interface RouteStep {
  frame: number;
  type: string;
  title: string;
  description: string;
  amount?: number;
  currency?: string;
}

interface RouteVisualization {
  strategy: string;
  candidates: Candidate[];
  winner: Candidate;
  steps: RouteStep[];
  metrics: {
    costPercent: number;
    settlementTimeMs: number;
    settlementTimeLabel: string;
    riskScore: number;
    riskLabel: string;
    confidence: number;
    twinTokensMinted: number;
  };
  feeModel: { totalFeeBps: number; lpSharePercent: number; payswapSharePercent: number };
  requiredBandwidth: Array<{ assetType: string; country: string; currency: string; amount: number }>;
  stablecoinUsage: { required: boolean; amount: number; source: string };
  settlementActions: Array<{ type: string; reason: string }>;
}

function ScoreBar({ score, color, label }: { score: number; color: string; label: string }) {
  const pct = Math.min(100, Math.max(0, score * 100));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 text-[9px] text-muted-foreground">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-7 text-right text-[9px] tabular-nums text-muted-foreground">{(score * 100).toFixed(0)}</span>
    </div>
  );
}

function CandidateCard({ candidate, rank }: { candidate: Candidate; rank: number }) {
  const isWinner = candidate.isWinner;
  return (
    <div className={`rounded-lg border p-3 transition-all ${isWinner ? 'border-emerald-500/50 bg-emerald-500/5 shadow-md' : 'border-border/60 bg-muted/20 opacity-70'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isWinner && <Trophy className="h-3.5 w-3.5 text-emerald-500" />}
          <span className="text-xs font-semibold">{candidate.label}</span>
          {isWinner && <Badge className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[9px] text-emerald-600">WINNER</Badge>}
        </div>
        <span className="text-xs font-bold tabular-nums text-foreground">{candidate.weightedScore.toFixed(3)}</span>
      </div>
      <div className="mt-2 space-y-1">
        {candidate.objectiveScores.map((o) => {
          const obj = OBJECTIVES.find((x) => x.key === o.objective);
          return <ScoreBar key={o.objective} score={o.score} color={obj?.color ?? '#64748b'} label={obj?.label ?? o.objective} />;
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{candidate.notes}</p>
    </div>
  );
}

function ExecutionFlow({ steps, strategy }: { steps: RouteStep[]; strategy: string }) {
  const stepColors: Record<string, string> = {
    debit_source: 'border-amber-500/40 bg-amber-500/5',
    credit_reserve: 'border-emerald-500/40 bg-emerald-500/5',
    fx_convert: 'border-sky-500/40 bg-sky-500/5',
    mint_twin: 'border-violet-500/40 bg-violet-500/5',
    draw_reserve: 'border-emerald-500/40 bg-emerald-500/5',
    draw_treasury: 'border-indigo-500/40 bg-indigo-500/5',
    draw_lp: 'border-teal-500/40 bg-teal-500/5',
    burn_twin: 'border-rose-500/40 bg-rose-500/5',
    credit_destination: 'border-emerald-500/40 bg-emerald-500/5',
    create_contract: 'border-cyan-500/40 bg-cyan-500/5',
    fund_contract: 'border-cyan-500/40 bg-cyan-500/5',
    lock_stablecoin: 'border-cyan-500/40 bg-cyan-500/5',
    claim: 'border-teal-500/40 bg-teal-500/5',
    confirm: 'border-emerald-500/40 bg-emerald-500/5',
    release_escrow: 'border-emerald-500/40 bg-emerald-500/5',
    close_contract: 'border-emerald-500/40 bg-emerald-500/5',
  };
  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center gap-2">
        <ArrowRight className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-xs font-semibold">Execution flow — {strategy}</span>
        <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{steps.length} steps</Badge>
      </div>
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex flex-col items-center">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${stepColors[step.type] ?? 'border-border bg-muted'}`}>
              {step.frame}
            </div>
            {i < steps.length - 1 && <div className="h-4 w-px bg-border/60" />}
          </div>
          <div className={`flex-1 rounded-md border px-2.5 py-1.5 ${stepColors[step.type] ?? 'border-border bg-muted'}`}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium">{step.title}</span>
              {step.amount != null && step.amount > 0 && (
                <span className="text-[10px] tabular-nums text-muted-foreground">{step.amount.toLocaleString()} {step.currency ?? ''}</span>
              )}
            </div>
            <p className="text-[10px] leading-snug text-muted-foreground">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RouteVisualizer() {
  const [fromCountry, setFromCountry] = useState('Ghana');
  const [toCountry, setToCountry] = useState('Kenya');
  const [amount, setAmount] = useState(5000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteVisualization | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runRoute() {
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await postShowcase<RouteVisualization>({ action: 'visualizeRoute', fromCountry, toCountry, amount });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-emerald-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-emerald-500" /> Payment routing visualizer
          </CardTitle>
          <Button size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700" onClick={runRoute} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            {loading ? 'Routing…' : 'Route payment'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">From country</Label>
            <Input value={fromCountry} onChange={(e) => setFromCountry(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">To country</Label>
            <Input value={toCountry} onChange={(e) => setToCountry(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-8 text-xs" />
          </div>
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        {loading && (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* Strategy banner */}
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Strategy</span>
                <div className="text-sm font-bold text-emerald-600">{result.strategy}</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Fee</span>
                <div className="text-sm font-bold">{result.feeModel.totalFeeBps}bps</div>
                <div className="text-[10px] text-muted-foreground">LP {result.feeModel.lpSharePercent}% / PS {result.feeModel.payswapSharePercent}%</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</span>
                <div className="text-sm font-bold">{result.metrics.costPercent}%</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Time</span>
                <div className="text-sm font-bold">{result.metrics.settlementTimeLabel}</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk</span>
                <div className="text-sm font-bold">{result.metrics.riskLabel}</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Confidence</span>
                <div className="text-sm font-bold tabular-nums">{result.metrics.confidence}%</div>
              </div>
            </div>

            {/* 8 objectives legend */}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                8-objective weighted scoring
              </div>
              <div className="flex flex-wrap gap-3">
                {OBJECTIVES.map((o) => (
                  <div key={o.key} className="flex items-center gap-1">
                    <o.icon className="h-3 w-3" style={{ color: o.color }} />
                    <span className="text-[10px] text-muted-foreground">{o.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Candidates */}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                5 candidate routes compete — winner selected by weighted score
              </div>
              <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                {result.candidates.map((c, i) => (
                  <CandidateCard key={i} candidate={c} rank={i + 1} />
                ))}
              </div>
            </div>

            {/* Execution flow */}
            <div>
              <ExecutionFlow steps={result.steps} strategy={result.strategy} />
            </div>

            {/* Bandwidth + settlement */}
            <div className="grid gap-3 lg:grid-cols-2">
              {result.requiredBandwidth.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bandwidth consumed</div>
                  <div className="space-y-1">
                    {result.requiredBandwidth.map((bw, i) => (
                      <div key={i} className="flex items-center justify-between rounded border border-border/60 bg-muted/20 px-2 py-1 text-[11px]">
                        <span className="font-mono">{bw.assetType}</span>
                        <span className="text-muted-foreground">{bw.country} {bw.currency}</span>
                        <span className="font-semibold tabular-nums">{bw.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result.settlementActions.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Settlement actions</div>
                  <div className="space-y-1">
                    {result.settlementActions.map((a, i) => (
                      <div key={i} className="rounded border border-border/60 bg-muted/20 px-2 py-1 text-[11px]">
                        <span className="font-mono text-cyan-600">{a.type}</span>
                        <p className="text-[10px] text-muted-foreground">{a.reason.slice(0, 80)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Stablecoin usage */}
            {result.stablecoinUsage.required && (
              <div className="rounded-md border border-indigo-500/20 bg-indigo-500/5 p-2 text-[11px]">
                <span className="font-semibold text-indigo-600">Stablecoin bridge:</span> {result.stablecoinUsage.amount.toLocaleString()} USDC from {result.stablecoinUsage.source}
              </div>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="flex h-32 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <Zap className="mb-2 h-6 w-6 opacity-30" />
            Enter a corridor and amount, then click "Route payment" to see how the system routes it through 5 competing strategies, scores them across 8 objectives, and executes the winner.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
