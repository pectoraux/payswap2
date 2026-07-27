/**
 * RouteScoringEngine — pure deterministic route scoring. (M-RT-6.)
 *
 * Consumes: Route Graph + Reserve Market snapshot + Liquidity Marketplace
 * order book + Policy + Intent constraints.
 * Produces: ranked candidate routes with decomposed score components.
 *
 * Does NOT: reserve liquidity, lock reserves, create settlement plans, or
 * emit execution events. Those are compiler responsibilities.
 *
 * Scoring pipeline (every stage replayable):
 *   Intent → Candidate routes → Policy filter → Capability filter →
 *   Liquidity filter → Reserve-cost evaluation → Risk evaluation →
 *   Latency evaluation → Deterministic ranking
 *
 * Scoring is DECOMPOSED (not a single opaque score):
 *   Execution Cost + Reserve Cost + Liquidity Cost + FX Cost + Settlement Cost
 *   + Latency + Risk + Confidence + Policy Penalty → overall ranking
 */

import type { RouteGraph, Route, ScoredRoute, RoutingRequest, RoutingResult } from './types';
import type { RouteScoreComponents, ScoringWeights } from './types';
import { computeTotalScore, DEFAULT_SCORING_WEIGHTS } from './types';
import type { CapabilityGraph, LPCapability } from '../../graphs/capability/types';
import type { ReserveMarketSnapshot } from '../../engines/reserve-market-v2/types';
import type { Quote } from '../../engines/liquidity-marketplace/types';
import type { ReserveMarketEngine } from '../../engines/reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../../engines/liquidity-marketplace/service';
import type { Environment } from '../../types';
import type { RuntimeClock } from '../../clock';

/** The inputs to the scoring engine — all lower-layer projections. */
export interface ScoringInputs {
  routeGraph: RouteGraph;
  capabilityGraph: CapabilityGraph;
  reserveMarket: ReserveMarketEngine;
  liquidityMarketplace: LiquidityMarketplaceService;
  clock: RuntimeClock;
  weights?: ScoringWeights;
}

/** The pure scoring engine. */
export class RouteScoringEngine {
  constructor(private inputs: ScoringInputs) {}

  /** Rank routes for a request. Pure, deterministic. */
  async rank(request: RoutingRequest, environment: Environment): Promise<RoutingResult> {
    const { routeGraph, capabilityGraph, reserveMarket, liquidityMarketplace, clock } = this.inputs;
    const weights = this.inputs.weights ?? DEFAULT_SCORING_WEIGHTS;

    // 1. Get candidate routes from the Route Graph.
    const candidates = routeGraph.all(request.from, request.to);

    // 2. Evaluate each route.
    const scored: ScoredRoute[] = [];

    for (const route of candidates) {
      const scoredRoute = await this.evaluateRoute(route, request, environment, weights);
      scored.push(scoredRoute);
    }

    // 3. Split into eligible + rejected.
    const eligible = scored.filter((s) => s.eligible);
    const rejected = scored.filter((s) => !s.eligible);

    // 4. Deterministic ranking: sort by totalScore (lowest = best).
    eligible.sort((a, b) => a.totalScore - b.totalScore);

    const winner = eligible.length > 0 ? eligible[0] : null;

    return {
      request,
      ranked: eligible,
      rejected,
      winner,
      canRoute: winner !== null,
      generatedAt: clock.now(),
    };
  }

  /** Evaluate one route. Pure. */
  private async evaluateRoute(
    route: Route,
    request: RoutingRequest,
    environment: Environment,
    weights: ScoringWeights,
  ): Promise<ScoredRoute> {
    const { capabilityGraph, reserveMarket, liquidityMarketplace, clock } = this.inputs;

    // Get the first hop's capability (direct routes have 1 hop).
    const hop = route.hops[0];
    const capabilities = capabilityGraph.canMove(route.from, route.to);
    const capability = capabilities.find((c) => c.id === hop.capabilityId);

    if (!capability) {
      return this.rejected(route, 'Capability not found', weights);
    }

    // ── Policy filter ──
    // M-RT-6: simple policy check — capability must be active and within limits.
    if (!capability.active) {
      return this.rejected(route, 'Capability inactive', weights);
    }
    if (request.amount > capability.maxAmount || request.amount < capability.minAmount) {
      return this.rejected(route, `Amount ${request.amount} outside capability limits [${capability.minAmount}, ${capability.maxAmount}]`, weights);
    }

    // ── Liquidity filter ──
    // Check if the marketplace has a valid offer for this route.
    const quotes = await liquidityMarketplace.quote(
      { from: route.from, to: route.to, amount: request.amount, now: clock.now() },
      environment,
    );
    const matchingQuote = quotes.find((q) => q.lpId === hop.ownerId && q.status === 'valid');

    if (!matchingQuote) {
      return this.rejected(route, 'No valid liquidity offer', weights);
    }

    // ── Reserve-cost evaluation ──
    // Get the reserve market snapshot for the destination asset's reserve.
    // M-RT-6: look up by asset; in production, the compiler resolves the exact reserve.
    let reserveCostBps = 0;
    let reserveSnapshots: Awaited<ReturnType<ReserveMarketEngine['getMarketSnapshotAll']>> | null = null;
    try {
      reserveSnapshots = await reserveMarket.getMarketSnapshotAll(environment);
      const matchingReserve = reserveSnapshots.reserves.find((r) => r.asset === route.to || r.asset === capability.to);
      if (matchingReserve) {
        reserveCostBps = matchingReserve.shadowPriceBps;
      }
    } catch {
      // No reserves → no reserve cost.
    }

    // ── Decomposed score components ──
    const components: RouteScoreComponents = {
      executionCostBps: matchingQuote.feeBps,
      reserveCostBps,
      liquidityCostBps: matchingQuote.feeBps, // M-RT-6: same as execution for now; M-RT-8 separates.
      fxCostBps: route.from !== route.to ? 5 : 0, // M-RT-6: flat 5bps FX if crossing currencies.
      settlementCostBps: 2, // M-RT-6: flat 2bps settlement.
      latencyMs: matchingQuote.latencyMs,
      risk: matchingQuote.riskScore,
      confidence: capability.availability,
      policyPenalty: 0, // Passed policy.
    };

    const totalScore = computeTotalScore(components, weights);

    // ── Intent constraint check ──
    if (request.maxCostBps !== undefined) {
      const totalCost = components.executionCostBps + components.reserveCostBps + components.liquidityCostBps + components.fxCostBps + components.settlementCostBps;
      if (totalCost > request.maxCostBps) {
        return { route, components, totalScore, eligible: false, rejectionReason: `Total cost ${totalCost}bps exceeds max ${request.maxCostBps}bps` };
      }
    }
    if (request.maxLatencyMs !== undefined && components.latencyMs > request.maxLatencyMs) {
      return { route, components, totalScore, eligible: false, rejectionReason: `Latency ${components.latencyMs}ms exceeds max ${request.maxLatencyMs}ms` };
    }
    if (request.maxRisk !== undefined && components.risk > request.maxRisk) {
      return { route, components, totalScore, eligible: false, rejectionReason: `Risk ${components.risk} exceeds max ${request.maxRisk}` };
    }

    return { route, components, totalScore, eligible: true };
  }

  private rejected(route: Route, reason: string, weights: ScoringWeights): ScoredRoute {
    const components: RouteScoreComponents = {
      executionCostBps: 0,
      reserveCostBps: 0,
      liquidityCostBps: 0,
      fxCostBps: 0,
      settlementCostBps: 0,
      latencyMs: 0,
      risk: 1,
      confidence: 0,
      policyPenalty: 1,
    };
    return {
      route,
      components,
      totalScore: computeTotalScore(components, weights),
      eligible: false,
      rejectionReason: reason,
    };
  }
}
