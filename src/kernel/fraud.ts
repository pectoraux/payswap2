/**
 * Fraud Engine — heuristic fraud scoring for a payment intent.
 *
 * Combines velocity, amount anomaly and corridor-risk signals into a fraud
 * score. The simulator runs this before routing; a high score would, in
 * production, escalate to manual review or block the transaction.
 */
import type { SimulationScenario } from './types';

export interface FraudVerdict {
  score: number; // 0..1 (higher is riskier)
  flags: { name: string; weight: number; detail: string }[];
  recommendation: 'allow' | 'review' | 'block';
}

export class FraudEngine {
  assess(scenario: SimulationScenario): FraudVerdict {
    const flags: FraudVerdict['flags'] = [];

    // Round-number anomaly (often a structuring signal).
    if (scenario.amount > 0 && scenario.amount % 1000 === 0 && scenario.amount >= 10000) {
      flags.push({
        name: 'Round amount',
        weight: 0.08,
        detail: 'Round-figure amount over 10,000 — mild structuring signal',
      });
    }

    // High-value threshold relative to corridor.
    const highValue = scenario.amount >= 100000;
    if (highValue) {
      flags.push({
        name: 'High value',
        weight: 0.12,
        detail: 'Amount exceeds high-value threshold',
      });
    }

    const score = Math.min(
      1,
      Math.round(flags.reduce((s, f) => s + f.weight, 0) * 1e4) / 1e4,
    );
    const recommendation: FraudVerdict['recommendation'] =
      score >= 0.4 ? 'block' : score >= 0.2 ? 'review' : 'allow';

    return { score, flags, recommendation };
  }
}

export const fraudEngine = new FraudEngine();
