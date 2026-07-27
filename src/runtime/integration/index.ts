/**
 * Integration Pass barrel — type-only exports for the integration concepts.
 * (Integration Pass §2-§14.)
 *
 * No business logic. These types express how peer concepts compress under the
 * existing 18 permanent primitives (Compiler passes, Knowledge Graph
 * projections, Economic Intelligence plugins, Recommendation transformations).
 */

export type {
  // §7U Reserve-aware routing as a compiler pass:
  CostDecomposition,
  ReserveAwareRoutingPassResult,
  // §7V Route synthesis:
  SynthesizedRoute,
  RouteSynthesisResult,
  // §7X Recommendations as graph transformations:
  GraphDiff,
  ImplementationStep,
  GraphTransformationRecommendation,
  // §7Y Missed opportunity detection:
  MissedOpportunity,
  // §7Z Digital Twin as recommendation testing ground:
  SimulationThreshold,
  RecommendationSimulationResult,
  RecommendationSimulationGate,
  // §7AA Inspector optimization explanation:
  OptimizationExplanation,
  // §7T Economic Intelligence subsystem marker:
  EconomicIntelligenceSubsystem,
  EconomicIntelligencePlugin,
} from './types';
