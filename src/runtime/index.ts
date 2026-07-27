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
import { ReserveMarketEngine } from './engines/reserve-market-v2';
import { LiquidityMarketplaceService } from './engines/liquidity-marketplace';
import { RouteCompiler, RouteScoringEngine } from './engines/routing';
import { OpportunityDiscoveryEngine } from './engines/opportunity-discovery-v2';
import { RecommendationLifecycleService } from './engines/recommendation-lifecycle-v2';
import { DigitalTwinEngine } from './engines/digital-twin';
import { ExecutionPipeline } from './engines/execution-pipeline';
import { SimulatorEngine } from './engines/simulator';
import { InspectorService } from './engines/inspector';
import { APIGateway } from './engines/api-gateway';
import { SchedulingEngine } from './engines/scheduling';
import { InMemoryLiquidityStrategyMarketplace, type LiquidityStrategyMarketplace } from './engines/liquidity-market';
import { NoOpLiquidityIntelligenceEngine, type LiquidityIntelligenceEngine } from './engines/liquidity-intelligence';
import { NoOpOpportunityDiscoveryEngine, type OpportunityDiscoveryEngine as OldOpportunityDiscoveryEngine } from './engines/opportunity-discovery';
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
import { NoOpFinancialCompiler, type FinancialCompiler, RealFinancialCompiler, type RealCompilerContext } from './compiler';
import { NoOpFinancialKnowledgeGraph, type FinancialKnowledgeGraph } from './graphs/knowledge-graph';
// M-RT-16/18/19: Capability migration + liquidity composition:
import { PaymentsService, PaymentBackfillService } from './engines/payments';
import { RefundsService, RefundBackfillService } from './engines/refunds';
import { WalletsService, WalletBackfillService } from './engines/wallets';
import { TreasuryService, TreasuryBackfillService } from './engines/treasury';
import { ProjectionHealthRegistry, MigrationManager } from './migration';
import { LiquidityComposer } from './engines/liquidity-composer';
// M-RT-20: Economic Integrity Hardening (Invariant Engine):
import { InvariantEngine, BUILTIN_INVARIANTS } from './invariants';
// M-RT-21: Runtime Enforcement (Dispatcher — the only way to mutate state):
import { RuntimeDispatcher, CommandRegistry, BUILTIN_HANDLERS } from './dispatcher';
// M-RT-25: Economic Kernel (Twin Tokens + LP Runtime + Marketplace + Economic Compiler):
import { TwinTokenProjection, LPRuntimeProjection, EconomicMarketplace, EconomicCompiler } from './economic';
// M-RT-26: Transaction Coordinator + Settlement Adapters:
import { TransactionCoordinator } from './transaction';
import { createDefaultAdapters, type SettlementAdapterRegistry } from './settlement';
// M-RT-27: Event Evolution (Schema Registry + Event Upcaster):
import { SchemaRegistry, registerAllEventTypes } from './event-evolution';
// M-RT-28: Runtime Recovery (Recovery Manager + Kernel Manifest):
import { RecoveryManager, buildManifest, type KernelManifest } from './recovery';
// M-RT-29: Dual Runtime (RuntimeHost — Sandbox + Live isolation):
import { RuntimeHost, type RuntimeContext } from './host';
// M-RT-30: Liquidity Intelligence & Settlement Kernel:
import { LiquidityPolicyEngine, BandwidthEngine, SettlementContractEngine, DisputeEngine } from './liquidity';

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
export * from './engines/reserve-market-v2';
export * from './engines/liquidity-marketplace';
// M-RT-6 routing: explicit re-exports to avoid collision with graphs/route types.
export { RouteCompiler } from './engines/routing';
export { RouteScoringEngine } from './engines/routing';
export type { ScoringInputs } from './engines/routing';
export type {
  RouteScoreComponents,
  ScoredRoute,
  RoutingRequest,
  RoutingResult,
  ScoringWeights,
} from './engines/routing';
export { computeTotalScore, DEFAULT_SCORING_WEIGHTS, validateRoute } from './engines/routing';
export * from './engines/opportunity-discovery-v2';
export * from './engines/recommendation-lifecycle-v2';
// M-RT-11 Digital Twin: explicit re-exports to avoid collision with counterfactual types.
export { DigitalTwinEngine } from './engines/digital-twin';
export type { DigitalTwinInputs } from './engines/digital-twin';
export type {
  NetworkSnapshot as TwinNetworkSnapshot,
  PredictedMetric,
  NetworkComparison,
  SimulationAssumption,
  SimulationResult,
  TwinConfig,
  SimulatableRecommendation,
} from './engines/digital-twin';
export { DEFAULT_TWIN_CONFIG } from './engines/digital-twin';
export * from './engines/execution-pipeline';
export * from './engines/simulator';
export * from './engines/inspector';
export * from './engines/api-gateway';
export * from './engines/scheduling';
export * from './read-models/v2';
export * from './engines/liquidity-market';
export * from './engines/liquidity-intelligence';
// v1 opportunity-discovery (legacy NoOp — replaced by v2):
export { NoOpOpportunityDiscoveryEngine } from './engines/opportunity-discovery';
export type { OpportunityDiscoveryEngine as OldOpportunityDiscoveryEngine } from './engines/opportunity-discovery';
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
// M-RT-16/18/19 public surface (explicit re-exports to avoid naming conflicts):
export { PaymentsService, PaymentBackfillService, PaymentProjection } from './engines/payments';
export type { PaymentView, PaymentRecordedPayload, PaymentListOptions } from './engines/payments';
export { RefundsService, RefundBackfillService, RefundProjection } from './engines/refunds';
export type { RefundView, RefundRequestedPayload, RefundListOptions } from './engines/refunds';
export { WalletsService, WalletBackfillService, WalletProjection } from './engines/wallets';
export type { WalletView, WalletCreatedPayload, WalletListOptions } from './engines/wallets';
export { TreasuryService, TreasuryBackfillService, TreasuryProjection } from './engines/treasury';
export type { TreasuryAccountView, AccountKind, TreasuryListOptions } from './engines/treasury';
export * from './migration';
export { LiquidityComposer, buildGraph, findPaths, optimizeSplit, rankPaths, decomposeCost } from './engines/liquidity-composer';
export type { CompositionRequest, ComposedExecutionPlan, ExecutionLeg, SplitPlan, PathAllocation, GraphBuildInputs, LPOfferInput, ReserveBridgeInput } from './engines/liquidity-composer';
export * from './read-models/v2';
// M-RT-20: Invariant Engine public surface:
export * from './invariants';
// M-RT-21/22: Runtime Dispatcher public surface (explicit re-exports to avoid RetryPolicy conflict with scheduling):
export { RuntimeDispatcher, CommandRegistry, BUILTIN_HANDLERS } from './dispatcher';
export type { DispatchResult, DispatcherInputs, CommandHandler, CommandResult } from './dispatcher';
export type { RuntimeCommand, CommandMetadata, AnyRuntimeCommand, CommandType } from './dispatcher';
export type { CreatePaymentCommand, CreateRefundCommand, ExecuteRefundCommand, ReserveLiquidityCommand, ReleaseLiquidityCommand, WalletCreditCommand, WalletDebitCommand, WalletReserveCommand, WalletReleaseCommand } from './dispatcher';
export { IdempotencyStore } from './dispatcher';
export type { CachedResult } from './dispatcher';
export { defaultShouldRetry } from './dispatcher';
export type { RetryPolicyOptions, RetryOutcome } from './dispatcher';
// Re-export RetryPolicy with an alias to avoid conflict with scheduling's RetryPolicy.
export { RetryPolicy as DispatcherRetryPolicy } from './dispatcher';
// M-RT-25: Economic Kernel public surface:
export * from './economic';
// M-RT-26: Transaction Coordinator + Settlement public surface:
export * from './transaction';
export * from './settlement';
// M-RT-27: Event Evolution public surface:
export * from './event-evolution';
// M-RT-28: Runtime Recovery public surface:
export * from './recovery';
// M-RT-29: Dual Runtime public surface:
export { RuntimeHost } from './host';
export type { RuntimeContext } from './host';
// M-RT-30: Liquidity Intelligence public surface:
export * from './liquidity';

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
  reserveMarketState: ReserveMarket;  // A1 shadow-price publisher (legacy interface)
  liquidityStrategyMarketplace: LiquidityStrategyMarketplace;
  liquidityIntelligence: LiquidityIntelligenceEngine;
  opportunityDiscovery: OldOpportunityDiscoveryEngine;
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
  // M-RT-4: Reserve Market (pure read model — no persistent state; derived from ledger):
  reserveMarket: ReserveMarketEngine;
  // M-RT-5: Liquidity Marketplace (offer events → order book projection; deterministic matching):
  liquidityMarketplace: LiquidityMarketplaceService;
  // M-RT-6: Route Graph (compiled projection) + Reserve-Aware Routing (pure scoring):
  routeCompiler: RouteCompiler;
  routeScoringEngine: RouteScoringEngine;
  // M-RT-7: The real Financial Compiler (pure, deterministic, reads-only):
  realCompiler: RealFinancialCompiler;
  // M-RT-9: Opportunity Discovery (pure, deterministic network analysis → Recommendations):
  opportunityDiscoveryV2: OpportunityDiscoveryEngine;
  // M-RT-10: Recommendation Lifecycle (event-driven state management; the only writer):
  recLifecycle: RecommendationLifecycleService;
  // M-RT-11: Digital Twin (pure simulation — no state, no events, no mutations):
  digitalTwin: DigitalTwinEngine;
  // M-RT-12: Execution Pipeline (side-effect-owning executor; owns all mutations):
  executionPipeline: ExecutionPipeline;
  // M-RT-13: Simulator (sim = prod; same runtime, different context):
  simulator: SimulatorEngine;
  // M-RT-14: Inspector (read-only visualization, explanation, provenance):
  inspector: InspectorService;
  // M-RT-15: API Gateway (single ingress; auth, validation, idempotency, rate limiting, tracing):
  apiGateway: APIGateway;
  // M-RT-15: Scheduling Engine (clock-driven, deterministic, retry, dead-letter):
  schedulingEngine: SchedulingEngine;
  // M-RT-16: Liquidity Composer (multi-hop + split routing). Pure — never executes.
  composer: LiquidityComposer;
  // M-RT-18: Payments capability (Events → Projection → Read Model → View).
  payments: PaymentsService;
  paymentBackfill: PaymentBackfillService;
  // M-RT-19: Refunds capability (uses BackfillEngine<T>).
  refunds: RefundsService;
  refundBackfill: RefundBackfillService;
  // M-RT-23: Wallets capability (stateful aggregate — derived balances).
  wallets: WalletsService;
  walletBackfill: WalletBackfillService;
  // M-RT-24: Treasury Kernel (financial source of truth — 5 account types).
  treasury: TreasuryService;
  treasuryBackfill: TreasuryBackfillService;
  // M-RT-25: Economic Kernel (Twin Tokens + LP Runtime + Marketplace + Economic Compiler).
  twinTokens: TwinTokenProjection;
  lpRuntime: LPRuntimeProjection;
  marketplace: EconomicMarketplace;
  economicCompiler: EconomicCompiler;
  // M-RT-26: Transaction Coordinator (the ONLY component allowed to commit events).
  coordinator: TransactionCoordinator;
  // M-RT-26: Settlement Adapter Registry (pluggable blockchain settlement).
  settlements: SettlementAdapterRegistry;
  // M-RT-27: Schema Registry (event evolution + upcasters + projection compatibility).
  schema: SchemaRegistry;
  // M-RT-28: Recovery Manager (checkpoint + crash recovery + projection verification).
  recovery: RecoveryManager;
  // M-RT-30: Liquidity Intelligence (policy engine + bandwidth + settlement contracts + disputes).
  liquidityPolicy: LiquidityPolicyEngine;
  bandwidth: BandwidthEngine;
  settlementContracts: SettlementContractEngine;
  disputes: DisputeEngine;
  // M-RT-19: Projection health registry (aggregates health from all projections).
  health: ProjectionHealthRegistry;
  // M-RT-19: Migration manager (owns all capability backfills).
  migrations: MigrationManager;
  // M-RT-20: Invariant Engine (verifies economic invariants before every append).
  invariants: InvariantEngine;
  // M-RT-21: Runtime Dispatcher (the ONLY way to mutate financial state).
  dispatcher: RuntimeDispatcher;
  // M-RT-21: Command Registry (holds all command handlers).
  commands: CommandRegistry;

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
  const reserveMarketState = new InMemoryReserveMarket();
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
  // M-RT-4: Reserve Market (pure read model — no persistent state; derived from ledger).
  const reserveMarket = new ReserveMarketEngine(reserveLedger, clock);
  // M-RT-5: Liquidity Marketplace (offer events → order book projection; deterministic matching).
  const liquidityMarketplace = new LiquidityMarketplaceService(eventStore, clock);
  // M-RT-6: Route Graph (compiled from Capability Graph) + Reserve-Aware Routing (pure scoring).
  const routeCompiler = new RouteCompiler();
  const routeScoringEngine = new RouteScoringEngine({
    routeGraph: routeCompiler.rebuild(capabilityGraph, clock.now()),
    capabilityGraph,
    reserveMarket,
    liquidityMarketplace,
    clock,
  });
  // M-RT-7: The real Financial Compiler (pure, deterministic, reads-only).
  const realCompiler = new RealFinancialCompiler();
  // M-RT-9: Opportunity Discovery (pure, deterministic network analysis → Recommendations).
  const opportunityDiscoveryV2 = new OpportunityDiscoveryEngine({
    capabilityGraph,
    reserveLedger,
    reserveMarket,
    liquidityMarketplace,
    routeCompiler,
    clock,
  });
  // M-RT-10: Recommendation Lifecycle (event-driven state management; the only writer).
  const recLifecycle = new RecommendationLifecycleService(eventStore, clock);
  // M-RT-11: Digital Twin (pure simulation — no state, no events, no mutations).
  const digitalTwin = new DigitalTwinEngine({
    capabilityGraph,
    reserveLedger,
    reserveMarket,
    liquidityMarketplace,
    routeCompiler,
    clock,
  });
  // M-RT-12: Execution Pipeline (side-effect-owning executor; owns all mutations).
  const executionPipeline = new ExecutionPipeline({
    eventStore,
    clock,
    reserveLedger,
    liquidityMarketplace,
  });
  // M-RT-13: Simulator (sim = prod; same runtime, different context).
  const simulator = new SimulatorEngine({
    clock,
    capabilityGraph,
    reserveLedger,
    reserveMarket,
    liquidityMarketplace,
    routeCompiler,
    realCompiler,
    executionPipeline,
  });
  // M-RT-14: Inspector (read-only visualization, explanation, provenance).
  const inspector = new InspectorService({
    eventStore,
    clock,
    capabilityGraph,
    reserveLedger,
    reserveMarket,
    liquidityMarketplace,
    routeCompiler,
    opportunityDiscovery: opportunityDiscoveryV2,
    recLifecycle,
  });
  // M-RT-15: API Gateway (single ingress; auth, validation, idempotency, rate limiting, tracing).
  const apiGateway = new APIGateway(clock);
  // M-RT-15: Scheduling Engine (clock-driven, deterministic, retry, dead-letter).
  const schedulingEngine = new SchedulingEngine(clock);
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

  // ── M-RT-16: Liquidity Composer (multi-hop + split routing) ─────────────
  const composer = new LiquidityComposer();

  // ── M-RT-18: Payments capability (Events → Projection → Read Model → View) ─
  const payments = new PaymentsService({ eventStore, clock });
  projectionRunner.register(payments.projection);
  const paymentBackfill = new PaymentBackfillService({
    paymentsService: payments,
    environment: opts.environment ?? 'live',
    actorId: 'system:backfill',
    correlationPrefix: 'backfill:payment',
  });

  // ── M-RT-19: Refunds capability (uses BackfillEngine<T>) ────────────────
  const refunds = new RefundsService({ eventStore, clock });
  projectionRunner.register(refunds.projection);
  const refundBackfill = new RefundBackfillService({
    refundsService: refunds,
    environment: opts.environment ?? 'live',
    correlationPrefix: 'backfill:refund',
  });

  // ── M-RT-23: Wallets capability (stateful aggregate — derived balances) ─
  const wallets = new WalletsService({ eventStore, clock });
  projectionRunner.register(wallets.projection);
  const walletBackfill = new WalletBackfillService({
    walletsService: wallets,
    environment: opts.environment ?? 'live',
    correlationPrefix: 'backfill:wallet',
  });

  // ── M-RT-24: Treasury Kernel (financial source of truth) ────────────────
  const treasury = new TreasuryService({ eventStore, clock });
  projectionRunner.register(treasury.projection);
  const treasuryBackfill = new TreasuryBackfillService({
    treasuryService: treasury,
    environment: opts.environment ?? 'live',
    correlationPrefix: 'backfill:treasury',
  });

  // ── M-RT-25: Economic Kernel (Twin Tokens + LP Runtime + Marketplace) ───
  const twinTokens = new TwinTokenProjection();
  const lpRuntime = new LPRuntimeProjection();
  const marketplace = new EconomicMarketplace(lpRuntime);
  const economicCompiler = new EconomicCompiler(marketplace);
  // M-RT-29 fix: register LP + twin token projections with the ProjectionRunner
  // so they receive live events from the EventStore.
  projectionRunner.register(lpRuntime as unknown as import('./read-models').Projection);
  projectionRunner.register(twinTokens as unknown as import('./read-models').Projection);

  // ── M-RT-19: Migration Manager (owns all capability backfills) ──────────
  const migrations = new MigrationManager();
  migrations.register('payments', 1, () => paymentBackfill.run(), () => paymentBackfill.status(), () => paymentBackfill.status().then((s) => payments.health(s.prismaCount)));
  migrations.register('refunds', 1, () => refundBackfill.run(), () => refundBackfill.status(), () => refundBackfill.status().then((s) => refunds.health(s.prismaCount)));
  migrations.register('wallets', 1, () => walletBackfill.run(), () => walletBackfill.status(), () => walletBackfill.status().then((s) => wallets.health(s.prismaCount)));
  migrations.register('treasury', 1, () => treasuryBackfill.run(), () => treasuryBackfill.status(), () => treasuryBackfill.status().then((s) => treasury.health(s.prismaCount)));
  migrations.triggerAll();

  // ── M-RT-19: Projection health registry ─────────────────────────────────
  const health = new ProjectionHealthRegistry();
  health.register('payments', async () => { const s = await paymentBackfill.status(); return payments.health(s.prismaCount); });
  health.register('refunds', async () => { const s = await refundBackfill.status(); return refunds.health(s.prismaCount); });
  health.register('wallets', async () => { const s = await walletBackfill.status(); return wallets.health(s.prismaCount); });
  health.register('treasury', async () => { const s = await treasuryBackfill.status(); return treasury.health(s.prismaCount); });

  // ── M-RT-20: Invariant Engine (economic integrity hardening) ────────────
  const invariants = new InvariantEngine();
  for (const inv of BUILTIN_INVARIANTS) {
    invariants.register(inv);
  }

  // ── M-RT-21: Runtime Dispatcher (the only way to mutate financial state) ─
  const commands = new CommandRegistry();
  for (const handler of BUILTIN_HANDLERS) {
    commands.register(handler);
  }
  const dispatcher = new RuntimeDispatcher({ eventStore, clock, invariants, registry: commands });

  // ── M-RT-26: Transaction Coordinator + Settlement Adapters ──────────────
  const coordinator = new TransactionCoordinator({ eventStore, clock, invariants, registry: commands });
  const settlements = createDefaultAdapters();

  // ── M-RT-27: Event Evolution (Schema Registry + Upcasters) ──────────────
  const schema = new SchemaRegistry();
  registerAllEventTypes(schema);

  // ── M-RT-28: Runtime Recovery (Recovery Manager) ────────────────────────
  const recovery = new RecoveryManager({ eventStore, schema });
  // Register all projections with the recovery manager.
  recovery.register(payments.projection, () => payments.projection.totalAll(), () => payments.projection.eventsApplied());
  recovery.register(refunds.projection, () => refunds.projection.totalAll(), () => refunds.projection.eventsApplied());
  recovery.register(wallets.projection, () => wallets.projection.count(), () => wallets.projection.eventsApplied());
  recovery.register(treasury.projection, () => treasury.projection.count(), () => treasury.projection.eventsApplied());

  // ── M-RT-30: Liquidity Intelligence & Settlement Kernel ─────────────────
  const bandwidth = new BandwidthEngine();
  const settlementContracts = new SettlementContractEngine();
  const disputes = new DisputeEngine();
  projectionRunner.register(bandwidth as unknown as import('./read-models').Projection);
  projectionRunner.register(settlementContracts as unknown as import('./read-models').Projection);
  projectionRunner.register(disputes as unknown as import('./read-models').Projection);
  const liquidityPolicy = new LiquidityPolicyEngine({
    getReserve: (country, currency) => {
      // Query treasury for reserve accounts.
      const accounts = treasury.projection.listByKind('reserve');
      const match = accounts.find((a) => a.reference === country && a.currency === currency);
      return match?.availableBalance ?? 0;
    },
    getStablecoinInventory: (currency) => {
      const accounts = treasury.projection.listByKind('treasury');
      const match = accounts.find((a) => a.currency === currency && a.reference?.includes('stablecoin'));
      return match?.availableBalance ?? 0;
    },
    getBandwidth: (country, assetType) => bandwidth.getAvailableBandwidth(country, assetType),
  });

  const runtime: Runtime = {
    clock,
    eventStore,
    intentEngine,
    pipeline,
    policyEngine,
    projectionRunner,
    reserveMarketState,
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
    reserveMarket,
    liquidityMarketplace,
    routeCompiler,
    routeScoringEngine,
    realCompiler,
    opportunityDiscoveryV2,
    recLifecycle,
    digitalTwin,
    executionPipeline,
    simulator,
    inspector,
    apiGateway,
    schedulingEngine,
    composer,
    payments,
    paymentBackfill,
    refunds,
    refundBackfill,
    wallets,
    walletBackfill,
    treasury,
    treasuryBackfill,
    twinTokens,
    lpRuntime,
    marketplace,
    economicCompiler,
    coordinator,
    settlements,
    schema,
    recovery,
    liquidityPolicy,
    bandwidth,
    settlementContracts,
    disputes,
    health,
    migrations,
    invariants,
    dispatcher,
    commands,
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

/**
 * M-RT-29: The global RuntimeHost singleton (Sandbox + Live).
 *
 * Owns two completely independent runtime instances. Use `runtimeHost.get('sandbox')`
 * or `runtimeHost.get('live')` to access a specific runtime.
 *
 * Uses globalThis so Next.js dev-mode doesn't create duplicate hosts.
 */
const globalForHost = globalThis as unknown as { __PAYSWAP_RUNTIME_HOST__?: RuntimeHost };
export const runtimeHost: RuntimeHost =
  globalForHost.__PAYSWAP_RUNTIME_HOST__ ?? new RuntimeHost();
if (!globalForHost.__PAYSWAP_RUNTIME_HOST__) {
  globalForHost.__PAYSWAP_RUNTIME_HOST__ = runtimeHost;
}
