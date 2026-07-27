/**
 * Economic Score Engine. (Final Amendment §7M.)
 *
 * Every corridor receives an Economic Score (demand/supply/competition/
 * capital-efficiency/reserve-health/risk/latency/profitability/growth) that
 * powers BOTH routing AND recommendations.
 *
 * M-RT-1 ships a no-op interface. M-RT-9 implements the real engine.
 */

export type ScoreDimension =
  | 'demand'
  | 'supply'
  | 'competition'
  | 'capitalEfficiency'
  | 'reserveHealth'
  | 'risk'
  | 'latency'
  | 'profitability'
  | 'growth';

export interface EconomicScore {
  corridor: string;
  demand: number;            // 0..1
  supply: number;            // 0..1
  competition: number;       // 0..1 (higher = more competitive)
  capitalEfficiency: number; // 0..1
  reserveHealth: number;     // 0..1
  risk: number;              // 0..1 (lower = safer)
  latency: number;           // ms
  profitabilityBps: number;
  growth: number;            // 0..1 (trend)
  /** Weighted composite 0..1 — powers routing + recommendations. */
  composite: number;
}

export interface EconomicScoreEngine {
  /** Score one corridor. */
  score(corridorId: string): Promise<EconomicScore>;
  /** Rank corridors by a dimension. */
  rank(by: ScoreDimension): Promise<{ corridor: string; score: EconomicScore }[]>;
}

/** No-op placeholder (M-RT-1). M-RT-9 implements the real engine. */
export class NoOpEconomicScoreEngine implements EconomicScoreEngine {
  async score(corridorId: string): Promise<EconomicScore> {
    return {
      corridor: corridorId,
      demand: 0, supply: 0, competition: 0, capitalEfficiency: 0,
      reserveHealth: 0, risk: 0, latency: 0, profitabilityBps: 0, growth: 0,
      composite: 0,
    };
  }
  async rank(): Promise<{ corridor: string; score: EconomicScore }[]> { return []; }
}
