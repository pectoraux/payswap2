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
import { OptimizationPanel } from '@/components/simulator/optimization-panel';
import { StateMachinePanel } from '@/components/simulator/state-machine-panel';
import { ReasoningPanel } from '@/components/simulator/reasoning-panel';
import { SolverPanel, TransitionsPanel } from '@/components/simulator/solver-panel';
import { ExecutionGraphDAG } from '@/components/simulator/execution-graph-dag';
import { EntityRegistry } from '@/components/simulator/entity-registry';
import { RuntimeServicesPanel } from '@/components/simulator/runtime-services';
import { ProtocolScenariosPanel, FiatProofPanel, ConstitutionalVerificationPanel } from '@/components/simulator/protocol-scenarios';
import { ProtocolPanel } from '@/components/simulator/protocol-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  defaultScenario, libraryScenarios,
  type SimulationScenario, type SimulationResult, type EngineHealth, type SavedScenario, type CurrencyCode,
} from '@/kernel';
import { AlertCircle, Database, Globe, Cpu, Clock, BookOpen, Network, Shield, Play } from 'lucide-react';

interface SimMeta {
  scenario: SimulationScenario;
  countryOptions: { country: string; currency: CurrencyCode; methods: string[] }[];
  engines: EngineHealth[];
  kernelVersion: string;
  libraryScenarios: { scenario: SimulationScenario; category: string }[];
}

export function KernelRuntimeConsole() {
  const [meta, setMeta] = useState<SimMeta | null>(null);
  const [scenario, setScenario] = useState<SimulationScenario>(defaultScenario());
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedScenario[]>([]);
  const [activeTab, setActiveTab] = useState('optimization');
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Kernel Runtime <span className="text-emerald-600 text-lg">— Digital Twin</span></h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Build arbitrary network states, inject failures, and replay liquidity state transitions through the
          <span className="font-medium text-foreground"> exact same kernel</span> production uses. Every plan is immutable;
          simulation and production execute it identically.
        </p>
      </div>

      {/* Library scenario chips — preconfigured scenarios you click to run */}
      {meta && (
        <div className="flex flex-wrap items-center gap-1.5">
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
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-400">
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
        <div className="space-y-4">
          {initialLoading && !result ? (
            <div className="space-y-6"><Skeleton className="h-40 w-full" /><Skeleton className="h-96 w-full" /><Skeleton className="h-48 w-full" /></div>
          ) : result ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="space-y-4">
              <MetricsPanel metrics={result.plan.metrics} currency={result.scenario.transaction.currency} settled={result.settled} />

              {/* 6-view Financial Control Center */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 h-auto">
                  <TabsTrigger value="world" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Globe className="h-3 w-3" />World</TabsTrigger>
                  <TabsTrigger value="optimization" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Cpu className="h-3 w-3" />Solver</TabsTrigger>
                  <TabsTrigger value="execution" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Clock className="h-3 w-3" />Execution</TabsTrigger>
                  <TabsTrigger value="protocol" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Shield className="h-3 w-3" />Protocol</TabsTrigger>
                  <TabsTrigger value="accounting" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><BookOpen className="h-3 w-3" />Accounting</TabsTrigger>
                  <TabsTrigger value="infrastructure" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Network className="h-3 w-3" />Infra</TabsTrigger>
                </TabsList>

                {/* 1. World State */}
                <TabsContent value="world" className="space-y-4 mt-4">
                  <EntityRegistry entities={result.entities} />
                  <FinancialGraphPanel graph={result.graph} />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <WorldStatePanel world={result.worldState} currency={result.scenario.transaction.currency} />
                    <WorldInspectorPanel inspector={result.worldInspector} currency={result.scenario.transaction.currency} />
                  </div>
                </TabsContent>

                {/* 2. Optimization */}
                <TabsContent value="optimization" className="space-y-4 mt-4">
                  <SolverPanel candidates={result.solverCandidates} />
                  <TransitionsPanel transitions={result.transitions} />
                  <OptimizationPanel candidates={result.candidatePlans} />
                  <AIReasoningView reasoning={result.plan.reasoning} />
                  <AlternativesPanel alternatives={result.plan.alternatives} />
                  <ReasoningPanel results={result.reasoningResults} />
                </TabsContent>

                {/* 3. Execution Timeline */}
                <TabsContent value="execution" className="space-y-4 mt-4">
                  <StateMachinePanel transitions={result.stateTransitions} />
                  <ExecutionGraphDAG graph={result.executionGraph} />
                  {result.amendments.length > 0 && <AmendmentsPanel amendments={result.amendments} />}
                  <ReplayStepper key={result.runId} replay={result.replay} currency={result.scenario.transaction.currency} />
                </TabsContent>

                {/* 4. Protocol */}
                <TabsContent value="protocol" className="space-y-4 mt-4">
                  {result?.fiatProofs && result.fiatProofs.length > 0 && <FiatProofPanel proofs={result.fiatProofs} />}
                  <ProtocolPanel protocol={result.protocol} />
                </TabsContent>

                {/* 5. Accounting */}
                <TabsContent value="accounting" className="space-y-4 mt-4">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <WorldStatePanel world={result.worldState} currency={result.scenario.transaction.currency} />
                    <TreasuryAIPanel recommendations={result.treasuryRecommendations} />
                  </div>
                  <ConstitutionPanel constitution={result.constitution} />
                </TabsContent>

                {/* 6. Infrastructure */}
                <TabsContent value="infrastructure" className="space-y-4 mt-4">
                  <RuntimeServicesPanel services={result.runtimeServices} />
                  <EntityRegistry entities={result.entities} />
                  <FinancialGraphPanel graph={result.graph} />
                  <LPLifecyclePanel events={result.lpLifecycleEvents} />
                  {meta && <EnginesPanel engines={meta.engines} />}
                </TabsContent>
              </Tabs>

              {/* Run footer */}
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5 text-xs">
                <span className="text-muted-foreground">
                  <span className="font-semibold text-foreground">Kernel {result.kernelVersion}</span> ·
                  {' '}{meta?.engines.length ?? 29} engines · production = simulation
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {result ? `run ${result.runId.slice(0, 16)} · ${result.resultHash} · ${result.settled ? 'settled' : 'blocked'} · ${result.constitution?.passed ? 'constitution ✓' : 'constitution ✗'}` : 'no run yet'}
                </span>
              </div>
            </motion.div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
