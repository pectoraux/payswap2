'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ScenarioConfig } from '@/components/simulator/scenario-config';
import { TransactionPlanView } from '@/components/simulator/transaction-plan';
import { MetricsPanel } from '@/components/simulator/metrics-panel';
import { AIReasoningView } from '@/components/simulator/ai-reasoning';
import { ReplayStepper } from '@/components/simulator/replay-stepper';
import { EnginesPanel } from '@/components/simulator/engines-panel';
import { WorldStatePanel } from '@/components/simulator/world-state';
import { ThemeToggle } from '@/components/simulator/theme-toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  defaultScenario,
  type SimulationScenario,
  type SimulationResult,
  type EngineHealth,
  type CurrencyCode,
} from '@/kernel';
import { Layers, GitBranch, Server, AlertCircle } from 'lucide-react';

interface SimMeta {
  scenario: SimulationScenario;
  countryOptions: { country: string; currency: CurrencyCode; methods: string[] }[];
  engines: EngineHealth[];
  kernelVersion: string;
}

export default function Home() {
  const [meta, setMeta] = useState<SimMeta | null>(null);
  const [scenario, setScenario] = useState<SimulationScenario>(defaultScenario());
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load default scenario + engines, then auto-run.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/simulate');
        const data: SimMeta = await res.json();
        if (cancelled) return;
        setMeta(data);
        setScenario(data.scenario);
        await run(data.scenario);
      } catch (e) {
        if (!cancelled) setError('Failed to load kernel defaults');
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (s: SimulationScenario) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: s }),
      });
      if (!res.ok) throw new Error(`Kernel error ${res.status}`);
      const data: SimulationResult = await res.json();
      setResult(data);
      toast.success('Simulation settled', {
        description: `${data.metrics.settlementTimeLabel} · ${data.metrics.costPercent}% cost · ${data.metrics.confidence}% confidence`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
      toast.error('Simulation failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const onRun = () => run(scenario);
  const onReset = () => {
    const d = defaultScenario();
    setScenario(d);
    run(d);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <div className="leading-none">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight">PaySwap Kernel</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono">v{meta?.kernelVersion ?? '0.1.0'}</Badge>
              </div>
              <span className="text-[10px] text-muted-foreground">Cross-border payment primitives</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1 sm:flex">
              <GitBranch className="h-3 w-3 text-emerald-500" />
              Milestone 1
            </Badge>
            <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
              <Server className="h-3 w-3" />
              <span className="hidden sm:inline">{meta?.engines.length ?? 21} engines</span>
              <span className="sm:hidden">{meta?.engines.length ?? 21}</span>
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        {/* Intro */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Admin Sandbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Run a cross-border payment through the <span className="font-medium text-foreground">exact same kernel</span> that
            production uses. Configure a corridor, execute, then replay every ledger entry, twin-token mutation and AI
            decision frame by frame.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* Left: config */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            {meta ? (
              <ScenarioConfig
                scenario={scenario}
                onChange={setScenario}
                onRun={onRun}
                onReset={onReset}
                loading={loading}
                countryOptions={meta.countryOptions}
              />
            ) : (
              <Skeleton className="h-[600px] w-full" />
            )}
          </div>

          {/* Right: results */}
          <div className="space-y-6">
            {initialLoading && !result ? (
              <div className="space-y-6">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : result ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <MetricsPanel metrics={result.metrics} currency={result.scenario.currency} />
                <div className="grid gap-6 xl:grid-cols-2">
                  <TransactionPlanView plan={result.plan} />
                  <AIReasoningView reasoning={result.reasoning} />
                </div>
                <ReplayStepper key={result.runId} replay={result.replay} currency={result.scenario.currency} />
                <div className="grid gap-6 xl:grid-cols-2">
                  <WorldStatePanel world={result.worldState} currency={result.scenario.currency} />
                  {meta && <EnginesPanel engines={meta.engines} />}
                </div>
              </motion.div>
            ) : null}
          </div>
        </div>
      </main>

      {/* Footer (sticky bottom) */}
      <footer className="mt-auto border-t bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-3 text-center sm:flex-row sm:text-left">
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">PaySwap Kernel</span> · Milestone 1 ·
            21 independent engines · AWS-style primitives for cross-border payments
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            run {result?.runId?.slice(0, 16) ?? '—'} · {result?.createdAt ? new Date(result.createdAt).toLocaleTimeString() : ''}
          </p>
        </div>
      </footer>
    </div>
  );
}
