/**
 * Compliance Engine — policy guardrails for cross-border payments.
 *
 * Performs KYC/AML-style checks (modelled deterministically here), sanctions
 * screening, country-pair allow-listing and amount limits. A payment that
 * fails compliance never reaches settlement. In production this would call
 * external screening services; in the kernel it exposes a stable interface.
 */
import type { SimulationScenario } from './types';

export interface ComplianceVerdict {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

const ALLOWED_CORRIDORS: Array<[string, string]> = [
  ['Kenya', 'Ghana'],
  ['Ghana', 'Kenya'],
  ['Kenya', 'Nigeria'],
  ['Nigeria', 'Kenya'],
  ['Ghana', 'Nigeria'],
  ['Nigeria', 'Ghana'],
  ['Kenya', 'Uganda'],
  ['Uganda', 'Kenya'],
  ['Kenya', 'Tanzania'],
  ['Tanzania', 'Kenya'],
  ['South Africa', 'Kenya'],
  ['Kenya', 'South Africa'],
];

const SANCTIONED = new Set<string>([]);

const PER_TX_LIMIT: Record<string, number> = {
  KES: 1_500_000,
  GHS: 250_000,
  NGN: 10_000_000,
  USD: 25_000,
  ZAR: 400_000,
  UGX: 50_000_000,
  TZS: 40_000_000,
};

export class ComplianceEngine {
  verify(scenario: SimulationScenario): ComplianceVerdict {
    const checks: ComplianceVerdict['checks'] = [];

    // Corridor allow-list
    const corridorOk = ALLOWED_CORRIDORS.some(
      ([a, b]) => a === scenario.buyer.country && b === scenario.merchant.country,
    );
    checks.push({
      name: 'Corridor authorization',
      passed: corridorOk,
      detail: corridorOk
        ? `${scenario.buyer.country} -> ${scenario.merchant.country} is an authorized corridor`
        : `Corridor ${scenario.buyer.country} -> ${scenario.merchant.country} is not authorized`,
    });

    // Sanctions screening
    const buyerOk = !SANCTIONED.has(scenario.buyer.country);
    const merchantOk = !SANCTIONED.has(scenario.merchant.country);
    checks.push({
      name: 'Sanctions screening',
      passed: buyerOk && merchantOk,
      detail:
        buyerOk && merchantOk
          ? 'Both parties cleared sanctions screening'
          : 'A party is flagged on the sanctions list',
    });

    // Per-transaction limit
    const limit = PER_TX_LIMIT[scenario.currency] ?? 0;
    const limitOk = scenario.amount <= limit;
    checks.push({
      name: 'Transaction limit',
      passed: limitOk,
      detail: limitOk
        ? `Amount within ${scenario.currency} limit of ${limit.toLocaleString()}`
        : `Amount exceeds ${scenario.currency} limit of ${limit.toLocaleString()}`,
    });

    return { passed: checks.every((c) => c.passed), checks };
  }
}

export const complianceEngine = new ComplianceEngine();
