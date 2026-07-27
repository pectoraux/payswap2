/**
 * Liquidity Composer — Types. (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * The Liquidity Composer models liquidity as a directed graph:
 *   - Nodes are currencies (USD, KES, GHS, EUR, …)
 *   - Edges are liquidity offers (LP1 converts USD→KES at 100bps, capacity 50k)
 *
 * A Path is a sequence of edges from source to destination:
 *   USD →(LP1)→ EUR →(LP4)→ KES   (2-hop path)
 *
 * Multi-hop composition discovers paths with >1 edge when no direct corridor
 * exists. The Split Optimizer can execute across multiple paths simultaneously
 * (70% via LP2, 30% via LP5) when it lowers cost or increases resilience.
 *
 * The composer sits BETWEEN the Financial Compiler and the ExecutionPlan:
 *   FinancialCompiler → LiquidityComposer → CandidateExecutionPlans → choose best
 *
 * The compiler's API is UNCHANGED — the composer is additive. The compiler
 * can call `composer.compose(request)` to get candidate plans, then select
 * the winner using its existing scoring logic.
 */

// ─── Graph ──────────────────────────────────────────────────────────────────

/** A currency node in the liquidity graph (e.g., "USD", "KES", "GHS"). */
export interface GraphNode {
  /** Currency code (ISO 4217 or custom stablecoin code). */
  currency: string;
  /** Human-readable label (e.g., "US Dollar", "Kenyan Shilling"). */
  label: string;
}

/** The kind of liquidity an edge represents. */
export type EdgeKind = 'convert' | 'bridge' | 'settle';

/**
 * A directed edge in the liquidity graph — one LP's offer to convert
 * `from` currency into `to` currency.
 *
 * Carries the full cost decomposition so the optimizer can score paths
 * without re-deriving costs. This reuses the existing cost decomposition
 * pattern (fxCost + lpFee + reserve opp cost + latency + risk + failure prob).
 */
export interface LiquidityEdge {
  /** Unique edge ID (e.g., "edge_lp1_usd_kes"). */
  id: string;
  /** Source currency. */
  from: string;
  /** Destination currency. */
  to: string;
  /** Edge kind: convert (LP), bridge (reserve-backed), settle (final leg). */
  kind: EdgeKind;
  /** The LP providing this liquidity (null for reserve-backed bridges). */
  lpId: string | null;
  /** Maximum amount this edge can handle in a single execution. */
  capacity: number;
  /** FX cost in basis points (the conversion spread). */
  fxBps: number;
  /** LP fee in basis points (the service charge). */
  feeBps: number;
  /** Reserve opportunity cost in basis points (capital tied up). */
  reserveOppCostBps: number;
  /** Settlement latency in milliseconds. */
  latencyMs: number;
  /** Risk score [0, 1] (counterparty + settlement risk). */
  riskScore: number;
  /** Probability of failure [0, 1] (historical failure rate). */
  failureProb: number;
}

/** The liquidity graph: a set of currency nodes + directed edges. */
export interface LiquidityGraph {
  nodes: Map<string, GraphNode>;
  /** Adjacency list: currency → outgoing edges. */
  adjacency: Map<string, LiquidityEdge[]>;
}

// ─── Path ───────────────────────────────────────────────────────────────────

/**
 * A path through the liquidity graph — an ordered sequence of edges from
 * source to destination.
 *
 * Paths are IMMUTABLE once computed. Their cost/latency/risk/capacity are
 * derived (pure functions of the edges). Deterministic ordering is enforced
 * by the pathfinder (sorted by edge IDs).
 */
export interface LiquidityPath {
  /** Unique path ID (deterministic hash of edge IDs). */
  id: string;
  /** Source currency. */
  from: string;
  /** Destination currency. */
  to: string;
  /** Ordered edges (from → … → to). */
  edges: LiquidityEdge[];
  /** Number of hops (edges.length). */
  hops: number;
  /** Bottleneck capacity (min of edge capacities). */
  minCapacity: number;
  /** Total cost in basis points (compounded FX + sum of fees). */
  totalCostBps: number;
  /** Total latency in ms (sum of edge latencies). */
  totalLatencyMs: number;
  /** Compounded risk score [0, 1]. */
  compoundedRisk: number;
  /** Probability of failure [0, 1] (1 - product of (1 - edge.failureProb)). */
  failureProb: number;
}

// ─── Cost Model ─────────────────────────────────────────────────────────────

/**
 * The cost of a path, decomposed into its components.
 *
 * This is the SAME decomposition the existing Financial Compiler uses —
 * the composer reuses it rather than inventing a second cost model.
 */
export interface CostDecomposition {
  /** FX cost (compounded across hops). */
  fxBps: number;
  /** LP fees (summed across hops). */
  feeBps: number;
  /** Reserve opportunity cost (summed). */
  reserveOppCostBps: number;
  /** Latency penalty (converted to bps: latencyMs * LATENCY_COST_PER_MS). */
  latencyBps: number;
  /** Risk penalty (riskScore * RISK_COST_MULTIPLIER). */
  riskBps: number;
  /** Total cost (sum of all components). */
  totalBps: number;
}

/** Weights for scoring paths (higher = more important). */
export interface ScoringWeights {
  costWeight: number;
  latencyWeight: number;
  riskWeight: number;
  reliabilityWeight: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  costWeight: 0.4,
  latencyWeight: 0.2,
  riskWeight: 0.2,
  reliabilityWeight: 0.2,
};

// ─── Split Optimizer ────────────────────────────────────────────────────────

/**
 * One allocation in a split plan — a path + the amount to send via it.
 */
export interface PathAllocation {
  path: LiquidityPath;
  /** Amount to send via this path. */
  amount: number;
  /** Percentage of the total request [0, 100]. */
  percentage: number;
}

/**
 * A split plan — the optimizer's recommendation for how to execute a
 * request across one or more paths.
 *
 * If `allocations.length === 1`, it's a single-path plan (the common case).
 * If `allocations.length > 1`, it's a split plan (executed in parallel).
 */
export interface SplitPlan {
  /** The original request. */
  request: CompositionRequest;
  /** Allocations across paths (sorted by amount descending). */
  allocations: PathAllocation[];
  /** Total cost across all allocations (weighted by percentage). */
  totalCostBps: number;
  /** Total failure probability (1 - product of (1 - alloc.failureProb)). */
  totalFailureProb: number;
  /** Why the optimizer chose this plan (human-readable). */
  rationale: string;
  /** Whether this is a split plan (allocations.length > 1). */
  isSplit: boolean;
}

// ─── Execution Plan ─────────────────────────────────────────────────────────

/**
 * One leg of an execution plan — a single hop from one currency to another
 * via one LP, for a specific amount.
 *
 * Multi-hop paths produce multiple sequential legs.
 * Split plans produce parallel legs (with `splitGroup` linking them).
 */
export interface ExecutionLeg {
  /** Leg index (0-based, sequential within a path). */
  hopIndex: number;
  /** Source currency. */
  from: string;
  /** Destination currency. */
  to: string;
  /** LP providing this leg's liquidity. */
  lpId: string | null;
  /** Amount to send via this leg. */
  amount: number;
  /** Cost of this leg in bps. */
  costBps: number;
  /** Latency of this leg in ms. */
  latencyMs: number;
  /** Split group ID (legs in the same split group execute in parallel). */
  splitGroup?: string;
  /** Percentage of the total request this leg carries [0, 100]. */
  percentage?: number;
}

/**
 * A composed execution plan — the output of the LiquidityComposer.
 *
 * Contains:
 *   - The chosen split plan (which paths, what amounts)
 *   - The flattened execution legs (sequential + parallel)
 *   - The full cost decomposition
 *   - All candidate paths (for the inspector: chosen + alternatives + rejected)
 */
export interface ComposedExecutionPlan {
  /** The original request. */
  request: CompositionRequest;
  /** The chosen split plan. */
  plan: SplitPlan;
  /** Flattened execution legs (sequential within a path, parallel across splits). */
  legs: ExecutionLeg[];
  /** Full cost decomposition. */
  cost: CostDecomposition;
  /** All candidate paths discovered (for the inspector). */
  candidates: LiquidityPath[];
  /** Paths that were considered but not chosen (for the inspector). */
  alternatives: LiquidityPath[];
  /** Total hops in the longest path (for the inspector). */
  maxHops: number;
  /** Whether this is a multi-hop plan (any allocation has hops > 1). */
  isMultiHop: boolean;
  /** Whether this is a split plan (allocations.length > 1). */
  isSplit: boolean;
}

// ─── Request ────────────────────────────────────────────────────────────────

/** A request to compose liquidity from one currency to another. */
export interface CompositionRequest {
  /** Source currency. */
  from: string;
  /** Destination currency. */
  to: string;
  /** Amount in source currency. */
  amount: number;
  /** Maximum hops allowed (default 4). */
  maxHops?: number;
  /** Whether to allow split routing (default true). */
  allowSplit?: boolean;
  /** Scoring weights (defaults to DEFAULT_SCORING_WEIGHTS). */
  weights?: ScoringWeights;
}

// ─── Composer Options ───────────────────────────────────────────────────────

/** Configuration for the LiquidityComposer. */
export interface ComposerOptions {
  /** Default max hops (default 4). */
  defaultMaxHops?: number;
  /** Default allow-split (default true). */
  defaultAllowSplit?: boolean;
  /** Cost of latency in bps per ms (default 0.01 bps/ms = 10 bps/sec). */
  latencyCostPerMs?: number;
  /** Risk cost multiplier (default 100 bps per unit of risk). */
  riskCostMultiplier?: number;
  /** Minimum split benefit (bps) required to justify splitting (default 5 bps). */
  minSplitBenefitBps?: number;
}
