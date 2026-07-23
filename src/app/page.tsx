'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ScenarioBuilder } from '@/components/simulator/scenario-builder';
import { ExecutionGraph } from '@/components/simulator/execution-graph';
import { MetricsPanel } from '@/components/simulator/metrics-panel';
import { AIReasoningView, AlternativesPanel } from '@/components/simulator/ai-reasoning';
import { ReplayStepper } from '@/components/simulator/replay-stepper';
import { EnginesPanel } from '@/components/simulator/engines-panel';
import { WorldStatePanel } from '@/components/simulator/world-state';
import { TreasuryAIPanel, AmendmentsPanel } from '@/components/simulator/treasury-amendments';
import { ScenarioLibraryPanel } from '@/components/simulator/scenario-library';
import { ConstitutionPanel } from '@/components/simulator/constitution-panel';
import { FinancialGraphPanel } from '@/components/simulator/financial-graph';
import { WorldInspectorPanel } from '@/components/simulator/world-inspector';
import { LPLifecyclePanel } from '@/components/simulator/lp-lifecycle';
import { ThemeToggle } from '@/components/simulator/theme-toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  defaultScenario, libraryScenarios,
  type SimulationScenario, type SimulationResult, type EngineHealth, type SavedScenario, type CurrencyCode,
} from '@/kernel';
import { Layers, GitBranch, Server, AlertCircle, Database } from 'lucide-react';

interface SimMeta {
  scenario: SimulationScenario;
  countryOptions: { country: string; currency: CurrencyCode; methods: string[] }[];
  engines: EngineHealth[];
  kernelVersion: string;
  libraryScenarios: { scenario: SimulationScenario; category: string }[];
}

export default function Home() {
  const [meta, setMeta] = useState<SimMeta | null>(null);
  const [scenario, setScenario] = useState<SimulationScenario>(defaultScenario());
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [saving, setSaving] = useState(false);
  const [regressing, setRegressing] = useState(false);
  const [regressResults, setRegressResults] = useState<{ scenarioId: string; name: string; passed: boolean; drift: { costPercent: number; settlementTimeMs: number; riskScore: number } }[] | null>(null);

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
        await loadSaved();
      } catch (e) {
        if (!cancelled) setError('Failed to load kernel defaults');
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
      toast.success(data.settled ? 'Liquidity plan settled' : 'Plan blocked', {
        description: `${data.plan.metrics.settlementTimeLabel} · ${data.plan.metrics.costPercent}% cost · ${data.plan.metrics.confidence}% confidence${data.amendments.length > 0 ? ` · ${data.amendments.length} amendment(s)` : ''}`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Simulation failed');
      toast.error('Simulation failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/scenarios');
      const data = await res.json();
      setSaved(data.scenarios ?? []);
    } catch { /* ignore */ }
  }, []);

  const onRun = () => run(scenario);
  const onReset = () => { const d = defaultScenario(); setScenario(d); run(d); };

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, category: 'Custom' }),
      });
      if (!res.ok) throw new Error('Save failed');
      await loadSaved();
      toast.success('Scenario saved', { description: `${scenario.name} added to regression library` });
    } catch (e) {
      toast.error('Failed to save scenario');
    } finally {
      setSaving(false);
    }
  };

  const onLoad = (s: SimulationScenario) => { setScenario(s); run(s); toast.success('Scenario loaded'); };

  const onDelete = async (id: string) => {
    try {
      await fetch(`/api/scenarios?id=${id}`, { method: 'DELETE' });
      await loadSaved();
      toast.success('Scenario removed');
    } catch { toast.error('Failed to delete'); }
  };

  const onRegress = async () => {
    setRegressing(true);
    try {
      const res = await fetch('/api/scenarios/regress', { method: 'POST' });
      const data = await res.json();
      setRegressResults(data.regression);
      await loadSaved();
      const passed = data.regression.filter((r: { passed: boolean }) => r.passed).length;
      toast.success('Regression complete', { description: `${passed}/${data.regression.length} scenarios match baseline` });
    } catch {
      toast.error('Regression failed');
    } finally {
      setRegressing(false);
    }
  };

  const onLoadLibraryScenario = (s: SimulationScenario) => { setScenario(s); run(s); };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <div className="leading-none">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight">PaySwap</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px] font-mono">v{meta?.kernelVersion ?? '0.2.0'}</Badge>
              </div>
              <span className="text-[10px] text-muted-foreground">Financial Operating System</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1 sm:flex"><GitBranch className="h-3 w-3 text-emerald-500" /> Milestone 1</Badge>
            <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white"><Server className="h-3 w-3" /><span className="hidden sm:inline">{meta?.engines.length ?? 26} engines</span><span className="sm:hidden">{meta?.engines.length ?? 26}</span></Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Financial Operating System</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every payment, loan, treasury rebalance, insurance payout, reserve refill, LP withdrawal and stablecoin
            conversion is a <span className="font-medium text-foreground">state transition through the global liquidity
            graph</span>. The Constitution guarantees financial integrity. Simulation and production execute identically.
          </p>
        </div>

        {/* Library scenario chips */}
        {meta && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Library:</span>
            {meta.libraryScenarios.map(({ scenario: s, category }, i) => (
              <button key={i} onClick={() => onLoadLibraryScenario(s)}
                className="flex items-center gap-1 rounded-full border bg-muted/30 px-2.5 py-1 text-[10px] hover:bg-muted/60 transition-colors">
                <Database className="h-2.5 w-2.5 text-muted-foreground" />
                <span className="font-medium">{s.name}</span>
                <Badge variant="outline" className="ml-1 h-3 px-1 text-[8px]">{category}</Badge>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          {/* Left: builder + library */}
          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto pr-1">
            {meta ? (
              <>
                <ScenarioBuilder scenario={scenario} onChange={setScenario} onRun={onRun} onReset={onReset} loading={loading} countryOptions={meta.countryOptions} />
                <ScenarioLibraryPanel currentScenario={scenario} saved={saved} onLoad={onLoad} onSave={onSave} onDelete={onDelete} onRegress={onRegress} regressResults={regressResults} saving={saving} regressing={regressing} />
              </>
            ) : (
              <Skeleton className="h-[600px] w-full" />
            )}
          </div>

          {/* Right: results */}
          <div className="space-y-6">
            {initialLoading && !result ? (
              <div className="space-y-6"><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /><Skeleton className="h-48 w-full" /></div>
            ) : result ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-6">
                <MetricsPanel metrics={result.plan.metrics} currency={result.scenario.transaction.currency} settled={result.settled} />
                <ConstitutionPanel constitution={result.constitution} />
                {result.amendments.length > 0 && <AmendmentsPanel amendments={result.amendments} />}
                <div className="grid gap-6 xl:grid-cols-2">
                  <ExecutionGraph plan={result.plan} />
                  <AIReasoningView reasoning={result.plan.reasoning} />
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  <FinancialGraphPanel graph={result.graph} />
                  <AlternativesPanel alternatives={result.plan.alternatives} />
                </div>
                <ReplayStepper key={result.runId} replay={result.replay} currency={result.scenario.transaction.currency} />
                <div className="grid gap-6 xl:grid-cols-2">
                  <WorldInspectorPanel inspector={result.worldInspector} currency={result.scenario.transaction.currency} />
                  <WorldStatePanel world={result.worldState} currency={result.scenario.transaction.currency} />
                </div>
                <div className="grid gap-6 xl:grid-cols-2">
                  <div className="space-y-6">
                    <TreasuryAIPanel recommendations={result.treasuryRecommendations} />
                    <LPLifecyclePanel events={result.lpLifecycleEvents} />
                  </div>
                  {meta && <EnginesPanel engines={meta.engines} />}
                </div>
              </motion.div>
            ) : null}
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-3 text-center sm:flex-row sm:text-left">
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">PaySwap Kernel</span> · Financial Operating System ·
            26 engines · financial graph · constitution · production = simulation
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {result ? `run ${result.runId.slice(0, 16)} · ${result.resultHash} · ${result.settled ? 'settled' : 'blocked'} · ${result.constitution.passed ? 'constitution ✓' : 'constitution ✗'}` : 'no run yet'}
          </p>
        </div>
      </footer>
    </div>
  );
}
