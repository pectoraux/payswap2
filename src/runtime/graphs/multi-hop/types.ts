/**
 * Multi-hop Liquidity Composition — DESIGN ONLY (Amendment 2 §7F).
 *
 * A payment route may compose across multiple LPs and reserve pools:
 *   Buyer → LP A (GHS→Twin GHS) → LP B (Twin GHS→Twin XOF) → LP C (Twin XOF→XOF) → Merchant
 *
 * The architecture supports this; implementation is deferred to M-RT-14.
 * M-RT-1 ships only the types so later milestones can build against them.
 * No code path exists for multi-hop execution yet.
 */

/** One hop in a composite route. */
export interface CompositeHop {
  index: number;            // 0-based
  lpId: string;
  from: string;             // currency or twin-currency id
  to: string;
  amount: number;
  feeBps: number;
  reserveConsumed: { reserveId: string; amount: number; shadowPriceBps: number };
  latencyMs: number;
  reliability: number;      // 0..1
}

/** A composite route — direct (1 hop) or multi-hop (N hops). */
export interface CompositeRoute {
  id: string;
  hops: CompositeHop[];
  isMultiHop: boolean;      // hops.length > 1
  totalCostBps: number;     // sum of hop fees
  totalCapitalCostBps: number;  // sum of (amount * shadowPriceBps)
  totalLatencyMs: number;
  compoundedReliability: number;  // product of hop reliabilities
  weightedScore: number;    // per the 9+ dimension objective
  /** Why this route was chosen (or rejected) — feeds the Decision + Inspector. */
  rationale: string;
}

/** The result of evaluating direct vs multi-hop routes for a payment. */
export interface RouteEvaluation {
  paymentId: string;
  direct: CompositeRoute[];
  multiHop: CompositeRoute[];
  chosen: CompositeRoute;
  rejected: { route: CompositeRoute; reason: string }[];
  /** The missing bridges that, if built, would unlock more composite routes. */
  missingBridesNeeded: string[];
}

/**
 * The Multi-hop Router contract — NOT implemented in M-RT-1. M-RT-14
 * provides the real implementation (path search over the Liquidity Graph
 * scored by the 9+ dimension objective).
 */
export interface MultiHopRouter {
  /** Evaluate direct vs multi-hop routes for a payment. */
  evaluate(req: RouteEvaluationRequest): Promise<RouteEvaluation>;
}

export interface RouteEvaluationRequest {
  paymentId: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  /** Max hops allowed (default 3). */
  maxHops?: number;
  /** Constraints from the Intent. */
  maxCostBps?: number;
  maxLatencyMs?: number;
  minReliability?: number;
}

/**
 * NoOpMultiHopRouter — the M-RT-1 placeholder. Always returns an empty
 * evaluation (no multi-hop). M-RT-14 replaces this with the real router.
 * Until then, routing is single-hop direct.
 */
export class NoOpMultiHopRouter implements MultiHopRouter {
  async evaluate(): Promise<RouteEvaluation> {
    return {
      paymentId: '',
      direct: [],
      multiHop: [],
      chosen: { id: '', hops: [], isMultiHop: false, totalCostBps: 0, totalCapitalCostBps: 0, totalLatencyMs: 0, compoundedReliability: 1, weightedScore: 0, rationale: 'M-RT-1: multi-hop not implemented' },
      rejected: [],
      missingBridesNeeded: [],
    };
  }
}
