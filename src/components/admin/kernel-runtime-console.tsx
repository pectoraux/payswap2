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
import { HelpIcon } from '@/components/help-icon';

/**
 * Shared scroll wrapper for every result tab in the kernel runtime console.
 * Bounds the tab content to a viewport-relative height so long lists (events,
 * ledger entries, solver candidates) scroll within the tab instead of pushing
 * the TabsList off-screen and overlapping the page header / footer.
 *
 * `overflow-x-auto` lets wide tables (ledger, candidates) scroll horizontally
 * without breaking the grid. The custom-scrollbar classes give the track a
 * transparent background and the thumb a rounded muted pill so it matches
 * the rest of the console.
 */
const TAB_SCROLL_CLASS =
  'mt-4 max-h-[calc(100vh-22rem)] overflow-y-auto overflow-x-auto pr-1 ' +
  '[&::-webkit-scrollbar]:w-1.5 ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full ' +
  '[&::-webkit-scrollbar-thumb]:bg-muted ' +
  '[&::-webkit-scrollbar-track]:bg-transparent';

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
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Kernel Runtime <span className="text-emerald-600 text-lg">— Digital Twin</span></h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Build arbitrary network states, inject failures, and replay liquidity state transitions through the
              <span className="font-medium text-foreground"> exact same kernel</span> production uses. Every plan is immutable;
              simulation and production execute it identically.
            </p>
          </div>
          <HelpIcon
            size="md"
            text="The Digital Twin runs your transaction scenario through the frozen 7-primitive kernel — the same planner, executor, evidence, transitions, events, and ledger that production uses. Configure a scenario on the left (or click a library chip), press Run, and watch the kernel plan and execute the payment in real-time. Every result is deterministic: the same scenario always produces the same outcome."
          />
        </div>
      </div>

      {/* Library scenario chips — preconfigured scenarios you click to run */}
      {meta && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Library:</span>
          <HelpIcon text="Preconfigured scenarios that cover common payment patterns and edge cases. Click any chip to instantly run it through the kernel. Categories include: standard cross-border payments, domestic transfers, high-volume enterprise flows, and failure scenarios (LP defaults, PSP outages, reserve exhaustion, fraud). Each scenario exercises different kernel capabilities — try them all to see how the planner adapts." />
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
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-semibold text-muted-foreground">Scenario Builder</span>
                <HelpIcon text="Configure the transaction you want to simulate. Set the buyer and merchant countries (determines the currency corridor), the transaction amount, the payment method (mobile money, bank, card), and the routing priority (cheapest, fastest, safest, balanced). You can also adjust treasury reserves, LP parameters, and inject failures (LP default, PSP outage, fraud alert) to stress-test the kernel's resilience. Press 'Run' to execute through the kernel." />
              </div>
              <ScenarioBuilder scenario={scenario} onChange={setScenario} onRun={onRun} onReset={onReset} loading={loading} countryOptions={meta.countryOptions} />
              <div className="flex items-center gap-1.5 mb-1 mt-2">
                <span className="text-xs font-semibold text-muted-foreground">Scenario Library</span>
                <HelpIcon text="Save your custom scenarios for reuse, or load previously saved ones. The regression test runs all saved scenarios and checks if the kernel still produces the same result hash — ensuring deterministic replay across code changes. If any scenario drifts, the regression flags it so you can investigate before shipping." />
              </div>
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
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-semibold text-muted-foreground">Metrics</span>
                <HelpIcon text="The kernel planner's output metrics for this scenario. Cost % is the total fee (LP fees + FX spread + protocol fee) as a percentage of the transaction amount. Settlement time is the estimated end-to-end duration. Risk score (0-1) measures the probability of settlement failure. Confidence % is the planner's certainty that the transaction will settle successfully. If confidence is below the threshold, the kernel blocks the transaction." />
              </div>
              <MetricsPanel metrics={result.plan.metrics} currency={result.scenario.transaction.currency} settled={result.settled} />

              {/* 6-view Financial Control Center */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur pb-1 pt-0 -mt-1">
                <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6 h-auto">
                  <TabsTrigger value="world" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Globe className="h-3 w-3" />World</TabsTrigger>
                  <TabsTrigger value="optimization" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Cpu className="h-3 w-3" />Solver</TabsTrigger>
                  <TabsTrigger value="execution" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Clock className="h-3 w-3" />Execution</TabsTrigger>
                  <TabsTrigger value="protocol" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Shield className="h-3 w-3" />Protocol</TabsTrigger>
                  <TabsTrigger value="accounting" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><BookOpen className="h-3 w-3" />Accounting</TabsTrigger>
                  <TabsTrigger value="infrastructure" className="flex flex-col gap-0.5 py-1.5 text-[10px]"><Network className="h-3 w-3" />Infra</TabsTrigger>
                  <div className="flex items-center justify-center px-1"><HelpIcon text="Six views into the kernel's execution: World shows entities and their relationships. Solver shows how the planner evaluated and ranked candidate plans. Execution shows the step-by-step timeline of state transitions. Protocol shows escrow, collateral, and fiat proofs. Accounting shows the double-entry ledger and treasury recommendations. Infrastructure shows runtime services and engine health." /></div>
                </TabsList>
                </div>

                {/* 1. World State */}
                <TabsContent value="world" className={TAB_SCROLL_CLASS}>
                  <div className="space-y-4">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-muted-foreground">World State Overview</span><HelpIcon text="The World tab shows the complete state of all entities involved in this transaction: who the buyer and merchant are, which liquidity providers participated, what reserves were available, and how the financial graph connected them. This is the kernel's view of the world before, during, and after the transaction." /></div>
                  <EntityRegistry entities={result.entities} />
                  <FinancialGraphPanel graph={result.graph} />
                  <div className="grid gap-4 xl:grid-cols-2">
                    <WorldStatePanel world={result.worldState} currency={result.scenario.transaction.currency} />
                    <WorldInspectorPanel inspector={result.worldInspector} currency={result.scenario.transaction.currency} />
                  </div>
                  </div>
                </TabsContent>

                {/* 2. Optimization */}
                <TabsContent value="optimization" className={TAB_SCROLL_CLASS}>
                  <div className="space-y-4">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-muted-foreground">Solver & Optimization</span><HelpIcon text="The Solver tab reveals the kernel's planning process. The constraint solver evaluates all possible liquidity paths (which LPs can settle this corridor, at what cost, speed, and risk). It ranks candidates by your chosen priority (cheapest, fastest, safest, balanced). The AI Reasoning panel explains WHY the planner chose the winning plan — which trade-offs it considered and what it rejected. The Alternatives panel shows the next-best plans that were considered but not selected." /></div>
                  <SolverPanel candidates={result.solverCandidates} />
                  <TransitionsPanel transitions={result.transitions} />
                  <OptimizationPanel candidates={result.candidatePlans} />
                  <AIReasoningView reasoning={result.plan.reasoning} />
                  <AlternativesPanel alternatives={result.plan.alternatives} />
                  <ReasoningPanel results={result.reasoningResults} />
                  </div>
                </TabsContent>

                {/* 3. Execution Timeline */}
                <TabsContent value="execution" className={TAB_SCROLL_CLASS}>
                  <div className="space-y-4">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-muted-foreground">Execution Timeline</span><HelpIcon text="The Execution tab shows the step-by-step timeline of what happened when the kernel executed the plan. The State Machine panel shows every state transition (intent → planning → escrow → settling → settled). The Execution DAG visualizes the dependency graph of operations. The Time Machine (Replay Stepper) lets you scrub through each frame of the execution — pause, play, step forward/backward — to see exactly what happened at each moment: ledger entries, events emitted, twin tokens minted/burned, and any plan amendments the executor had to make." /></div>
                  <StateMachinePanel transitions={result.stateTransitions} />
                  <ExecutionGraphDAG graph={result.executionGraph} />
                  {result.amendments.length > 0 && <AmendmentsPanel amendments={result.amendments} />}
                  <ReplayStepper key={result.runId} replay={result.replay} currency={result.scenario.transaction.currency} />
                  </div>
                </TabsContent>

                {/* 4. Protocol */}
                <TabsContent value="protocol" className={TAB_SCROLL_CLASS}>
                  <div className="space-y-4">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-muted-foreground">Protocol Layer</span><HelpIcon text="The Protocol tab shows the settlement infrastructure: escrow entries (Twin Tokens frozen during settlement), collateral vaults (LP collateral locked for this transaction), capacity stakes, and fiat proofs (evidence from real connectors that bank balances exist). This is the layer above the kernel that manages the financial instruments — the kernel itself is domain-neutral and doesn't know about escrow or collateral." /></div>
                  {result?.fiatProofs && result.fiatProofs.length > 0 && <FiatProofPanel proofs={result.fiatProofs} />}
                  <ProtocolPanel protocol={result.protocol} />
                  </div>
                </TabsContent>

                {/* 5. Accounting */}
                <TabsContent value="accounting" className={TAB_SCROLL_CLASS}>
                  <div className="space-y-4">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-muted-foreground">Accounting & Constitution</span><HelpIcon text="The Accounting tab shows the financial impact: world state (reserve balances before/after), treasury AI recommendations (whether reserves need replenishing, corridors need rebalancing), and the constitution check (43 invariant rules that must all pass — if any rule fails, the transaction is blocked). The constitution is the kernel's safety net: it checks things like 'every Twin Token must be backed', 'no negative balances', 'escrow must reconcile', 'treasury must be solvent'." /></div>
                  <div className="grid gap-4 xl:grid-cols-2">
                    <WorldStatePanel world={result.worldState} currency={result.scenario.transaction.currency} />
                    <TreasuryAIPanel recommendations={result.treasuryRecommendations} />
                  </div>
                  <ConstitutionPanel constitution={result.constitution} />
                  </div>
                </TabsContent>

                {/* 6. Infrastructure */}
                <TabsContent value="infrastructure" className={TAB_SCROLL_CLASS}>
                  <div className="space-y-4">
                  <div className="flex items-center gap-1.5"><span className="text-xs font-semibold text-muted-foreground">Infrastructure & Engines</span><HelpIcon text="The Infrastructure tab shows the runtime services that power the kernel: the 29 internal engines (planner, executor, ledger, treasury, risk, fraud, AI agent, etc.), their health status, the LP lifecycle events (how LPs were invited, activated, and used in this transaction), and the runtime services that were invoked. This is the 'machine room' view — useful for debugging why a transaction behaved the way it did." /></div>
                  <RuntimeServicesPanel services={result.runtimeServices} />
                  <EntityRegistry entities={result.entities} />
                  <FinancialGraphPanel graph={result.graph} />
                  <LPLifecyclePanel events={result.lpLifecycleEvents} />
                  {meta && <EnginesPanel engines={meta.engines} />}
                  </div>
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
