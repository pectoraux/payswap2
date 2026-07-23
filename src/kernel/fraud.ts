/**
 * Fraud Engine — heuristic fraud scoring for a liquidity movement.
 */
import type { SimulationScenario } from './types';

export interface FraudVerdict {
  score: number;
  flags: { name: string; weight: number; detail: string }[];
  recommendation: 'allow' | 'review' | 'block';
}

export class FraudEngine {
  assess(scenario: SimulationScenario): FraudVerdict {
    const flags: FraudVerdict['flags'] = [];
    const amount = scenario.transaction.amount;

    if (amount > 0 && amount % 1000 === 0 && amount >= 10000) {
      flags.push({ name: 'Round amount', weight: 0.08, detail: 'Round-figure amount over 10,000 — mild structuring signal' });
    }
    if (amount >= 200000) {
      flags.push({ name: 'High value', weight: 0.12, detail: 'Amount exceeds high-value threshold' });
    }

    const score = Math.min(1, Math.round(flags.reduce((s, f) => s + f.weight, 0) * 1e4) / 1e4);
    const recommendation: FraudVerdict['recommendation'] = score >= 0.4 ? 'block' : score >= 0.2 ? 'review' : 'allow';
    return { score, flags, recommendation };
  }
}

export const fraudEngine = new FraudEngine();
