'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, Play, CheckCircle2, XCircle, AlertTriangle, ArrowRight,
  Building2, Users, Banknote, Coins, ScrollText, Zap, Inbox,
  TrendingUp, Globe2,
} from 'lucide-react';
import { postShowcase } from './shared';

// ── Types ──
interface WorldState {
  countries: Array<{ name: string; currency: string; hasReserve: boolean; fiatReserve: number; stablecoinReserve: number }>;
  lps: Array<{ id: string; country: string; hasBandwidth: boolean; fiatBw: number; stablecoinBw: number; twinBw: number; type: string }>;
  marketplaceContracts: Array<{ id: string; from: string; to: string; amount: number; status: string; strategy: string }>;
}

interface FlowStep {
  id: number;
  label: string;
  detail: string;
  icon: string;
  status: 'done' | 'warning' | 'error';
}

interface PaymentFlowResult {
  ok: boolean;
  worldState: WorldState;
  routing: {
    strategy: string; feeBps: number; feeAmount: number; payswapRevenue: number; lpRevenue: number;
    fromCountry: string; toCountry: string; amount: number; fromCurrency: string; toCurrency: string; isCrossBorder: boolean;
  };
  bandwidth: Array<{ assetType: string; country: string; amount: number; available: number; sufficient: boolean }>;
  contract: { needsContract: boolean; contractPath: string; contractSteps: string[] };
  pipeline: { dispatched: boolean; events: Array<{ type: string }>; ledgerEntries: number; latencyMs: number; error?: string };
  flowSteps: FlowStep[];
  costComparison: { paySwapCost: number; paystackCost: number; savings: number; savingsPercent: number };
  message: string;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  inbox: Inbox,
  strategy: Zap,
  reserve: Building2,
  bandwidth: Banknote,
  contract: ScrollText,
  pipeline: Globe2,
  checkmark: CheckCircle2,
};

const STEP_COLORS: Record<string, string> = {
  done: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-600',
  warning: 'border-amber-500/40 bg-amber-500/5 text-amber-600',
  error: 'border-rose-500/40 bg-rose-500/5 text-rose-600',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

// ── World state panel ──
function WorldStatePanel({ world }: { world: WorldState }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {/* Reserves per country */}
      <Card className="border-emerald-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Building2 className="h-3.5 w-3.5 text-emerald-500" /> Reserves by country
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {world.countries.map((c) => (
            <div key={c.name} className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 ${c.hasReserve ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/60 bg-muted/20'}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{c.name}</span>
                <Badge variant="outline" className="px-1 py-0 text-[8px]">{c.currency}</Badge>
              </div>
              <div className="text-right">
                {c.hasReserve ? (
                  <div>
                    <div className="text-xs font-bold tabular-nums text-emerald-600">{fmt(c.fiatReserve)}</div>
                    <div className="text-[9px] text-muted-foreground">+ {fmt(c.stablecoinReserve)} USDC</div>
                  </div>
                ) : (
                  <Badge variant="outline" className="border-rose-500/30 px-1 py-0 text-[8px] text-rose-600">NO RESERVE</Badge>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* LPs + bandwidth */}
      <Card className="border-sky-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <Users className="h-3.5 w-3.5 text-sky-500" /> LP bandwidth
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {world.lps.map((lp) => (
            <div key={lp.id} className={`rounded-md border px-2.5 py-1.5 ${lp.hasBandwidth ? 'border-sky-500/30 bg-sky-500/5' : 'border-border/60 bg-muted/20'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono">{lp.id}</span>
                  <Badge variant="outline" className="px-1 py-0 text-[8px]">{lp.country}</Badge>
                </div>
                <Badge variant="outline" className={`px-1 py-0 text-[8px] ${lp.type === 'automatic' ? 'border-emerald-500/30 text-emerald-600' : 'border-amber-500/30 text-amber-600'}`}>
                  {lp.type}
                </Badge>
              </div>
              {lp.hasBandwidth ? (
                <div className="mt-1 grid grid-cols-3 gap-1 text-[9px]">
                  <span className="text-muted-foreground">fiat: <span className="font-medium text-foreground tabular-nums">{fmt(lp.fiatBw)}</span></span>
                  <span className="text-muted-foreground">USDC: <span className="font-medium text-foreground tabular-nums">{fmt(lp.stablecoinBw)}</span></span>
                  <span className="text-muted-foreground">twin: <span className="font-medium text-foreground tabular-nums">{fmt(lp.twinBw)}</span></span>
                </div>
              ) : (
                <div className="mt-0.5 text-[9px] text-muted-foreground">Capital provider only (marketplace claims)</div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Marketplace */}
      <Card className="border-violet-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-xs">
            <ScrollText className="h-3.5 w-3.5 text-violet-500" /> LP marketplace
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {world.marketplaceContracts.length > 0 ? (
            world.marketplaceContracts.map((sc) => (
              <div key={sc.id} className="rounded-md border border-violet-500/30 bg-violet-500/5 px-2.5 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono">{sc.id}</span>
                  <Badge variant="outline" className="border-amber-500/30 px-1 py-0 text-[8px] text-amber-600">{sc.status}</Badge>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {sc.from} → {sc.to} · {fmt(sc.amount)} · {sc.strategy}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-[10px] text-muted-foreground py-4">No pending contracts</div>
          )}
          <div className="mt-2 rounded-md bg-muted/30 p-2 text-[10px] text-muted-foreground">
            <Users className="mr-1 inline h-3 w-3" />
            {world.lps.filter((l) => l.hasBandwidth).length} LPs with bandwidth · {world.lps.filter((l) => !l.hasBandwidth).length} capital-only LPs
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Animated flow step ──
function AnimatedFlowStep({ step, index, visible }: { step: FlowStep; index: number; visible: boolean }) {
  const Icon = STEP_ICONS[step.icon] ?? Zap;
  const colorClass = STEP_COLORS[step.status] ?? STEP_COLORS.done;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, x: -20, height: 0 }}
          animate={{ opacity: 1, x: 0, height: 'auto' }}
          exit={{ opacity: 0, x: 20, height: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex items-start gap-3"
        >
          {/* Step number + connecting line */}
          <div className="flex flex-col items-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${colorClass}`}
            >
              <Icon className="h-4 w-4" />
            </motion.div>
            {index < 7 && <motion.div initial={{ height: 0 }} animate={{ height: '100%' }} transition={{ delay: 0.4, duration: 0.3 }} className="w-px flex-1 bg-border/60" />}
          </div>

          {/* Step content */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className={`flex-1 rounded-lg border px-3 py-2 mb-2 ${colorClass}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">{step.label}</span>
              {step.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
              {step.status === 'warning' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
              {step.status === 'error' && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
            </div>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{step.detail}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Main component ──
export function PaymentFlowVisualizer() {
  const [fromCountry, setFromCountry] = useState('Ghana');
  const [toCountry, setToCountry] = useState('Kenya');
  const [amount, setAmount] = useState(5000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PaymentFlowResult | null>(null);
  const [visibleSteps, setVisibleSteps] = useState(0);

  // Animate steps appearing one by one
  useEffect(() => {
    if (result && result.flowSteps) {
      setVisibleSteps(0);
      const interval = setInterval(() => {
        setVisibleSteps((prev) => {
          if (prev >= result.flowSteps.length) {
            clearInterval(interval);
            return prev;
          }
          return prev + 1;
        });
      }, 400); // 400ms per step
      return () => clearInterval(interval);
    }
  }, [result]);

  async function runFlow() {
    setLoading(true); setResult(null); setVisibleSteps(0);
    try {
      const r = await postShowcase<PaymentFlowResult>({ action: 'simulatePaymentFlow', fromCountry, toCountry, amount });
      setResult(r);
    } catch (e) {
      console.error('Flow failed:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-emerald-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-emerald-500" /> Payment flow visualizer
          </CardTitle>
          <Button size="sm" className="h-7 bg-emerald-600 text-white hover:bg-emerald-700" onClick={runFlow} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
            {loading ? 'Routing…' : 'Simulate payment'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Shows the world state (reserves, LPs, bandwidth, marketplace), routes the payment through the unified pipeline (RuntimeHost → dispatcher → handler → invariants → event store), and animates each step.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-[11px] text-muted-foreground">From</Label>
            <select value={fromCountry} onChange={(e) => setFromCountry(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option>Ghana</option><option>Togo</option><option>Kenya</option><option>Nigeria</option>
            </select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">To</Label>
            <select value={toCountry} onChange={(e) => setToCountry(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option>Ghana</option><option>Togo</option><option>Kenya</option><option>Nigeria</option>
            </select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-8 text-xs" />
          </div>
        </div>

        {loading && (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          </div>
        )}

        {result && (
          <div className="space-y-4">
            {/* World state */}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                World state — what we're working with
              </div>
              <WorldStatePanel world={result.worldState} />
            </div>

            {/* Strategy banner */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3"
            >
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Strategy</span>
                <div className="text-sm font-bold text-emerald-600">{result.routing.strategy}</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Fee</span>
                <div className="text-sm font-bold">{result.routing.feeBps}bps</div>
                <div className="text-[10px] text-muted-foreground">PS ${result.routing.payswapRevenue} / LP ${result.routing.lpRevenue}</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Pipeline</span>
                <div className="text-sm font-bold">{result.pipeline.events.length} events</div>
                <div className="text-[10px] text-muted-foreground">{result.pipeline.ledgerEntries} ledger entries · {result.pipeline.latencyMs}ms</div>
              </div>
              <Separator orientation="vertical" className="h-8" />
              <div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">vs Paystack</span>
                <div className="text-sm font-bold text-emerald-600">{result.costComparison.savingsPercent}% cheaper</div>
                <div className="text-[10px] text-muted-foreground">${result.costComparison.paySwapCost} vs ${result.costComparison.paystackCost}</div>
              </div>
            </motion.div>

            {/* Contract lifecycle */}
            {result.contract.needsContract && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <ScrollText className="h-3.5 w-3.5 text-violet-500" />
                  <span className="text-xs font-semibold">Settlement contract lifecycle</span>
                  <Badge variant="outline" className="border-violet-500/30 px-1 py-0 text-[9px] text-violet-600">{result.contract.contractPath}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {result.contract.contractSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <motion.span
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.6 + i * 0.1 }}
                        className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-600"
                      >
                        {step}
                      </motion.span>
                      {i < result.contract.contractSteps.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Bandwidth consumed */}
            {result.bandwidth.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bandwidth consumed</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {result.bandwidth.map((bw, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.1 }}
                      className={`rounded-md border px-2.5 py-1.5 ${bw.sufficient ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-medium">{bw.assetType}</span>
                        {bw.sufficient ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Need {bw.amount.toLocaleString()} in {bw.country} — {bw.available.toLocaleString()} available
                      </div>
                      {!bw.sufficient && <div className="text-[10px] text-amber-600">→ Falls back to marketplace path</div>}
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Animated flow steps */}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Payment flow through the unified pipeline
              </div>
              <div className="space-y-0">
                {result.flowSteps.map((step, i) => (
                  <AnimatedFlowStep key={step.id} step={step} index={i} visible={i < visibleSteps} />
                ))}
              </div>
            </div>

            {/* Pipeline events */}
            {result.pipeline.events.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pipeline events ({result.pipeline.events.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {result.pipeline.events.map((e, i) => (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1 + i * 0.05 }}
                      className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${
                        e.type.includes('ledger') ? 'bg-emerald-500/10 text-emerald-600'
                        : e.type.includes('payment') ? 'bg-sky-500/10 text-sky-600'
                        : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {e.type}
                    </motion.span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!result && !loading && (
          <div className="flex h-32 flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <Zap className="mb-2 h-6 w-6 opacity-30" />
            Select a corridor and amount, then click "Simulate payment" to see the world state, routing decision, bandwidth consumption, and animated payment flow through the unified pipeline.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
