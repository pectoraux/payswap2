/**
 * Integration Pass types — compressing peer concepts under existing primitives.
 * (Integration Pass §2-§14.)
 *
 * These are TYPE-ONLY additions to the M-RT-1 skeleton. No business logic.
 * They express the integration-pass concepts (reserve-aware routing as a
 * compiler pass, route synthesis, graph-transformation recommendations,
 * missed-opportunity detection, recommendation simulation gate, optimization
 * explanation) so later milestones can build against them.
 */

import type { Recommendation, RecommendationKind, RecommendationAudience } from '../engines/legacy-engine-types';
import type { Counterfactual } from '../engines/counterfactual/types';
import type { LPCapability } from '../graphs/capability/types';
import type { GraphProjection } from '../graphs/knowledge-graph/types';
import type { CompilationPassResult } from '../compiler/types';

// ─── §7U: Reserve-Aware Routing as a Compiler Pass ──────────────────────────

/** Full cost decomposition exposed by the reserve_aware_routing compiler pass. */
export interface CostDecomposition {
  executionCostBps: number;
  capitalCostBps: number;
  reserveCostBps: number;       // sum of (amount × shadowPriceBps)
  liquidityCostBps: number;
  riskCostBps: number;
  settlementDelayCostBps: number;
  fxCostBps: number;
  totalBps: number;
}

/** The result of the reserve_aware_routing compiler pass. */
export interface ReserveAwareRoutingPassResult extends CompilationPassResult {
  pass: 'reserve_aware_routing';
  reservesConsidered: { reserveId: string; shadowPriceBps: number; utilization: number }[];
  reservesRejected: { reserveId: string; reason: string }[];
  costDecomposition: CostDecomposition;
  exhaustionForecast?: { reserveId: string; forecastDepletionMs: number }[];
}

// ─── §7V: Route Synthesis ───────────────────────────────────────────────────

/** A route synthesized by the compiler from capabilities (direct or multi-hop). */
export interface SynthesizedRoute {
  id: string;
  hops: { lpId: string; capabilityId: string; from: string; to: string }[];
  isMultiHop: boolean;
  generatedFromCapabilities: string[];
  estimatedTotalCostBps: number;
  estimatedTotalLatencyMs: number;
  compoundedReliability: number;
}

/** The result of route synthesis between two endpoints. */
export interface RouteSynthesisResult {
  from: string;
  to: string;
  synthesizedRoutes: SynthesizedRoute[];
  /** Capabilities that, if added, would unlock more synthesized routes. */
  missingCapabilitiesForSynthesis: LPCapability[];
}

// ─── §7X: Recommendations as Graph Transformations ──────────────────────────

/** A proposed change to the Financial Knowledge Graph. */
export interface GraphDiff {
  addNodes: { id: string; type: string; projection: GraphProjection }[];
  removeNodes: { id: string; projection: GraphProjection }[];
  addEdges: { from: string; to: string; relationship: string }[];
  removeEdges: { from: string; to: string; relationship: string }[];
}

/** One step in implementing a graph transformation. */
export interface ImplementationStep {
  action: string;          // "publish capability Twin GHS→Twin XOF"
  actor: RecommendationAudience;
  estimatedEffort: 'low' | 'medium' | 'high';
  dependsOn?: string[];    // other step ids
}

/**
 * A Recommendation that proposes a transformation of the Financial Network.
 * Carries a Graph Diff + economic justification + expected value + simulation
 * + implementation plan. Only surfaces if it passes the simulation threshold.
 */
export interface GraphTransformationRecommendation extends Recommendation {
  graphDiff: GraphDiff;
  economicJustification: string;
  expectedValue: { dimension: string; delta: number }[];
  simulation: Counterfactual;
  implementationPlan: ImplementationStep[];
  passedSimulationThreshold: boolean;
}

// ─── §7Y: Missed Opportunity Detection ──────────────────────────────────────

/** "What almost happened?" — detected during compilation or execution. */
export interface MissedOpportunity {
  id: string;
  detectedAt: number;
  /** The execution that almost had a better/different outcome. */
  executionId?: string;
  /** What almost happened. */
  kind: RecommendationKind;
  description: string;
  /** What prevented the better outcome. */
  preventedBy: string;
  /** The opportunity it becomes (if actionable). */
  recommendationId?: string;
}

// ─── §7Z: Digital Twin as Recommendation Testing Ground ─────────────────────

/** Thresholds a Recommendation must pass to surface to actors. */
export interface SimulationThreshold {
  minExpectedRevenueDelta: number;
  minExpectedVolumeDelta: number;
  minConfidence: number;
  maxCapitalRequired?: number;
}

/** The result of auto-simulating a Recommendation. */
export interface RecommendationSimulationResult {
  recommendationId: string;
  counterfactual: Counterfactual;
  passed: boolean;
  reasonsForRejection?: string[];   // if !passed
}

/** The simulation gate every Recommendation passes through. */
export interface RecommendationSimulationGate {
  simulate(rec: GraphTransformationRecommendation): Promise<RecommendationSimulationResult>;
  thresholds: SimulationThreshold;
}

// ─── §7AA: Optimization Explanation (Inspector) ─────────────────────────────

/** Why the compiler chose what it chose — rendered by the Inspector. */
export interface OptimizationExplanation {
  chosenLP: { lpId: string; reason: string };
  rejectedLPs: { lpId: string; reason: string }[];
  chosenReserve: { reserveId: string; reason: string };
  rejectedReserves: { reserveId: string; reason: string }[];
  chosenRoute: { routeId: string; reason: string };
  rejectedRoutes: { routeId: string; reason: string }[];
  missedOpportunities: MissedOpportunity[];
  /** "How would this look if rec #184 were implemented?" */
  counterfactualProjections: { recommendationId: string; counterfactual: Counterfactual }[];
}

// ─── §7T: Economic Intelligence Subsystem Marker ────────────────────────────

/**
 * Marker type identifying the Economic Intelligence subsystems. Economic
 * Intelligence owns continuous optimization; Liquidity Intelligence, Treasury
 * Intelligence, Reserve Intelligence, Opportunity Discovery, LP/Treasury
 * Growth, Economic Health, Counterfactual, and the Recommendation Engine are
 * all subsystems WITHIN it (not sibling runtimes).
 */
export type EconomicIntelligenceSubsystem =
  | 'liquidity_intelligence'
  | 'treasury_intelligence'
  | 'reserve_intelligence'
  | 'opportunity_discovery'
  | 'lp_growth'
  | 'treasury_growth'
  | 'economic_health'
  | 'counterfactual_analysis'
  | 'recommendation_engine';

/** Tag interface: marks a class as an Economic Intelligence subsystem plugin. */
export interface EconomicIntelligencePlugin {
  readonly subsystem: EconomicIntelligenceSubsystem;
}
