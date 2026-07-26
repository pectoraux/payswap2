/**
 * PaySwap Runtime — public entry point. (Principle 1: Runtime First.)
 *
 * The Runtime is the product. Every client (Dashboard, Admin, Twin, SDK,
 * CLI, Extensions, AI Agents, Mobile, API) enters through `dispatch()`.
 *
 * M-RT-1 ships the skeleton: a working RuntimeClock (live 1×), an in-memory
 * EventStore with OCC, an IntentEngine with overridable hooks, a 14-stage
 * Pipeline scaffold with no-op handlers, and the Decision/Policy/Inspector
 * interfaces. Dispatching any intent flows through all stages, appends real
 * events, and produces a real trace — with zero business logic.
 *
 * The existing app is untouched. M-RT-2 wires real payment logic into the
 * stages and connects the first vertical slice to the UI.
 */

import { LiveClock, VirtualClock, type RuntimeClock } from './clock';
import { InMemoryEventStore, type EventStore } from './events';
import { IntentEngine } from './intent';
import { Pipeline } from './pipeline';
import { DefaultPolicyEngine, type PolicyEngine } from './policy';
import { ProjectionRunner } from './read-models';
// Amendment 1 engines:
import { InMemoryReserveMarket, type ReserveMarket } from './engines/reserve-market';
import { ReserveLedgerService } from './engines/reserve-ledger';
import { InMemoryLiquidityStrategyMarketplace, type LiquidityStrategyMarketplace } from './engines/liquidity-market';
import { NoOpLiquidityIntelligenceEngine, type LiquidityIntelligenceEngine } from './engines/liquidity-intelligence';
import { NoOpOpportunityDiscoveryEngine, type OpportunityDiscoveryEngine } from './engines/opportunity-discovery';
import { InMemoryRecommendationStore, type RecommendationStore } from './recommendations';
import { InMemoryLiquidityGraph, type LiquidityGraphQuery } from './graphs/liquidity-graph';
// Amendment 2 engines:
import { NoOpEconomicHealthDashboard, type EconomicHealthDashboard } from './engines/economic-health';
import { NoOpMultiHopRouter, type MultiHopRouter } from './graphs/multi-hop';
// Final Amendment engines + graphs:
import {
  InMemoryCapabilityGraph,
  type CapabilityGraph,
  CapabilityCompiler,
  CapabilityGraphProjection,
  type CapabilityCompilerInput,
  compilerInputFromKernel,
} from './graphs/capability';
import { InMemoryRouteGraph, type RouteGraph } from './graphs/route';
import { NoOpCapabilityDiscoveryEngine, type CapabilityDiscoveryEngine } from './engines/capability-discovery';
import { NoOpCorridorDiscoveryEngine, type CorridorDiscoveryEngine } from './engines/corridor-discovery';
import { NoOpReserveDiscoveryEngine, type ReserveDiscoveryEngine } from './engines/reserve-discovery';
import { NoOpLPGrowthEngine, type LPGrowthEngine } from './engines/lp-growth';
import { NoOpTreasuryGrowthEngine, type TreasuryGrowthEngine } from './engines/treasury-growth';
import { NoOpEconomicScoreEngine, type EconomicScoreEngine } from './engines/economic-score';
import { NoOpCounterfactualEngine, type CounterfactualEngine } from './engines/counterfactual';
import { InMemoryRecommendationLifecycle, type RecommendationLifecycle } from './engines/recommendation-lifecycle';
// v1.4 True Final Freeze — Financial Compiler + Knowledge Graph:
import { NoOpFinancialCompiler, type FinancialCompiler } from './compiler';
import { NoOpFinancialKnowledgeGraph, type FinancialKnowledgeGraph } from './graphs/knowledge-graph';

// Re-export the public surface.
export * from './types';
export * from './principles';
export * from './vocabulary';
export * from './clock';
export * from './events';
export * from './decisions';
export * from './intent';
export * from './policy';
export * from './pipeline';
export * from './inspector';
export * from './read-models';
// Amendment 1 public surface:
export * from './engines/reserve-market';
export * from './engines/reserve-ledger';
export * from './engines/liquidity-market';
export * from './engines/liquidity-intelligence';
export * from './engines/opportunity-discovery';
export * from './recommendations';
export * from './graphs/liquidity-graph';
// Amendment 2 public surface:
export * from './engines/economic-health';
export * from './graphs/multi-hop';
// Final Amendment public surface:
export * from './graphs/capability';
export * from './graphs/route';
export * from './engines/capability-discovery';
export * from './engines/corridor-discovery';
export * from './engines/reserve-discovery';
export * from './engines/lp-growth';
export * from './engines/treasury-growth';
export * from './engines/economic-score';
export * from './engines/counterfactual';
export * from './engines/recommendation-lifecycle';
// v1.4 True Final Freeze public surface:
export * from './compiler';
export * from './graphs/knowledge-graph';
// Integration Pass public surface (type-only — compresses peer concepts):
export * from './integration';
// v1.5 Final Tightening public surface (type-only — closed-loop optimization):
export * from './optimization-loop';

import type { MerchantIntent, TypedIntent } from './intent';
import type { ExecutionResult, StageHandler, PipelineStageId } from './pipeline';
import type { Environment, IntentSource, Actor, RequestContext } from './types';
import { requestContext } from './intent';

/** The Runtime container — holds every component and exposes dispatch. */
export interface Runtime {
  clock: RuntimeClock;
  eventStore: EventStore;
  intentEngine: IntentEngine;
  pipeline: Pipeline;
  policyEngine: PolicyEngine;
  projectionRunner: ProjectionRunner;
  // Amendment 1 engines (interface-only in M-RT-1; wired in later milestones):
  reserveMarket: ReserveMarket;
  liquidityStrategyMarketplace: LiquidityStrategyMarketplace;
  liquidityIntelligence: LiquidityIntelligenceEngine;
  opportunityDiscovery: OpportunityDiscoveryEngine;
  recommendationStore: RecommendationStore;
  liquidityGraph: LiquidityGraphQuery;
  // Amendment 2 engines (interface-only in M-RT-1; wired in later milestones):
  economicHealth: EconomicHealthDashboard;
  multiHopRouter: MultiHopRouter;
  // Final Amendment engines + graphs (interface-only in M-RT-1; wired in later milestones):
  capabilityGraph: CapabilityGraph;
  routeGraph: RouteGraph;
  capabilityDiscovery: CapabilityDiscoveryEngine;
  corridorDiscovery: CorridorDiscoveryEngine;
  reserveDiscovery: ReserveDiscoveryEngine;
  lpGrowth: LPGrowthEngine;
  treasuryGrowth: TreasuryGrowthEngine;
  economicScore: EconomicScoreEngine;
  counterfactual: CounterfactualEngine;
  recommendationLifecycle: RecommendationLifecycle;
  // v1.4 True Final Freeze — Financial Compiler + Knowledge Graph (interface-only in M-RT-1):
  compiler: FinancialCompiler;
  knowledgeGraph: FinancialKnowledgeGraph;
  // M-RT-2: Capability Graph as a compiled projection (compiler + projection):
  capabilityCompiler: CapabilityCompiler;
  capabilityProjection: CapabilityGraphProjection;
  // M-RT-3: Reserve Ledger (event-derived projection; the only writer):
  reserveLedger: ReserveLedgerService;

  /** Dispatch a raw merchant intent through the full pipeline. */
  dispatch(raw: MerchantIntent, ctx: RequestContext): Promise<ExecutionResult>;

  /** Register an execution-stage handler (M-RT-2+ uses this). */
  registerStage(stage: PipelineStageId, handler: StageHandler): void;

  /** Register intent hooks for a kind (M-RT-2+ uses this). */
  registerIntent(kind: string, hooks: import('./intent').IntentHooks): void;
}

export interface CreateRuntimeOptions {
  environment?: Environment;
  /** Use a virtual clock (sandbox/twin). Default: live clock. */
  virtualClock?: { origin?: number; speed?: number };
  /** Provide a custom EventStore (e.g. Prisma-backed in M-RT-2). */
  eventStore?: EventStore;
}

/** Create a Runtime instance. */
export function createRuntime(opts: CreateRuntimeOptions = {}): Runtime {
  const clock: RuntimeClock = opts.virtualClock
    ? new VirtualClock(opts.virtualClock)
    : new LiveClock();
  const eventStore: EventStore = opts.eventStore ?? new InMemoryEventStore();
  const intentEngine = new IntentEngine(clock);
  const policyEngine = new DefaultPolicyEngine();
  const pipeline = new Pipeline(clock, intentEngine, eventStore, policyEngine);
  const projectionRunner = new ProjectionRunner();
  projectionRunner.start(eventStore);

  // Amendment 1 engines — interface-only implementations for M-RT-1.
  const reserveMarket = new InMemoryReserveMarket();
  const liquidityStrategyMarketplace = new InMemoryLiquidityStrategyMarketplace();
  const liquidityIntelligence = new NoOpLiquidityIntelligenceEngine();
  const opportunityDiscovery = new NoOpOpportunityDiscoveryEngine();
  const recommendationStore = new InMemoryRecommendationStore();
  const liquidityGraph = new InMemoryLiquidityGraph();
  // Amendment 2 engines — interface-only (NoOp) implementations for M-RT-1.
  const economicHealth = new NoOpEconomicHealthDashboard();
  const multiHopRouter = new NoOpMultiHopRouter();
  // Final Amendment engines + graphs — interface-only (NoOp/In-memory) for M-RT-1.
  const capabilityGraph = new InMemoryCapabilityGraph();
  // M-RT-2: Capability Graph as a compiled projection (compiler + projection).
  const capabilityCompiler = new CapabilityCompiler();
  const capabilityProjection = new CapabilityGraphProjection(
    capabilityGraph,
    capabilityCompiler,
    clock,
    // getInput: returns the current source-of-truth inputs.
    // M-RT-2 transitional: reads from kernel LP data. M-RT-3+ reads from LP Profile store.
    () => compilerInputFromKernel([]),  // empty by default; seed via API
  );
  const routeGraph = new InMemoryRouteGraph();
  // M-RT-3: Reserve Ledger (event-derived projection; the only writer).
  const reserveLedger = new ReserveLedgerService(eventStore, clock);
  const capabilityDiscovery = new NoOpCapabilityDiscoveryEngine();
  const corridorDiscovery = new NoOpCorridorDiscoveryEngine();
  const reserveDiscovery = new NoOpReserveDiscoveryEngine();
  const lpGrowth = new NoOpLPGrowthEngine();
  const treasuryGrowth = new NoOpTreasuryGrowthEngine();
  const economicScore = new NoOpEconomicScoreEngine();
  const counterfactual = new NoOpCounterfactualEngine();
  const recommendationLifecycle = new InMemoryRecommendationLifecycle();
  // v1.4 True Final Freeze — Financial Compiler + Knowledge Graph (NoOp for M-RT-1).
  const compiler = new NoOpFinancialCompiler();
  const knowledgeGraph = new NoOpFinancialKnowledgeGraph();

  const runtime: Runtime = {
    clock,
    eventStore,
    intentEngine,
    pipeline,
    policyEngine,
    projectionRunner,
    reserveMarket,
    liquidityStrategyMarketplace,
    liquidityIntelligence,
    opportunityDiscovery,
    recommendationStore,
    liquidityGraph,
    economicHealth,
    multiHopRouter,
    capabilityGraph,
    routeGraph,
    capabilityDiscovery,
    corridorDiscovery,
    reserveDiscovery,
    lpGrowth,
    treasuryGrowth,
    economicScore,
    counterfactual,
    recommendationLifecycle,
    compiler,
    knowledgeGraph,
    capabilityCompiler,
    capabilityProjection,
    reserveLedger,
    dispatch: (raw, ctx) => pipeline.dispatch(raw, ctx),
    registerStage: (stage, handler) => pipeline.register(stage, handler),
    registerIntent: (kind, hooks) => intentEngine.register(kind, hooks),
  };
  return runtime;
}

/**
 * The default Runtime singleton (live environment, in-memory store).
 *
 * Uses globalThis so Next.js dev-mode module re-instantiation doesn't
 * create duplicate runtimes (same pattern as the existing eventBus/db).
 */
const globalForRuntime = globalThis as unknown as { __PAYSWAP_RUNTIME__?: Runtime };
export const runtime: Runtime =
  globalForRuntime.__PAYSWAP_RUNTIME__ ?? createRuntime();
if (!globalForRuntime.__PAYSWAP_RUNTIME__) {
  globalForRuntime.__PAYSWAP_RUNTIME__ = runtime;
}

/**
 * Convenience: dispatch a raw intent on the default runtime.
 *
 * @example
 *   const result = await dispatch(
 *     { kind: 'payment', raw: { customer: 'Alice', amount: 120, currency: 'USD' } },
 *     { actor: { id: 'usr_1', role: 'merchant' }, environment: 'sandbox', source: 'dashboard' },
 *   );
 */
export function dispatch(
  raw: MerchantIntent,
  ctx: {
    actor: Actor;
    environment: Environment;
    source: IntentSource;
    correlationId?: string;
    causationId?: string;
  },
): Promise<ExecutionResult> {
  return runtime.dispatch(raw, requestContext(ctx));
}

/** Re-export key types for callers. */
export type { MerchantIntent, TypedIntent, ExecutionResult, RuntimeClock, EventStore, PolicyEngine };
