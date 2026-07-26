/**
 * Policy Engine — evaluates declarative policy rules against a plan.
 *
 * Policies are versioned, auditable rules. The Planner consults the Policy
 * Engine to accept/reject a candidate plan; violations surface as findings.
 */
import type { SimulationScenario, Reserve, PolicyVerdict, PolicyFinding, LiquiditySourceDraw } from './types';
import { round } from './support';

interface CandidateLike {
  lpUsage: LiquiditySourceDraw[];
  reserveDraw: number;
  treasuryDraw: number;
  cost: { costPercent: number; totalFees: number };
  riskScore: number;
}

export class PolicyEngine {
  evaluate(scenario: SimulationScenario, c: CandidateLike, reservesAfter: Reserve[]): PolicyVerdict {
    const findings: PolicyFinding[] = [];
    const p = scenario.policies;

    const total = c.lpUsage.reduce((s, u) => s + u.drawn, 0) || 1;
    const maxShare = Math.max(...c.lpUsage.map((u) => u.drawn / total), 0);
    if (c.lpUsage.length > 0 && maxShare > p.maxLpShare) {
      findings.push({
        policy: 'LP concentration cap',
        severity: maxShare > 0.9 ? 'block' : 'warn',
        detail: `Largest LP carries ${round(maxShare * 100, 1)}% (cap ${p.maxLpShare * 100}%)`,
      });
    }

    for (const r of reservesAfter) {
      if (r.available < r.minThreshold) {
        findings.push({
          policy: 'Reserve threshold',
          severity: 'block',
          detail: `${r.country} reserve ${round(r.available, 2)} below threshold ${r.minThreshold}`,
        });
      }
    }

    if (c.cost.costPercent > p.maxCostPercent) {
      findings.push({ policy: 'Cost cap', severity: 'block', detail: `Blended cost ${c.cost.costPercent}% exceeds ${p.maxCostPercent}% cap` });
    }

    if (c.riskScore > p.maxRiskScore) {
      findings.push({ policy: 'Risk cap', severity: 'block', detail: `Risk score ${c.riskScore.toFixed(2)} exceeds ${p.maxRiskScore} cap` });
    }

    if (p.requireInsurance && c.riskScore > 0.3) {
      findings.push({ policy: 'Insurance required', severity: 'warn', detail: 'Risk above threshold — insurance recommended' });
    }

    if (p.reservePolicy === 'preserve_reserves' && c.reserveDraw > 0) {
      findings.push({ policy: 'Reserve preservation', severity: 'warn', detail: `Reserve drawn despite preserve_reserves policy` });
    }

    if (findings.length === 0) {
      findings.push({ policy: 'All policies', severity: 'info', detail: 'Plan satisfies all kernel policies' });
    }

    return { passed: !findings.some((f) => f.severity === 'block'), findings };
  }
}

export const policyEngine = new PolicyEngine();
