/**
 * Treasury AI — continuously recommends liquidity decisions.
 *
 * Surfaces recommendations like "shift liquidity to country X", "replenish
 * reserve via stablecoin", "prefer LPs over reserves". Nothing is hidden —
 * every recommendation carries a rationale and estimated impact.
 */
import type { TreasuryRecommendation, SimulationScenario, Reserve } from './types';
import { uid } from './support';

export class TreasuryAI {
  recommend(scenario: SimulationScenario, reservesAfter: Reserve[], planMetrics: { costPercent: number; riskScore: number; reserveUtilization: number }): TreasuryRecommendation[] {
    const recs: TreasuryRecommendation[] = [];
    const cur = scenario.transaction.merchant.currency;

    for (const r of reservesAfter) {
      const headroom = r.available - r.minThreshold;
      if (r.minThreshold > 0 && headroom < r.minThreshold * 0.2) {
        recs.push({
          id: uid('trec'),
          action: `Replenish ${r.country} reserve`,
          rationale: `${r.country} reserve headroom is ${Math.round(headroom)} ${r.currency} — below 20% of threshold. Recommend stablecoin conversion to restore buffer.`,
          priority: 'high',
          estimatedImpact: `+${Math.round(r.minThreshold * 0.5)} ${r.currency} reserve buffer`,
        });
      }
    }

    if (scenario.treasury.stablecoinBalance > scenario.transaction.amount * 3 && planMetrics.costPercent > 1.2) {
      recs.push({
        id: uid('trec'),
        action: 'Prefer stablecoin treasury for next corridor',
        rationale: `Stablecoin balance (${scenario.treasury.stablecoinBalance} ${cur}) is healthy and cheaper than LP bridge. Treasury draw would lower blended cost.`,
        priority: 'medium',
        estimatedImpact: `-0.3% cost on similar corridors`,
      });
    }

    if (planMetrics.riskScore > 0.25 && scenario.treasury.emergencyTreasury > 0) {
      recs.push({
        id: uid('trec'),
        action: 'Hold emergency treasury in reserve',
        rationale: `Risk elevated (${planMetrics.riskScore.toFixed(2)}). Emergency treasury should remain available for insurance claims rather than routine corridors.`,
        priority: 'medium',
        estimatedImpact: 'Maintains insurance solvency',
      });
    }

    if (planMetrics.reserveUtilization > 60) {
      recs.push({
        id: uid('trec'),
        action: `Shift liquidity toward ${scenario.transaction.merchant.country}`,
        rationale: `Destination reserve utilization at ${planMetrics.reserveUtilization}%. Recommend rebalancing via diaspora/cooperative pools.`,
        priority: 'low',
        estimatedImpact: 'Reduces future reserve pressure',
      });
    }

    return recs;
  }
}

export const treasuryAI = new TreasuryAI();
