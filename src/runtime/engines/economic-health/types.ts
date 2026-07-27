/**
 * Economic Health Dashboard — the operating console of the financial network.
 * (Amendment 2 §7E.)
 *
 * A first-class Runtime surface (NOT an analytics page). Renders the live
 * state of the Economic Intelligence Runtime so operators can see network
 * health at a glance and act on Recommendations.
 *
 * M-RT-1 ships types + a no-op interface. M-RT-7 implements the real
 * dashboard (fed by read models that projections build from Domain Events +
 * Liquidity Intelligence findings + Recommendation lifecycle).
 */

import type { RecommendationAudience, Recommendation } from '../opportunity-discovery/types';

export interface ReserveHealthRow {
  reserveId: string;
  currency: string;
  available: number;
  locked: number;
  utilization: number;        // 0..1
  idlePct: number;            // 0..1 (1 - utilization)
  shadowPriceBps: number;
  capital: number;            // available + locked
  isIdle: boolean;            // idlePct > 0.8
}

export interface LPHealthRow {
  lpId: string;
  utilization: number;        // 0..1
  utilizationTarget: number;
  idleCapacity: number;
  earnedThisPeriod: number;
  couldEarnMore: number;
  isUnderutilized: boolean;
}

export interface CorridorHealthRow {
  corridor: string;
  avgCostBps: number;
  avgLatencyMs: number;
  failureRate: number;
  lpCount: number;
  hhi: number;                // Herfindahl-Hirschman Index
  topShare: number;           // 0..1
  isConcentrated: boolean;
  isExpensive: boolean;
}

export interface RecommendationImpactSummary {
  sinceTs: number;
  implementedCount: number;
  totalActualVolumeDelta: number;
  totalActualRevenueDelta: number;
  totalActualCostDeltaBps: number;
  byKind: { kind: string; count: number; avgVolumeDelta: number; avgRevenueDelta: number }[];
}

/** The top-level snapshot — what an operator sees first. */
export interface EconomicHealthSnapshot {
  networkEfficiencyBps: number;       // avg route cost across the network
  networkEfficiencyTrend: 'up' | 'down' | 'flat';
  unusedLiquidity: number;            // $ idle across all LPs
  idleReserves: { reserveId: string; idlePct: number; capital: number }[];
  marketConcentration: { corridor: string; hhi: number; topShare: number }[];
  capitalVelocity: number;            // $ settled per $ of reserve per day
  avgRouteEfficiencyPct: number;      // actual cost / optimal cost (100% = optimal)
  missedRevenue: number;              // $ from rejected/expired recs
  lostVolume: number;                 // $ of payments that failed/rerouted due to gaps
  optimizationBacklogCount: number;   // open Recommendations
  ts: number;
}

/** The Economic Health Dashboard contract. */
export interface EconomicHealthDashboard {
  /** The top-level snapshot. */
  snapshot(): Promise<EconomicHealthSnapshot>;
  /** Per-reserve drill-down. */
  reserves(): Promise<ReserveHealthRow[]>;
  /** Per-LP drill-down. */
  lps(): Promise<LPHealthRow[]>;
  /** Per-corridor drill-down. */
  corridors(): Promise<CorridorHealthRow[]>;
  /** Open Recommendations (the optimization backlog), optionally filtered. */
  backlog(audience?: RecommendationAudience): Promise<Recommendation[]>;
  /** Measured impact of implemented Recommendations since `sinceTs`. */
  impact(sinceTs: number): Promise<RecommendationImpactSummary>;
}

/**
 * NoOpEconomicHealthDashboard — the M-RT-1 placeholder. Returns empty/zero
 * snapshots. M-RT-7 replaces this with the real dashboard backed by read
 * models.
 */
export class NoOpEconomicHealthDashboard implements EconomicHealthDashboard {
  async snapshot(): Promise<EconomicHealthSnapshot> {
    return {
      networkEfficiencyBps: 0,
      networkEfficiencyTrend: 'flat',
      unusedLiquidity: 0,
      idleReserves: [],
      marketConcentration: [],
      capitalVelocity: 0,
      avgRouteEfficiencyPct: 100,
      missedRevenue: 0,
      lostVolume: 0,
      optimizationBacklogCount: 0,
      ts: 0,
    };
  }
  async reserves(): Promise<ReserveHealthRow[]> { return []; }
  async lps(): Promise<LPHealthRow[]> { return []; }
  async corridors(): Promise<CorridorHealthRow[]> { return []; }
  async backlog(): Promise<Recommendation[]> { return []; }
  async impact(): Promise<RecommendationImpactSummary> {
    return { sinceTs: 0, implementedCount: 0, totalActualVolumeDelta: 0, totalActualRevenueDelta: 0, totalActualCostDeltaBps: 0, byKind: [] };
  }
}
