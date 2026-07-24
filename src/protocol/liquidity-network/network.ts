/**
 * Liquidity Network — high-level facade tying all subsystems together.
 *
 * This is the public entry point for the routing service. It exposes:
 *  - `registerLP(params)` — register an LP across all subsystems.
 *  - `getQuote(corridor, amount)` — the main entry point: returns the best
 *    RoutingPlan (single-LP or split).
 *  - `executeRoute(plan, reservationId?)` — reserve capacity across all LPs in
 *    the plan. Returns the reservations.
 *  - `settleRoute(plan, reservationId, outcomes)` — mark LP outcomes
 *    (success/failure per LP), update scoring + health, release/consume
 *    capacity.
 *  - `networkStatus()` — aggregate health of the whole network.
 *
 * The facade is the SINGLE place where the subsystems are coordinated —
 * capacity.ts, pricing.ts, routing.ts, scoring.ts, health.ts, forecast.ts
 * each own their own state, and the facade orchestrates them.
 */
import { eventEngine } from '@/kernel/event';
import {
  corridorKey,
  type CapacityQuote,
  type Corridor,
  type ForecastPoint,
  type LPHealth,
  type LPId,
  type LPRecord,
  type LPScore,
  type RoutingPlan,
} from './types';
import { liquidityRegistry, type RegisterLPParams } from './registry';
import {
  consumeCapacity,
  releaseAllForLp,
  releaseCapacity,
  replenishCapacity,
  reserveCapacity,
  capacityReservations,
  type Reservation,
  type ReservationResult,
} from './capacity';
import { compete, getMarketSpread, quoteCapacity, quotePrice, type MarketSpread, type PriceQuote, type CompeteBid } from './pricing';
import { findBestRoute, optimizePlan, type RoutingOpts } from './routing';
import { rankLPs, scoreLP, setWeights as applyScoreWeights, updateReputationFromOutcome, type ScoreWeights } from './scoring';
import { lpHealthMonitor } from './health';
import { liquidityForecaster } from './forecast';

/** Outcome for one LP in a route settlement. */
export interface LPSettlementOutcome {
  lpId: LPId;
  success: boolean;
  settlementMs: number;
  amount: number;
}

/** Result of executing a route (reserving capacity across all LPs). */
export interface ExecuteRouteResult {
  success: boolean;
  reservationIds: string[];
  reservations: Reservation[];
  failed: { lpId: LPId; reason: string }[];
}

/** Result of settling a route. */
export interface SettleRouteResult {
  planId: string;
  settled: boolean;
  perLP: { lpId: LPId; success: boolean; newScore: number | null; newReputation: number }[];
  fullySettled: boolean;
}

/** Aggregate network status. */
export interface NetworkStatus {
  totalLPs: number;
  activeLPs: number;
  unhealthyLPs: number;
  corridors: {
    corridor: Corridor;
    lpCount: number;
    totalCapacity: number;
    availableCapacity: number;
    reservedCapacity: number;
    utilizationPercent: number;
    marketSpread: MarketSpread;
    projectedShortfall: boolean;
  }[];
  averageScore: number;
  topShortfallAlerts: Corridor[];
}

export class LiquidityNetwork {
  /**
   * Register an LP across all subsystems (registry + forecasting supply
   * initial sample). Returns the registered LPRecord.
   */
  registerLP(params: RegisterLPParams): LPRecord {
    const lp = liquidityRegistry.register(params);
    // Record initial supply for each corridor the LP serves.
    for (const corridor of lp.corridors) {
      const key = corridorKey(corridor);
      const amount = lp.capacity[key] ?? 0;
      if (amount > 0) {
        liquidityForecaster.recordSupply(corridor, amount, lp.joinedAt);
      }
    }
    eventEngine.emit('liquidity.lp_registered', {
      lpId: lp.id,
      name: lp.name,
      country: lp.country,
      corridors: lp.corridors,
      state: lp.state,
    }, 0);
    return lp;
  }

  /** Convenience: get an LP record. */
  getLP(lpId: LPId): LPRecord | undefined {
    return liquidityRegistry.get(lpId);
  }

  /** All LPs. */
  allLPs(): LPRecord[] {
    return liquidityRegistry.all();
  }

  /**
   * Get a quote (RoutingPlan) for a corridor + amount — the main entry point
   * for the routing service.
   */
  getQuote(corridor: Corridor, amount: number, opts: RoutingOpts = {}): RoutingPlan | null {
    // Record demand sample for forecasting.
    liquidityForecaster.recordDemand(corridor, amount);
    return findBestRoute(corridor, amount, opts);
  }

  /** Direct access to a single-LP price quote (low-level). */
  quoteLP(lpId: LPId, corridor: Corridor, amount: number): PriceQuote | null {
    return quotePrice(lpId, corridor, amount);
  }

  /** Direct access to a single-LP capacity quote (low-level). */
  quoteLPCapacity(lpId: LPId, corridor: Corridor, amount: number): CapacityQuote | null {
    return quoteCapacity(lpId, corridor, amount);
  }

  /** Market spread for a corridor. */
  marketSpread(corridor: Corridor, amount: number = 1_000): MarketSpread {
    return getMarketSpread(corridor, amount);
  }

  /** Competition — all bids for a corridor, sorted by effective cost. */
  bids(corridor: Corridor, amount: number): CompeteBid[] {
    return compete(corridor, amount);
  }

  /**
   * Execute a route — reserve capacity across all LPs in the plan.
   *
   * Uses deterministic reservation ids derived from the plan id + LP index so
   * re-execution is idempotent.
   *
   * If any reservation fails, ALL prior reservations are released (atomic).
   */
  executeRoute(plan: RoutingPlan, reservationIdPrefix?: string): ExecuteRouteResult {
    const prefix = reservationIdPrefix ?? plan.id;
    const reservations: Reservation[] = [];
    const reservationIds: string[] = [];
    const failed: { lpId: LPId; reason: string }[] = [];

    for (let i = 0; i < plan.route.length; i++) {
      const leg = plan.route[i];
      const rid = `${prefix}#leg${i}`;
      const result: ReservationResult = reserveCapacity(leg.lpId, plan.corridor, leg.amount, rid);
      if (!result.success || !result.reservationId) {
        failed.push({ lpId: leg.lpId, reason: result.reason ?? 'unknown' });
        // Roll back all prior reservations.
        for (const id of reservationIds) {
          releaseCapacity(id);
        }
        return { success: false, reservationIds: [], reservations: [], failed };
      }
      reservationIds.push(result.reservationId);
      const r = capacityReservations.get(result.reservationId);
      if (r) reservations.push(r);
    }

    eventEngine.emit('liquidity.route_executed', {
      planId: plan.id,
      corridor: plan.corridor,
      amount: plan.amount,
      legs: plan.route.length,
      reservationIds,
    }, 0);

    return { success: true, reservationIds, reservations, failed };
  }

  /**
   * Settle a route — mark per-LP outcomes, update scoring + health, and
   * release/consume capacity.
   *
   * For each LP in the plan:
   *  - If the outcome was a success: consume the reservation (capacity is
   *    actually spent), call updateReputationFromOutcome(success=true), call
   *    recordSettlement(success=true).
   *  - If the outcome was a failure: release the reservation (capacity is
   *    returned), call updateReputationFromOutcome(success=false), call
   *    recordFailure (and recordSettlement(success=false)).
   *
   * `fullySettled` is true iff every LP in the plan succeeded.
   */
  settleRoute(plan: RoutingPlan, reservationIdPrefix: string, outcomes: LPSettlementOutcome[]): SettleRouteResult {
    const outcomeByLp = new Map<LPId, LPSettlementOutcome>();
    for (const o of outcomes) outcomeByLp.set(o.lpId, o);

    const perLP: SettleRouteResult['perLP'] = [];
    let allSuccess = true;

    for (let i = 0; i < plan.route.length; i++) {
      const leg = plan.route[i];
      const rid = `${reservationIdPrefix}#leg${i}`;
      const outcome = outcomeByLp.get(leg.lpId) ?? {
        lpId: leg.lpId,
        success: false,
        settlementMs: 0,
        amount: leg.amount,
      };

      if (outcome.success) {
        consumeCapacity(rid);
        lpHealthMonitor.recordSettlement(leg.lpId, true, outcome.settlementMs);
      } else {
        releaseCapacity(rid);
        lpHealthMonitor.recordFailure(leg.lpId);
        allSuccess = false;
      }

      const score = updateReputationFromOutcome(leg.lpId, outcome.success, outcome.settlementMs, outcome.amount);
      const lp = liquidityRegistry.get(leg.lpId);
      perLP.push({
        lpId: leg.lpId,
        success: outcome.success,
        newScore: score?.score ?? null,
        newReputation: lp?.reputation ?? 0,
      });
    }

    eventEngine.emit('liquidity.route_settled', {
      planId: plan.id,
      fullySettled: allSuccess,
      perLP: perLP.map((p) => ({ lpId: p.lpId, success: p.success })),
    }, 0);

    return {
      planId: plan.id,
      settled: allSuccess,
      perLP,
      fullySettled: allSuccess,
    };
  }

  /**
   * Pause an LP — release all its in-flight reservations and mark it paused.
   * Routing will avoid it until resumed.
   */
  pauseLP(lpId: LPId): boolean {
    const lp = liquidityRegistry.get(lpId);
    if (!lp) return false;
    releaseAllForLp(lpId);
    liquidityRegistry.update(lpId, { state: 'paused' });
    eventEngine.emit('liquidity.lp_paused', { lpId, releasedReservations: true }, 0);
    return true;
  }

  /** Resume an LP. */
  resumeLP(lpId: LPId): boolean {
    const lp = liquidityRegistry.get(lpId);
    if (!lp) return false;
    liquidityRegistry.update(lpId, { state: 'active' });
    lpHealthMonitor.recordRecovery(lpId);
    eventEngine.emit('liquidity.lp_resumed', { lpId }, 0);
    return true;
  }

  /** Replenish capacity for an LP on a corridor. */
  replenishLP(lpId: LPId, corridor: Corridor, amount: number): number {
    const newAvail = replenishCapacity(lpId, corridor, amount);
    liquidityForecaster.recordSupply(corridor, amount);
    return newAvail;
  }

  /** Get LP health. */
  health(lpId: LPId): LPHealth {
    return lpHealthMonitor.getHealth(lpId);
  }

  /** Score an LP for a corridor. */
  score(lpId: LPId, corridor: Corridor, amount: number = 1_000): LPScore | null {
    return scoreLP(lpId, corridor, amount);
  }

  /** Rank LPs for a corridor. */
  rank(corridor: Corridor, amount: number = 1_000): LPScore[] {
    return rankLPs(corridor, amount);
  }

  /** Forecast for a corridor. */
  forecast(corridor: Corridor, horizonMs?: number): ForecastPoint[] {
    return liquidityForecaster.forecast(corridor, horizonMs);
  }

  /** Shortfall alerts. */
  shortfallAlerts(horizonMs?: number): Corridor[] {
    return liquidityForecaster.shortfallAlerts(horizonMs);
  }

  /** Current utilization for a corridor. */
  utilization(corridor: Corridor): number {
    return liquidityForecaster.getUtilization(corridor);
  }

  /** Refine a plan (re-route). */
  optimize(plan: RoutingPlan, opts: RoutingOpts = {}): RoutingPlan | null {
    return optimizePlan(plan, opts);
  }

  /** Set custom score weights. */
  setScoreWeights(w: Partial<ScoreWeights>): void {
    applyScoreWeights(w);
  }

  /**
   * Aggregate network status — total LPs, total capacity by corridor, avg
   * score, shortfalls.
   */
  networkStatus(): NetworkStatus {
    const lps = liquidityRegistry.all();
    const activeLps = lps.filter((lp) => lp.state === 'active');
    const corridorsSet = new Set<string>();
    for (const lp of lps) {
      for (const c of lp.corridors) corridorsSet.add(corridorKey(c));
    }
    const corridors = [...corridorsSet].map((k) => {
      const [fromCurrency, toCurrency] = k.split('→');
      const corridor: Corridor = { fromCurrency, toCurrency };
      const corridorLps = liquidityRegistry.activeLPs(corridor);
      let totalCapacity = 0;
      let availableCapacity = 0;
      let reservedCapacity = 0;
      for (const lp of corridorLps) {
        totalCapacity += lp.capacity[k] ?? 0;
        availableCapacity += lp.availableCapacity[k] ?? 0;
        reservedCapacity += lp.reservedCapacity[k] ?? 0;
      }
      const utilizationPercent = totalCapacity > 0
        ? Math.round(((totalCapacity - availableCapacity) / totalCapacity) * 10000) / 100
        : 0;
      const marketSpread = getMarketSpread(corridor);
      const points = liquidityForecaster.forecast(corridor);
      const projectedShortfall = points.some((p) => p.shortfall > 0);
      return {
        corridor,
        lpCount: corridorLps.length,
        totalCapacity,
        availableCapacity,
        reservedCapacity,
        utilizationPercent,
        marketSpread,
        projectedShortfall,
      };
    });

    // Average score across all active LPs (using their first corridor for
    // scoring — a corridor-agnostic summary).
    let scoreSum = 0;
    let scoreCount = 0;
    for (const lp of activeLps) {
      const corridor = lp.corridors[0];
      if (!corridor) continue;
      const s = scoreLP(lp.id, corridor);
      if (s) {
        scoreSum += s.score;
        scoreCount += 1;
      }
    }
    const averageScore = scoreCount > 0 ? scoreSum / scoreCount : 0;

    const unhealthyLPs = lps.filter((lp) => !lpHealthMonitor.getHealth(lp.id).healthy).length;
    const topShortfallAlerts = liquidityForecaster.shortfallAlerts();

    return {
      totalLPs: lps.length,
      activeLPs: activeLps.length,
      unhealthyLPs,
      corridors,
      averageScore: Math.round(averageScore * 1000) / 1000,
      topShortfallAlerts,
    };
  }

  /** Reset all subsystem state (test helper). */
  reset(): void {
    liquidityRegistry.reset();
    capacityReservations.reset();
    lpHealthMonitor.reset();
    liquidityForecaster.reset();
  }
}

/** Singleton liquidity network. */
export const liquidityNetwork = new LiquidityNetwork();
