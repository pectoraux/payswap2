/**
 * Policy Engine — evaluates declarative policy rules against a plan.
 *
 * Policies are versioned, auditable rules (e.g. "no single LP may carry more
 * than 70% of a payment", "destination reserve must stay above threshold after
 * payout"). The Routing Engine consults the Policy Engine to accept/reject a
 * candidate plan; violations are surfaced as policy findings.
 */
import type { SimulationScenario, ReserveConfig } from './types';
import type { RoutingResult } from './routing';
import type { PriceResult } from './pricing';
import { round } from './support';

export interface PolicyFinding {
  policy: string;
  severity: 'info' | 'warn' | 'block';
  detail: string;
}

export interface PolicyVerdict {
  passed: boolean;
  findings: PolicyFinding[];
}

const POLICIES = {
  maxLpShare: 0.7,
  minReserveAfterPayout: true,
  maxCostPercent: 5,
  maxRiskScore: 0.6,
};

export class PolicyEngine {
  evaluate(
    scenario: SimulationScenario,
    routing: RoutingResult,
    pricing: PriceResult,
    riskScore: number,
    reservesAfter: ReserveConfig[],
  ): PolicyVerdict {
    const findings: PolicyFinding[] = [];

    // LP concentration
    const total = routing.lpUsage.reduce((s, u) => s + u.drawn, 0) || 1;
    const maxShare = Math.max(...routing.lpUsage.map((u) => u.drawn / total), 0);
    if (routing.lpUsage.length > 0 && maxShare > POLICIES.maxLpShare) {
      findings.push({
        policy: 'LP concentration cap',
        severity: maxShare > 0.85 ? 'block' : 'warn',
        detail: `Largest LP carries ${round(maxShare * 100, 1)}% (cap ${POLICIES.maxLpShare * 100}%)`,
      });
    }

    // Reserve health after payout
    if (POLICIES.minReserveAfterPayout) {
      for (const r of reservesAfter) {
        if (r.balance < r.minThreshold) {
          findings.push({
            policy: 'Reserve threshold',
            severity: 'block',
            detail: `${r.country} reserve ${round(r.balance, 2)} below threshold ${r.minThreshold}`,
          });
        }
      }
    }

    // Cost cap
    if (pricing.costPercent > POLICIES.maxCostPercent) {
      findings.push({
        policy: 'Cost cap',
        severity: 'block',
        detail: `Blended cost ${pricing.costPercent}% exceeds ${POLICIES.maxCostPercent}% cap`,
      });
    }

    // Risk cap
    if (riskScore > POLICIES.maxRiskScore) {
      findings.push({
        policy: 'Risk cap',
        severity: 'block',
        detail: `Risk score ${riskScore.toFixed(2)} exceeds ${POLICIES.maxRiskScore} cap`,
      });
    }

    if (findings.length === 0) {
      findings.push({
        policy: 'All policies',
        severity: 'info',
        detail: 'Plan satisfies all kernel policies',
      });
    }

    return {
      passed: !findings.some((f) => f.severity === 'block'),
      findings,
    };
  }
}

export const policyEngine = new PolicyEngine();
