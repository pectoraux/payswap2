'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Play, RotateCcw, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScenarioBuilder } from '@/components/simulator/scenario-builder';
import { ScenarioLibraryPanel } from '@/components/simulator/scenario-library';
import { ExecutionGraph } from '@/components/simulator/execution-graph';
import { AIReasoningView } from '@/components/simulator/ai-reasoning';
import { MetricsPanel } from '@/components/simulator/metrics-panel';
import { WorldStatePanel } from '@/components/simulator/world-state';
import { TreasuryAIPanel, AmendmentsPanel } from '@/components/simulator/treasury-amendments';
import { ConstitutionPanel } from '@/components/simulator/constitution-panel';
import { ReasoningPanel } from '@/components/simulator/reasoning-panel';
import { SolverPanel, TransitionsPanel } from '@/components/simulator/solver-panel';
import { ProtocolPanel } from '@/components/simulator/protocol-panel';
import { StateMachinePanel } from '@/components/simulator/state-machine-panel';
import { FinancialGraphPanel } from '@/components/simulator/financial-graph';
import { LPLifecyclePanel } from '@/components/simulator/lp-lifecycle';
import { WorldInspectorPanel } from '@/components/simulator/world-inspector';
import { RuntimeServicesPanel } from '@/components/simulator/runtime-services';
import { EnginesPanel } from '@/components/simulator/engines-panel';
import { EntityRegistry } from '@/components/simulator/entity-registry';
import { OptimizationPanel } from '@/components/simulator/optimization-panel';
import { ProtocolScenariosPanel } from '@/components/simulator/protocol-scenarios';
import { ReplayStepper } from '@/components/simulator/replay-stepper';
import { ThemeToggle } from '@/components/simulator/theme-toggle';
import { AiDirector } from '@/components/admin/ai-director';
import type { SimulationScenario, SimulationResult, CurrencyCode } from '@/kernel';

/**
 * Tailwind class applied to every result tab so its content scrolls within
 * the viewport instead of overlapping the page header / footer / AI Director.
 *
 * Breakdown of the 22rem offset:
 *   - Page header (h1 + Run button): ~3rem
 *   - Badges row: ~2rem
 *   - TabsList (wraps to 2 rows on narrow widths): ~5rem
 *   - Outer page padding + gaps: ~4rem
 *   - Bottom safety margin: ~8rem
 *
 * Plus the custom-scrollbar styling so the scrollbar matches the muted theme.
 */
const TAB_SCROLL_CLASS =
  'mt-2 max-h-[calc(100vh-22rem)] overflow-y-auto overflow-x-hidden pr-1 ' +
  '[&::-webkit-scrollbar]:w-1.5 ' +
  '[&::-webkit-scrollbar-thumb]:rounded ' +
  '[&::-webkit-scrollbar-thumb]:bg-muted ' +
  '[&::-webkit-scrollbar-track]:bg-transparent';

export default function RuntimeConsole() {
  const [scenario, setScenario] = useState<SimulationScenario | null>(null);
  const [defaultScn, setDefaultScn] = useState<SimulationScenario | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countryOptions, setCountryOptions] = useState<any[]>([]);
  const [libraryScenarios, setLibraryScenarios] = useState<{ scenario: SimulationScenario; category: string }[]>([]);
  const [engines, setEngines] = useState<unknown>(null);
  const [kernelVersion, setKernelVersion] = useState('');
  const [foMeta, setFoMeta] = useState<unknown>(null);
  const [savedScenarios, setSavedScenarios] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [regressing, setRegressing] = useState(false);
  const [regressResults, setRegressResults] = useState<any>(null);
  const [aiCollapsed, setAiCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/simulate')
      .then((r) => r.json())
      .then((data) => {
        setScenario(data.scenario);
        setDefaultScn(data.scenario);
        setCountryOptions(data.countryOptions ?? []);
        setEngines(data.engines);
        setKernelVersion(data.kernelVersion ?? '');
        setFoMeta(data.foMeta);
        setLibraryScenarios(data.libraryScenarios ?? []);
      })
      .catch((err) => setError(err.message));
  }, []);

  const fetchSavedScenarios = useCallback(() => {
    fetch('/api/scenarios')
      .then((r) => r.json())
      .then((data) => setSavedScenarios(data.scenarios ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchSavedScenarios(); }, [fetchSavedScenarios]);

  const handleRun = useCallback(async () => {
    if (!scenario) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      if (!res.ok) throw new Error(`Simulation failed: ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [scenario]);

  const handleReset = useCallback(() => {
    setScenario(defaultScn);
    setResult(null);
    setError(null);
  }, [defaultScn]);

  const handleLoadLibrary = useCallback((s: SimulationScenario) => {
    setScenario(s);
    setResult(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!scenario) return;
    setSaving(true);
    try {
      await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      fetchSavedScenarios();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [scenario, fetchSavedScenarios]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/scenarios?id=${id}`, { method: 'DELETE' });
      fetchSavedScenarios();
    } catch {}
  }, [fetchSavedScenarios]);

  const handleRegress = useCallback(async () => {
    setRegressing(true);
    try {
      const res = await fetch('/api/scenarios/regress', { method: 'POST' });
      const data = await res.json();
      fetchSavedScenarios();
      setRegressResults(data.results ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regression failed');
    } finally {
      setRegressing(false);
    }
  }, [fetchSavedScenarios]);

  if (!scenario) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currency = scenario.transaction.currency as CurrencyCode;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Runtime Console</h1>
          <p className="text-sm text-muted-foreground">
            PaySwap Kernel v{kernelVersion} — Global Liquidity Operating System
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAiCollapsed((c) => !c)}
            title="Toggle AI Director"
          >
            <Brain className="h-4 w-4 mr-1 text-emerald-500" />
            AI Director
          </Button>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-1" /> Reset
          </Button>
          <Button size="sm" onClick={handleRun} disabled={loading || !scenario}>
            {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Run Simulation
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={result.settled ? 'default' : 'destructive'}>
            {result.settled ? 'SETTLED' : 'NOT SETTLED'}
          </Badge>
          <Badge variant="secondary">{result.plan.status}</Badge>
          <Badge variant="outline">Cost: {result.plan.metrics.costPercent.toFixed(2)}%</Badge>
          <Badge variant="outline">Risk: {result.plan.metrics.riskScore.toFixed(2)}</Badge>
          <Badge variant="outline">Frames: {result.replay.length}</Badge>
          <Badge variant="outline">Hash: {result.resultHash.slice(0, 12)}</Badge>
        </div>
      )}

      {/*
         3-column grid on xl+ (left builder, middle tabs, right AI Director).
         On lg and below the AI Director moves to a floating drawer (see MobileAiDirector)
         so the middle column keeps full width for the tabs.
      */}
      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)_auto]">
        {/* Left column — scenario builder + library (sticky, scrolls within itself) */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1
          [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-muted">
          <ScenarioBuilder
            scenario={scenario}
            onChange={setScenario}
            onRun={handleRun}
            onReset={handleReset}
            loading={loading}
            countryOptions={countryOptions}
          />
          <ScenarioLibraryPanel
            currentScenario={scenario}
            saved={savedScenarios}
            onLoad={handleLoadLibrary}
            onSave={handleSave}
            onDelete={handleDelete}
            onRegress={handleRegress}
            regressResults={regressResults}
            saving={saving}
            regressing={regressing}
          />
        </div>

        {/* Middle column — results tabs (each tab content scrolls within the viewport) */}
        <div className="min-w-0">
          {result ? (
            <Tabs defaultValue="execution" className="w-full">
              {/* Sticky tabs list — stays visible while content scrolls */}
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur pb-1 pt-0 -mt-1">
                <TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start">
                  <TabsTrigger value="execution" className="text-xs">Execution</TabsTrigger>
                  <TabsTrigger value="ai" className="text-xs">AI Reasoning</TabsTrigger>
                  <TabsTrigger value="metrics" className="text-xs">Metrics</TabsTrigger>
                  <TabsTrigger value="world" className="text-xs">World State</TabsTrigger>
                  <TabsTrigger value="replay" className="text-xs">Time Machine</TabsTrigger>
                  <TabsTrigger value="treasury" className="text-xs">Treasury</TabsTrigger>
                  <TabsTrigger value="constitution" className="text-xs">Constitution</TabsTrigger>
                  <TabsTrigger value="graph" className="text-xs">Fin. Graph</TabsTrigger>
                  <TabsTrigger value="lp" className="text-xs">LP Lifecycle</TabsTrigger>
                  <TabsTrigger value="inspector" className="text-xs">Inspector</TabsTrigger>
                  <TabsTrigger value="reasoning" className="text-xs">Reasoning</TabsTrigger>
                  <TabsTrigger value="solver" className="text-xs">Solver</TabsTrigger>
                  <TabsTrigger value="protocol" className="text-xs">Protocol</TabsTrigger>
                  <TabsTrigger value="state" className="text-xs">State Machine</TabsTrigger>
                  <TabsTrigger value="optimization" className="text-xs">Optimization</TabsTrigger>
                  <TabsTrigger value="engines" className="text-xs">Engines</TabsTrigger>
                  <TabsTrigger value="entities" className="text-xs">Entities</TabsTrigger>
                  <TabsTrigger value="runtime" className="text-xs">Runtime</TabsTrigger>
                  <TabsTrigger value="scenarios" className="text-xs">Protocol Scenarios</TabsTrigger>
                </TabsList>
              </div>

              {/* Each tab content scrolls within the viewport — no overlap, no page-level scroll */}
              <TabsContent value="execution" className={TAB_SCROLL_CLASS}>
                <div className="space-y-4">
                  <ExecutionGraph plan={result.plan} />
                </div>
              </TabsContent>
              <TabsContent value="ai" className={TAB_SCROLL_CLASS}>
                <AIReasoningView reasoning={result.plan.reasoning} />
              </TabsContent>
              <TabsContent value="metrics" className={TAB_SCROLL_CLASS}>
                <MetricsPanel metrics={result.plan.metrics} currency={currency} settled={result.settled} />
              </TabsContent>
              <TabsContent value="world" className={TAB_SCROLL_CLASS}>
                <WorldStatePanel world={result.worldState} currency={currency} />
              </TabsContent>
              <TabsContent value="replay" className={TAB_SCROLL_CLASS}>
                <ReplayStepper replay={result.replay} currency={currency} />
              </TabsContent>
              <TabsContent value="treasury" className={TAB_SCROLL_CLASS}>
                <div className="space-y-4">
                  <TreasuryAIPanel recommendations={result.treasuryRecommendations} />
                  <AmendmentsPanel amendments={result.amendments} />
                </div>
              </TabsContent>
              <TabsContent value="constitution" className={TAB_SCROLL_CLASS}>
                <ConstitutionPanel constitution={result.constitution} />
              </TabsContent>
              <TabsContent value="graph" className={TAB_SCROLL_CLASS}>
                <FinancialGraphPanel graph={result.graph} />
              </TabsContent>
              <TabsContent value="lp" className={TAB_SCROLL_CLASS}>
                <LPLifecyclePanel events={result.lpLifecycleEvents} />
              </TabsContent>
              <TabsContent value="inspector" className={TAB_SCROLL_CLASS}>
                <WorldInspectorPanel inspector={result.worldInspector} currency={currency} />
              </TabsContent>
              <TabsContent value="reasoning" className={TAB_SCROLL_CLASS}>
                <ReasoningPanel results={result.reasoningResults} />
              </TabsContent>
              <TabsContent value="solver" className={TAB_SCROLL_CLASS}>
                <div className="space-y-4">
                  <SolverPanel candidates={result.solverCandidates} />
                  <TransitionsPanel transitions={result.transitions} />
                </div>
              </TabsContent>
              <TabsContent value="protocol" className={TAB_SCROLL_CLASS}>
                <ProtocolPanel protocol={result.protocol} />
              </TabsContent>
              <TabsContent value="state" className={TAB_SCROLL_CLASS}>
                <StateMachinePanel transitions={result.stateTransitions} />
              </TabsContent>
              <TabsContent value="optimization" className={TAB_SCROLL_CLASS}>
                <OptimizationPanel candidates={result.candidatePlans} />
              </TabsContent>
              <TabsContent value="engines" className={TAB_SCROLL_CLASS}>
                <EnginesPanel engines={result.engines} />
              </TabsContent>
              <TabsContent value="entities" className={TAB_SCROLL_CLASS}>
                <EntityRegistry entities={result.entities} />
              </TabsContent>
              <TabsContent value="runtime" className={TAB_SCROLL_CLASS}>
                <RuntimeServicesPanel services={result.runtimeServices} />
              </TabsContent>
              <TabsContent value="scenarios" className={TAB_SCROLL_CLASS}>
                <ProtocolScenariosPanel scenarios={[]} onRunScenario={() => {}} onRunAll={() => {}} loading={false} results={new Map()} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex items-center justify-center min-h-[400px] text-muted-foreground">
              <div className="text-center">
                <Play className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>Run a simulation to see results</p>
                <p className="text-xs mt-1">Configure the scenario on the left, then click "Run Simulation"</p>
              </div>
            </div>
          )}
        </div>

        {/* Right column — AI Director (page-aware, collapsible). Only rendered
            as a sidebar on xl+ screens; on lg and below it appears as a floating
            drawer (see MobileAiDirector below) to keep the middle column full-width. */}
        <div
          className={
            aiCollapsed
              ? 'hidden xl:block xl:sticky xl:top-4 xl:self-start xl:h-[calc(100vh-2rem)] w-12'
              : 'hidden xl:block xl:sticky xl:top-4 xl:self-start xl:h-[calc(100vh-2rem)] w-[400px]'
          }
        >
          <AiDirector
            scenarioResult={result}
            collapsed={aiCollapsed}
            onToggleCollapsed={() => setAiCollapsed((c) => !c)}
          />
        </div>
      </div>

      {/* Mobile/tablet AI Director — floating button that opens a bottom drawer.
          Hidden on xl+ where the sidebar version above takes over. */}
      <div className="xl:hidden">
        <MobileAiDirector
          result={result}
          aiCollapsed={aiCollapsed}
          onToggle={() => setAiCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
}

/**
 * Mobile/tablet AI Director — floating button that opens a bottom drawer.
 * Hidden on xl+ screens where the sidebar version above takes over.
 */
function MobileAiDirector({
  result,
  aiCollapsed,
  onToggle,
}: {
  result: any | null;
  aiCollapsed: boolean;
  onToggle: () => void;
}) {
  if (!aiCollapsed) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 h-[60vh] border-t bg-background shadow-2xl xl:hidden">
        <AiDirector
          scenarioResult={result}
          collapsed={false}
          onToggleCollapsed={onToggle}
        />
      </div>
    );
  }
  return (
    <Button
      onClick={onToggle}
      className="fixed bottom-4 right-4 z-30 h-12 w-12 rounded-full bg-emerald-600 p-0 shadow-lg xl:hidden"
      title="Open AI Director"
    >
      <Brain className="h-5 w-5" />
    </Button>
  );
}
