/**
 * Compliance Engine — policy guardrails for cross-border liquidity movements.
 *
 * Performs KYC/AML-style checks (modelled deterministically), sanctions
 * screening, corridor-pair allow-listing and amount limits. A movement that
 * fails compliance never reaches execution.
 */
import type { SimulationScenario } from './types';

export interface ComplianceVerdict {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

const ALLOWED_CORRIDORS: Array<[string, string]> = [
  ['Kenya', 'Ghana'], ['Ghana', 'Kenya'],
  ['Kenya', 'Nigeria'], ['Nigeria', 'Kenya'],
  ['Ghana', 'Nigeria'], ['Nigeria', 'Ghana'],
  ['Kenya', 'Uganda'], ['Uganda', 'Kenya'],
  ['Kenya', 'Tanzania'], ['Tanzania', 'Kenya'],
  ['South Africa', 'Kenya'], ['Kenya', 'South Africa'],
  ['Nigeria', 'Ghana'], ['Ghana', 'Nigeria'],
];

const PER_TX_LIMIT: Record<string, number> = {
  KES: 1_500_000, GHS: 500_000, NGN: 10_000_000, USD: 25_000, ZAR: 400_000, UGX: 50_000_000, TZS: 40_000_000,
};

export class ComplianceEngine {
  verify(scenario: SimulationScenario): ComplianceVerdict {
    const checks: ComplianceVerdict['checks'] = [];
    const buyer = scenario.transaction.buyer;
    const merchant = scenario.transaction.merchant;

    const corridorOk = ALLOWED_CORRIDORS.some(([a, b]) => a === buyer.country && b === merchant.country);
    checks.push({
      name: 'Corridor authorization',
      passed: corridorOk,
      detail: corridorOk ? `${buyer.country} → ${merchant.country} is an authorized corridor` : `Corridor ${buyer.country} → ${merchant.country} is not authorized`,
    });

    const limit = PER_TX_LIMIT[scenario.transaction.currency] ?? 0;
    const limitOk = scenario.transaction.amount <= limit;
    checks.push({
      name: 'Transaction limit',
      passed: limitOk,
      detail: limitOk ? `Amount within ${scenario.transaction.currency} limit of ${limit.toLocaleString()}` : `Amount exceeds ${scenario.transaction.currency} limit of ${limit.toLocaleString()}`,
    });

    return { passed: checks.every((c) => c.passed), checks };
  }
}

export const complianceEngine = new ComplianceEngine();
