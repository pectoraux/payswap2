/**
 * Continuous Economic Optimization Loop — the closed loop. (v1.5 §7AB–7AI.)
 *
 * TYPE-ONLY. No new primitives — this connects existing primitives into one
 * closed-loop self-improving system. The loop never stops and is independent
 * from payment execution.
 *
 *   Observe → Discover → Recommend → Simulate → Prioritize →
 *   Execute → Measure → Learn → Observe again
 *
 * Economic Intelligence has four permanent phases: Discover → Recommend →
 * Validate → Learn. The Compiler has dual modes (execution + optimization).
 * Recommendation confidence is adaptive. Runtime Memory has three tiers.
 */

import type { RecommendationKind, ImpactMeasurement } from '../engines/legacy-engine-types';
import type { ExecutionPlan } from '../compiler/types';
import type { GraphTransformationRecommendation } from '../integration/types';

// ─── §7AB: The Continuous Economic Optimization Loop ────────────────────────

/** The eight phases of the Continuous Economic Optimization Loop. */
export type OptimizationLoopPhase =
  | 'observe'
  | 'discover'
  | 'recommend'
  | 'simulate'
  | 'prioritize'
  | 'execute'
  | 'measure'
  | 'learn';

/** The canonical loop order (learn feeds back into observe — closed loop). */
export const OPTIMIZATION_LOOP_ORDER: readonly OptimizationLoopPhase[] = [
  'observe',
  'discover',
  'recommend',
  'simulate',
  'prioritize',
  'execute',
  'measure',
  'learn',
] as const;

/** One tick of the optimization loop — a snapshot of what happened in each phase. */
export interface OptimizationLoopTick {
  tickId: string;
  startedAt: number;             // Runtime Clock
  finishedAt?: number;
  phaseResults: Partial<Record<OptimizationLoopPhase, {
    itemsProcessed: number;
    durationMs: number;
    summary: string;
  }>>;
  /** Recommendations surfaced this tick (passed simulation gate). */
  recommendationsSurfaced: number;
  /** Recommendations suppressed this tick (failed simulation gate). */
  recommendationsSuppressed: number;
  /** Confidence adjustments applied this tick. */
  confidenceAdjustments: number;
}

// ─── §7AC: Economic Intelligence Closed-Loop Phases ─────────────────────────

/** The four permanent phases of Economic Intelligence. */
export type EconomicIntelligencePhase =
  | 'discover'
  | 'recommend'
  | 'validate'
  | 'learn';

/** The Validate phase runs four validators on each Recommendation. */
export type RecommendationValidator =
  | 'digital_twin'        // §7Z counterfactual simulation
  | 'counterfactual'      // §7N Current vs Alternative Network
  | 'economic_score'      // §7M corridor scoring
  | 'compiler';           // §7AD Optimization Compilation

export interface ValidationResult {
  recommendationId: string;
  validator: RecommendationValidator;
  passed: boolean;
  reason: string;
  /** The four validators must all pass for the Recommendation to surface. */
  allValidatorsPassed: boolean;
}

// ─── §7AD: Compiler Dual Modes ──────────────────────────────────────────────

/** The Financial Compiler has two modes — same compiler, different intent. */
export type CompilerMode = 'execution' | 'optimization';

/** Selects the compiler mode. */
export interface CompilerModeSelector {
  /** Compile a payment Intent → immediate Execution Plan (executes now). */
  compileExecution(intent: unknown, ctx: unknown): Promise<ExecutionPlan>;
  /** Compile a Recommendation → Optimization Plan (validated, not executed). */
  compileOptimization(rec: GraphTransformationRecommendation, ctx: unknown): Promise<OptimizationPlan>;
}

/** An Optimization Plan — what the network would look like if the rec were implemented. */
export interface OptimizationPlan {
  recommendationId: string;
  /** Sample payments re-compiled under the new graph (post-Graph-Diff). */
  compiledExecutionPlans: ExecutionPlan[];
  /** Estimated network impact if the Recommendation is implemented. */
  estimatedNetworkImpact: { dimension: string; delta: number }[];
  /** Did all four validators pass? */
  passedValidation: boolean;
  compiledAt: number;
}

// ─── §7AE: Adaptive Recommendation Confidence ───────────────────────────────

/**
 * Confidence feedback — recorded after a Recommendation is implemented +
 * measured. Confidence is dynamic: increases when predictions match reality,
 * decreases when they diverge. No ML — just a pure function of
 * prediction-vs-reality.
 */
export interface ConfidenceFeedback {
  recommendationId: string;
  recommendationType: RecommendationKind;
  /** What the Recommendation predicted would happen. */
  predicted: { dimension: string; delta: number }[];
  /** What actually happened. */
  actual: ImpactMeasurement;
  /** The confidence delta applied (+ if matched, − if diverged). */
  confidenceDelta: number;
  /** The new confidence for this recommendation type (0..1), stored in Learning Memory. */
  newTypeConfidence: number;
  ts: number;
}

// ─── §7AF: Runtime Memory Hierarchy (three tiers) ───────────────────────────

/** Runtime Memory is organized into three tiers — all inside the existing primitive. */
export type RuntimeMemoryTier = 'operational' | 'economic' | 'learning';

/**
 * Tier descriptions:
 * - operational: previous executions (latency, cost, success/failure per corridor/LP/reserve/connector)
 * - economic: network observations (Friday payroll demand, LP congestion windows, FX widening, reserve depletion cycles, connector instability)
 * - learning: recommendation outcomes (predicted vs actual, confidence deltas per type)
 */
export interface TieredRuntimeMemory {
  recall(query: { subject?: string; kind?: string; tier?: RuntimeMemoryTier }): Promise<unknown[]>;
  /** Write a fact to a specific tier. */
  recordTo(tier: RuntimeMemoryTier, fact: unknown): Promise<void>;
  /** Read the current confidence for a recommendation type (from Learning tier). */
  typeConfidence(kind: RecommendationKind): number;
}

// ─── §7AI: The North-Star Objective ─────────────────────────────────────────

/** The north-star objective of the Runtime. (Stated, not computed.) */
export const NORTH_STAR_OBJECTIVE =
  'The Runtime exists to maximize the long-term health of the financial network while optimizing every individual financial intent.';
