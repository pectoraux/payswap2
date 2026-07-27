/**
 * Inspector Service — read-only visualization, explanation, and provenance.
 * (M-RT-14.)
 *
 * The Inspector is READ-ONLY. It never mutates runtime state or writes events.
 * It consumes existing projections rather than recomputing them.
 *
 * Responsibilities:
 *   1. Execution Trace View — compiler passes, pipeline stages, timing, decisions
 *   2. Resource Graph — reserves, liquidity, settlement resources, utilization
 *   3. Economic Graph — costs, shadow prices, expected value
 *   4. Capability/Route Graph — capabilities, routes, selected route, rejected alternatives
 *   5. Recommendation Provenance — analyzer → evidence → twin → lifecycle → measurement
 *
 * For each graph, the Inspector answers:
 *   1. What exists?
 *   2. Why does it look this way?
 *   3. Where did this information come from? (provenance)
 */

import type { Environment } from '../../types';
import type { RuntimeClock } from '../../clock';
import type { EventStore, StoredEvent } from '../../events';
import type { CapabilityGraph } from '../../graphs/capability/types';
import type { ReserveLedgerService } from '../reserve-ledger/service';
import type { ReserveMarketEngine } from '../reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../liquidity-marketplace/service';
import type { RouteCompiler } from '../routing/compiler';
import type { OpportunityDiscoveryEngine } from '../opportunity-discovery-v2/engine';
import type { RecommendationLifecycleService } from '../recommendation-lifecycle-v2/service';

// ─── Execution Trace View ───────────────────────────────────────────────────

/** A full execution trace for one payment. */
export interface ExecutionTraceView {
  paymentId: string;
  intentId: string;
  planId: string;
  status: 'completed' | 'failed';
  // Compiler passes (from the ExecutionPlan):
  compilerPasses: {
    pass: string;
    choice: string;
    reasoning: string;
    durationMs: number;
    costBps?: number;
    riskScore?: number;
    alternatives?: { option: string; score: number; rejectedBecause: string }[];
    tradeoffs?: { dimension: string; delta: number }[];
  }[];
  // Pipeline stages (from the execution result):
  pipelineStages: {
    stage: string;
    status: string;
    durationMs: number;
    detail: string;
    eventsEmitted: string[];
  }[];
  // Events emitted:
  domainEvents: string[];
  // Plan details:
  plan: {
    lpAllocations: { lpId: string; capabilityId: string; amount: number; feeBps: number }[];
    settlementLegs: { legId: string; from: string; to: string; amount: number; currency: string; connectorId: string }[];
    reserveAllocations: { reserveId: string; amount: number; currency: string; shadowPriceBps: number }[];
    fxHops: { from: string; to: string; rate: number; costBps: number }[];
    estimatedCostBps: number;
    estimatedRisk: number;
    rationale: string;
    alternativesConsidered: { description: string; estimatedCostBps: number; estimatedRisk: number; rejectedBecause: string }[];
    executionTiming: { startAt: number; settleBy: number; isImmediate: boolean };
  };
  // Explainability:
  explanation: string;
  // Provenance:
  eventStreamId: string;
  eventCount: number;
  // Timing:
  compiledAt: number;
  executedAt: number;
  totalDurationMs: number;
}

// ─── Graph Views ────────────────────────────────────────────────────────────

/** Resource Graph view — reserves, liquidity, utilization. */
export interface ResourceGraphView {
  reserves: {
    reserveId: string;
    asset: string;
    owner: string;
    jurisdiction: string;
    backingPolicy: string;
    balances: { available: number; locked: number; pending: number; consumed: number; released: number };
    total: number;
    version: number;
    // Provenance:
    source: 'reserve_ledger_projection';
    lastEvent: string | null;
  }[];
  offers: {
    offerId: string;
    lpId: string;
    from: string;
    to: string;
    rail: string;
    maxAmount: number;
    minAmount: number;
    feeBps: number;
    latencyMs: number;
    riskScore: number;
    active: boolean;
    source: 'liquidity_marketplace_projection';
  }[];
  source: 'compiled_projections';
  generatedAt: number;
}

/** Economic Graph view — costs, shadow prices, expected value. */
export interface EconomicGraphView {
  reserveMarket: {
    reserveId: string;
    asset: string;
    utilization: number;
    shadowPriceBps: number;
    reserveCostBps: number;
    scarcity: string;
    confidence: number;
    forecast: { metric: string; value: number; confidence: number; assumptions: string[] };
    source: 'reserve_market_engine';
  }[];
  routeScores: {
    from: string;
    to: string;
    ownerId: string;
    totalScore: number;
    components: {
      executionCostBps: number;
      reserveCostBps: number;
      liquidityCostBps: number;
      fxCostBps: number;
      settlementCostBps: number;
      latencyMs: number;
      risk: number;
      confidence: number;
      policyPenalty: number;
    };
    eligible: boolean;
    rejectionReason?: string;
    source: 'route_scoring_engine';
  }[];
  source: 'pure_analysis';
  generatedAt: number;
}

/** Capability/Route Graph view — capabilities, routes, selected vs rejected. */
export interface CapabilityRouteGraphView {
  capabilities: {
    id: string;
    ownerId: string;
    ownerType: string;
    from: string;
    to: string;
    rail: string;
    settlementNetwork: string;
    settlementMethod: string;
    latencyMs: number;
    maxAmount: number;
    minAmount: number;
    complianceRegion: string;
    fxMode: string;
    reserveRequired: boolean;
    riskScore: number;
    priority: number;
    availability: number;
    active: boolean;
    source: 'capability_graph_projection';
  }[];
  routes: {
    id: string;
    from: string;
    to: string;
    hopCount: number;
    isDirect: boolean;
    ownerId: string;
    source: 'route_graph_compiled';
  }[];
  source: 'compiled_projections';
  generatedAt: number;
}

// ─── Recommendation Provenance ──────────────────────────────────────────────

/** Full provenance chain for a recommendation. */
export interface RecommendationProvenance {
  recommendationId: string;
  // 1. Which analyzer produced it?
  analyzer: {
    kind: string;
    severity: string;
    title: string;
    description: string;
    confidence: number;
    expectedValue: { dimension: string; delta: string }[];
    evidence: { source: string; observation: string; confidence: number }[];
    graphDiff: { addNodes: unknown[]; addEdges: unknown[]; description: string };
    implementationSteps: { action: string; estimatedEffort: string }[];
    assumptions: string[];
    generatedAt: number;
    source: 'opportunity_discovery';
  } | null;
  // 2. What did the Digital Twin say?
  twinSimulation: {
    confidence: number;
    netAssessment: string;
    improvements: string[];
    regressions: string[];
    explanation: string;
    assumptions: { assumption: string; impact: string }[];
    source: 'digital_twin';
  } | null;
  // 3. What is the lifecycle state?
  lifecycle: {
    currentState: string;
    detectedAt: number;
    lastTransitionAt: number;
    historyCount: number;
    score?: number;
    measurement?: { actualVolumeDelta: number; actualRevenueDelta: number; actualCostDeltaBps: number };
    source: 'recommendation_lifecycle_projection';
  } | null;
  // 4. Full provenance chain:
  provenanceChain: {
    step: string;
    description: string;
    source: string;
    timestamp?: number;
  }[];
}

// ─── Network Overview ───────────────────────────────────────────────────────

/** A high-level network overview for the Inspector dashboard. */
export interface NetworkOverview {
  capabilities: number;
  routes: number;
  offers: number;
  reserves: number;
  recommendations: number;
  payments: number;
  // Health:
  averageUtilization: number;
  criticalReserves: number;
  singleProviderRoutes: number;
  // Provenance:
  source: 'aggregated_projections';
  generatedAt: number;
}

// ─── Inspector Service ──────────────────────────────────────────────────────

/** Inputs to the Inspector (all read-only). */
export interface InspectorInputs {
  eventStore: EventStore;
  clock: RuntimeClock;
  capabilityGraph: CapabilityGraph;
  reserveLedger: ReserveLedgerService;
  reserveMarket: ReserveMarketEngine;
  liquidityMarketplace: LiquidityMarketplaceService;
  routeCompiler: RouteCompiler;
  opportunityDiscovery: OpportunityDiscoveryEngine;
  recLifecycle: RecommendationLifecycleService;
}

/**
 * InspectorService — READ-ONLY. Never mutates. Never writes events.
 * Consumes existing projections. Its job is visualization, explanation, provenance.
 */
export class InspectorService {
  constructor(private inputs: InspectorInputs) {}

  /** Get the full execution trace for a payment. Read-only. */
  async getExecutionTrace(paymentId: string, environment: Environment): Promise<ExecutionTraceView | null> {
    const { eventStore, clock } = this.inputs;
    const streamId = `${environment}:payment:${paymentId}`;
    const events = await eventStore.readStream(streamId);
    if (events.length === 0) return null;

    const paymentEvent = events.find((e) => e.type === 'payment.completed');
    if (!paymentEvent) return null;

    const payload = paymentEvent.payload as {
      paymentId: string;
      intentId: string;
      planId: string;
      amount: number;
      from: string;
      to: string;
      lpId: string;
      feeBps: number;
      stages: { stage: string; status: string; durationMs: number }[];
    };

    return {
      paymentId: payload.paymentId,
      intentId: payload.intentId,
      planId: payload.planId,
      status: 'completed',
      compilerPasses: [], // M-RT-14: would read from the plan's passes (stored in the event payload in future milestones)
      pipelineStages: payload.stages.map((s) => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs,
        detail: '',
        eventsEmitted: [],
      })),
      domainEvents: events.map((e) => e.type),
      plan: {
        lpAllocations: [{ lpId: payload.lpId, capabilityId: '', amount: payload.amount, feeBps: payload.feeBps }],
        settlementLegs: [{ legId: 'leg_0', from: payload.from, to: payload.to, amount: payload.amount, currency: payload.to, connectorId: payload.lpId }],
        reserveAllocations: [],
        fxHops: [],
        estimatedCostBps: payload.feeBps,
        estimatedRisk: 0,
        rationale: `Payment ${payload.paymentId}: ${payload.from}→${payload.to} via ${payload.lpId}`,
        alternativesConsidered: [],
        executionTiming: { startAt: paymentEvent.metadata.timestamp, settleBy: paymentEvent.metadata.timestamp, isImmediate: true },
      },
      explanation: `Payment ${payload.paymentId} completed: ${payload.amount} ${payload.to} via LP ${payload.lpId} at ${payload.feeBps}bps`,
      eventStreamId: streamId,
      eventCount: events.length,
      compiledAt: paymentEvent.metadata.timestamp,
      executedAt: paymentEvent.metadata.timestamp,
      totalDurationMs: 0,
    };
  }

  /** Get the Resource Graph view. Read-only. */
  async getResourceGraph(environment: Environment): Promise<ResourceGraphView> {
    const { reserveLedger, liquidityMarketplace, clock } = this.inputs;

    const reserves = await reserveLedger.listReserves(environment);
    const book = await liquidityMarketplace.getOrderBook(environment);

    return {
      reserves: reserves.map((s) => ({
        reserveId: s.reserve.id,
        asset: s.reserve.asset,
        owner: s.reserve.owner,
        jurisdiction: s.reserve.jurisdiction,
        backingPolicy: s.reserve.backingPolicy,
        balances: s.balances,
        total: s.balances.available + s.balances.locked + s.balances.pending + s.balances.consumed + s.balances.released,
        version: s.version,
        source: 'reserve_ledger_projection' as const,
        lastEvent: null,
      })),
      offers: book.offers.map((o) => ({
        offerId: o.id,
        lpId: o.lpId,
        from: o.from,
        to: o.to,
        rail: o.rail,
        maxAmount: o.maxAmount,
        minAmount: o.minAmount,
        feeBps: o.pricingCurve[0]?.feeBps ?? 0,
        latencyMs: o.latencyMs,
        riskScore: o.riskScore,
        active: o.active,
        source: 'liquidity_marketplace_projection' as const,
      })),
      source: 'compiled_projections' as const,
      generatedAt: clock.now(),
    };
  }

  /** Get the Economic Graph view. Read-only. */
  async getEconomicGraph(environment: Environment): Promise<EconomicGraphView> {
    const { reserveMarket, clock } = this.inputs;

    const marketSnapshots = await reserveMarket.getMarketSnapshotAll(environment);

    return {
      reserveMarket: marketSnapshots.reserves.map((s) => ({
        reserveId: s.reserveId,
        asset: s.asset,
        utilization: s.utilization,
        shadowPriceBps: s.shadowPriceBps,
        reserveCostBps: s.reserveCostBps,
        scarcity: s.scarcity,
        confidence: s.confidence,
        forecast: {
          metric: s.forecast.metric,
          value: s.forecast.value,
          confidence: s.forecast.confidence,
          assumptions: s.forecast.assumptions,
        },
        source: 'reserve_market_engine' as const,
      })),
      routeScores: [], // M-RT-14: would require a routing request to populate; the Inspector shows scores on-demand
      source: 'pure_analysis' as const,
      generatedAt: clock.now(),
    };
  }

  /** Get the Capability/Route Graph view. Read-only. */
  async getCapabilityRouteGraph(): Promise<CapabilityRouteGraphView> {
    const { capabilityGraph, routeCompiler, clock } = this.inputs;

    const capabilities = capabilityGraph.all();
    const routeGraph = routeCompiler.rebuild(capabilityGraph, clock.now());

    return {
      capabilities: capabilities.map((c) => ({
        id: c.id,
        ownerId: c.ownerId,
        ownerType: c.ownerType,
        from: c.from,
        to: c.to,
        rail: c.rail,
        settlementNetwork: c.settlementNetwork,
        settlementMethod: c.settlementMethod,
        latencyMs: c.latencyMs,
        maxAmount: c.maxAmount,
        minAmount: c.minAmount,
        complianceRegion: c.complianceRegion,
        fxMode: c.fxMode,
        reserveRequired: c.reserveRequired,
        riskScore: c.riskScore,
        priority: c.priority,
        availability: c.availability,
        active: c.active,
        source: 'capability_graph_projection' as const,
      })),
      routes: routeGraph.routes.map((r) => ({
        id: r.id,
        from: r.from,
        to: r.to,
        hopCount: r.hopCount,
        isDirect: r.isDirect,
        ownerId: r.hops[0]?.ownerId ?? '',
        source: 'route_graph_compiled' as const,
      })),
      source: 'compiled_projections' as const,
      generatedAt: clock.now(),
    };
  }

  /** Get the full provenance chain for a recommendation. Read-only. */
  async getRecommendationProvenance(
    recommendationId: string,
    environment: Environment,
  ): Promise<RecommendationProvenance> {
    const { recLifecycle, clock } = this.inputs;

    // 1. Get the lifecycle state (rebuilt from events).
    const lifecycleState = await recLifecycle.getState(recommendationId, environment);

    // 2. Get the recommendation from the latest discovery run.
    const discoveryResult = await this.inputs.opportunityDiscovery.discover(environment);
    const recommendation = discoveryResult.recommendations.find((r) => r.id === recommendationId) ?? null;

    // 3. Build the provenance chain.
    const provenanceChain: { step: string; description: string; source: string; timestamp?: number }[] = [];

    if (recommendation) {
      provenanceChain.push({
        step: '1. Detected',
        description: `Analyzer "${recommendation.kind}" detected: ${recommendation.title}`,
        source: 'opportunity_discovery',
        timestamp: recommendation.generatedAt,
      });
      provenanceChain.push({
        step: '2. Evidence',
        description: recommendation.evidence.map((e) => `${e.source}: ${e.observation} (confidence: ${e.confidence})`).join('; '),
        source: 'opportunity_discovery_evidence',
      });
    }

    if (lifecycleState) {
      provenanceChain.push({
        step: '3. Lifecycle',
        description: `Current state: ${lifecycleState.currentState}. History: ${lifecycleState.history.length} transitions.`,
        source: 'recommendation_lifecycle_projection',
        timestamp: lifecycleState.lastTransitionAt,
      });

      if (lifecycleState.measurement) {
        provenanceChain.push({
          step: '4. Measured',
          description: `Actual: volume Δ${lifecycleState.measurement.actualVolumeDelta}, revenue Δ${lifecycleState.measurement.actualRevenueDelta}, cost Δ${lifecycleState.measurement.actualCostDeltaBps}bps`,
          source: 'recommendation_lifecycle_measurement',
        });
      }
    }

    return {
      recommendationId,
      analyzer: recommendation ? {
        kind: recommendation.kind,
        severity: recommendation.severity,
        title: recommendation.title,
        description: recommendation.description,
        confidence: recommendation.confidence,
        expectedValue: recommendation.expectedValue,
        evidence: recommendation.evidence,
        graphDiff: recommendation.graphDiff,
        implementationSteps: recommendation.implementationSteps,
        assumptions: recommendation.assumptions,
        generatedAt: recommendation.generatedAt,
        source: 'opportunity_discovery' as const,
      } : null,
      twinSimulation: null, // M-RT-14: would call the Digital Twin on-demand
      lifecycle: lifecycleState ? {
        currentState: lifecycleState.currentState,
        detectedAt: lifecycleState.detectedAt,
        lastTransitionAt: lifecycleState.lastTransitionAt,
        historyCount: lifecycleState.history.length,
        score: lifecycleState.score,
        measurement: lifecycleState.measurement,
        source: 'recommendation_lifecycle_projection' as const,
      } : null,
      provenanceChain,
    };
  }

  /** Get a high-level network overview. Read-only. */
  async getNetworkOverview(environment: Environment): Promise<NetworkOverview> {
    const { capabilityGraph, reserveLedger, reserveMarket, liquidityMarketplace, routeCompiler, opportunityDiscovery, recLifecycle, eventStore, clock } = this.inputs;

    const capabilities = capabilityGraph.all();
    const routeGraph = routeCompiler.rebuild(capabilityGraph, clock.now());
    const reserves = await reserveLedger.listReserves(environment);
    const marketSnapshots = await reserveMarket.getMarketSnapshotAll(environment);
    const book = await liquidityMarketplace.getOrderBook(environment);
    const lifecycleStates = await recLifecycle.listAll(environment);

    // Count payments in the event store.
    const allEvents = await eventStore.readAll(0, 10000);
    const paymentCount = allEvents.filter((e) => e.type === 'payment.completed').length;

    const averageUtilization = marketSnapshots.reserves.length > 0
      ? marketSnapshots.reserves.reduce((sum, r) => sum + r.utilization, 0) / marketSnapshots.reserves.length
      : 0;

    const criticalReserves = marketSnapshots.reserves.filter((r) => r.scarcity === 'CRITICAL').length;

    // Single-provider routes.
    const routeProviders = new Map<string, Set<string>>();
    for (const cap of capabilities) {
      const key = `${cap.from}→${cap.to}`;
      if (!routeProviders.has(key)) routeProviders.set(key, new Set());
      routeProviders.get(key)!.add(cap.ownerId);
    }
    const singleProviderRoutes = [...routeProviders.values()].filter((s) => s.size === 1).length;

    return {
      capabilities: capabilities.length,
      routes: routeGraph.routes.length,
      offers: book.offers.length,
      reserves: reserves.length,
      recommendations: lifecycleStates.length,
      payments: paymentCount,
      averageUtilization,
      criticalReserves,
      singleProviderRoutes,
      source: 'aggregated_projections' as const,
      generatedAt: clock.now(),
    };
  }
}
