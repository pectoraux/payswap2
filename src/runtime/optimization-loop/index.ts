/**
 * Optimization Loop barrel — type-only exports for the v1.5 closed-loop
 * tightening. No new primitives; connects existing primitives into one
 * self-improving feedback system.
 */

export type {
  OptimizationLoopPhase,
  OptimizationLoopTick,
  EconomicIntelligencePhase,
  RecommendationValidator,
  ValidationResult,
  CompilerMode,
  CompilerModeSelector,
  OptimizationPlan,
  ConfidenceFeedback,
  RuntimeMemoryTier,
  TieredRuntimeMemory,
} from './types';
export { OPTIMIZATION_LOOP_ORDER, NORTH_STAR_OBJECTIVE } from './types';
