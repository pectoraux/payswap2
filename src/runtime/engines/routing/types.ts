/**
 * Route Graph + Reserve-Aware Routing — compiled projection + pure scoring.
 * (M-RT-6.)
 *
 * DISCIPLINE:
 *   - Route Graph = compiled projection (derived from Capability Graph +
 *     Liquidity Marketplace + Policy Constraints). Always rebuildable. Never
 *     an authoritative store. Does NOT "know" economics — it represents
 *     connectivity only.
 *   - Route Scoring = pure deterministic function consuming Route Graph +
 *     Reserve Market snapshot + Liquidity Marketplace order book + Policy +
 *     Intent constraints. Produces ranked candidate routes. Does NOT reserve
 *     liquidity, lock reserves, create settlement plans, or emit execution
 *     events — those are compiler responsibilities.
 *
 * DEPENDENCY DIRECTION (one-way, no cycles):
 *   Capability Graph + Liquidity Marketplace + Reserve Market + Policy
 *       ↓ (reads only)
 *   Route Compiler → Route Graph (derived connectivity)
 *       ↓ (reads only)
 *   Route Scoring Engine → Ranked Routes (derived economics)
 *       ↓ (reads only)
 *   Financial Compiler (M-RT-7)
 *
 * SCORING IS DECOMPOSED (not a single opaque score):
 *   Execution Cost + Reserve Cost + Liquidity Cost + FX Cost + Settlement Cost
 *   + Latency + Risk + Confidence + Policy Penalty → overall ranking
 */

import type { LPCapability } from '../../graphs/capability/types';
import type { ReserveMarketSnapshot } from '../../engines/reserve-market-v2/types';
import type { Quote, ClearingResult } from '../../engines/liquidity-marketplace/types';

// ─── Route Graph (compiled projection — connectivity only) ──────────────────

/** One hop in a route. */
export interface RouteHop {
  ownerId: string;
  ownerType: string;
  capabilityId: string;
  from: string;
  to: string;
}

/** A route — direct (1 hop) or multi-hop (N hops). Compiled from capabilities. */
export interface Route {
  id: string;
  from: string;
  to: string;
  hops: RouteHop[];
  isDirect: boolean;
  isMultiHop: boolean;
  hopCount: number;
  generatedFrom: string[];   // capability ids
  active: boolean;
}

/** The Route Graph — connectivity only. No economics. */
export interface RouteGraph {
  /** All active routes. */
  routes: Route[];
  /** Direct routes from→to. */
  direct(from: string, to: string): Route[];
  /** All routes (direct + multi-hop) from→to. */
  all(from: string, to: string): Route[];
}

// ─── Route Scoring (pure, decomposed) ───────────────────────────────────────

/** The decomposed score components — each visible for Inspector explanations. */
export interface RouteScoreComponents {
  /** LP fee (from the liquidity marketplace offer's pricing curve). */
  executionCostBps: number;
  /** Reserve shadow price × amount (from the Reserve Market). */
  reserveCostBps: number;
  /** Liquidity clearing fee (from the Liquidity Marketplace). */
  liquidityCostBps: number;
  /** FX conversion cost (if the route crosses currencies). */
  fxCostBps: number;
  /** Settlement operational cost (connector fees, etc.). */
  settlementCostBps: number;
  /** Total latency across all hops (ms). */
  latencyMs: number;
  /** Compounded risk across all hops (0..1, lower = safer). */
  risk: number;
  /** Confidence in the route (0..1, based on availability + history). */
  confidence: number;
  /** Policy penalty (0 = passes; >0 = penalized or blocked). */
  policyPenalty: number;
}

/** A scored route — a route + its decomposed score components + the total. */
export interface ScoredRoute {
  route: Route;
  components: RouteScoreComponents;
  /** Weighted total score (lower = better). Computed from components. */
  totalScore: number;
  /** Whether this route passed all filters (policy, capability, liquidity). */
  eligible: boolean;
  /** If ineligible, why. */
  rejectionReason?: string;
}

/** A request for ranked routes. */
export interface RoutingRequest {
  from: string;
  to: string;
  amount: number;
  /** Optional constraints from the Intent. */
  maxCostBps?: number;
  maxLatencyMs?: number;
  maxRisk?: number;
  /** The Runtime Clock time. */
  now: number;
}

/** The routing result — ranked candidate routes. */
export interface RoutingResult {
  request: RoutingRequest;
  /** Eligible routes, sorted by totalScore (lowest = best). Deterministic. */
  ranked: ScoredRoute[];
  /** Rejected routes + reasons. */
  rejected: ScoredRoute[];
  /** The best route (lowest totalScore among eligible). */
  winner: ScoredRoute | null;
  /** Whether any route can satisfy the request. */
  canRoute: boolean;
  generatedAt: number;
}

/** Scoring weights — how components combine into the total score. */
export interface ScoringWeights {
  executionCost: number;
  reserveCost: number;
  liquidityCost: number;
  fxCost: number;
  settlementCost: number;
  latency: number;       // per ms
  risk: number;          // per 0..1
  confidencePenalty: number;  // per (1 - confidence)
  policyPenalty: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  executionCost: 1.0,
  reserveCost: 1.0,
  liquidityCost: 1.0,
  fxCost: 1.0,
  settlementCost: 1.0,
  latency: 0.001,        // 1ms = 0.001 score points
  risk: 100,             // 0.1 risk = 10 score points
  confidencePenalty: 50, // 0.5 confidence = 25 penalty
  policyPenalty: 1000,   // any policy penalty is heavily weighted
};

// ─── Invariants ─────────────────────────────────────────────────────────────

/** Validate a route. Returns violations (empty = valid). */
export function validateRoute(route: Route): string[] {
  const violations: string[] = [];
  if (route.hops.length === 0) violations.push('Route must have ≥ 1 hop');
  if (route.hops.length > 10) violations.push('Route must have ≤ 10 hops');

  // Check connectivity: each hop's `to` must match the next hop's `from`.
  for (let i = 0; i < route.hops.length - 1; i++) {
    if (route.hops[i].to !== route.hops[i + 1].from) {
      violations.push(`Disconnected path: hop ${i} ends at ${route.hops[i].to} but hop ${i + 1} starts at ${route.hops[i + 1].from}`);
    }
  }

  // Check start/end match the route's from/to.
  if (route.hops[0].from !== route.from) {
    violations.push(`Route from (${route.from}) does not match first hop from (${route.hops[0].from})`);
  }
  if (route.hops[route.hops.length - 1].to !== route.to) {
    violations.push(`Route to (${route.to}) does not match last hop to (${route.hops[route.hops.length - 1].to})`);
  }

  // Check for cycles (simple: no repeated capability IDs).
  const capIds = route.hops.map((h) => h.capabilityId);
  const unique = new Set(capIds);
  if (unique.size !== capIds.length) {
    violations.push('Cycle detected: a capability appears more than once');
  }

  return violations;
}

/** Compute the total score from components + weights. Pure. */
export function computeTotalScore(components: RouteScoreComponents, weights: ScoringWeights): number {
  return (
    components.executionCostBps * weights.executionCost +
    components.reserveCostBps * weights.reserveCost +
    components.liquidityCostBps * weights.liquidityCost +
    components.fxCostBps * weights.fxCost +
    components.settlementCostBps * weights.settlementCost +
    components.latencyMs * weights.latency +
    components.risk * weights.risk +
    (1 - components.confidence) * weights.confidencePenalty +
    components.policyPenalty * weights.policyPenalty
  );
}
