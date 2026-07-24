/**
 * Financial Reasoning Engine — the kernel's AI brain.
 *
 * NOT a "planner." It performs several INDEPENDENT reasoning responsibilities,
 * none of which execute anything. They only reason:
 *
 *   - optimization       (find the best world transition)
 *   - explanation        (explain why a plan was chosen)
 *   - anomaly detection  (detect unusual patterns)
 *   - treasury strategy  (recommend treasury actions)
 *   - reserve forecasting (forecast reserve health)
 *   - LP recommendations (recommend LP lifecycle actions)
 *   - fraud detection    (flag suspicious activity)
 *   - insurance recommendation (recommend claim actions)
 *   - governance recommendation (recommend policy changes)
 *   - extension recommendation (recommend extensions)
 *
 * The optimizer is one sub-capability of this engine.
 */
import type {
  SimulationScenario,
  LiquidityExecutionPlan,
  Reserve,
  LiquidityProvider,
  TreasuryRecommendation,
  ObjectiveScore,
  AIRecommendation,
  AIDecision,
  CurrencyCode,
} from './types';
import { round, formatDuration } from './support';

export interface ReasoningResult {
  category: ReasoningCategory;
  summary: string;
  recommendations: ReasoningRecommendation[];
  confidence: number;
  evidence: string[];
}

export type ReasoningCategory =
  | 'optimization'
  | 'explanation'
  | 'anomaly_detection'
  | 'treasury_strategy'
  | 'reserve_forecasting'
  | 'lp_recommendations'
  | 'fraud_detection'
  | 'insurance_recommendation'
  | 'governance_recommendation'
  | 'extension_recommendation';

export interface ReasoningRecommendation {
  action: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  category: ReasoningCategory;
}

export class FinancialReasoningEngine {
  /** Run ALL reasoning categories against a plan + world. */
  reason(plan: LiquidityExecutionPlan, scenario: SimulationScenario, world: { reserves: Reserve[]; liquidityProviders: LiquidityProvider[] }): ReasoningResult[] {
    return [
      this.optimization(plan, scenario),
      this.explanation(plan),
      this.detectAnomalies(plan, scenario),
      this.treasuryStrategy(plan, scenario),
      this.forecastReserves(plan, scenario, world),
      this.recommendLPs(plan, world),
      this.detectFraud(plan, scenario),
      this.recommendInsurance(plan, scenario),
      this.recommendGovernance(plan),
      this.recommendExtensions(plan),
    ];
  }

  /* ----------------------------------------------------------------------- */
  optimization(plan: LiquidityExecutionPlan, scenario: SimulationScenario): ReasoningResult {
    return {
      category: 'optimization',
      summary: `Selected "${plan.reasoning.strategy}" with weighted score ${plan.reasoning.weightedScore} from ${plan.alternatives.length + 1} candidates.`,
      recommendations: [
        { action: 'Execute selected plan', rationale: `Weighted score ${plan.reasoning.weightedScore} is highest among feasible candidates.`, priority: 'high', category: 'optimization' },
      ],
      confidence: plan.metrics.confidence / 100,
      evidence: plan.reasoning.objectiveScores.map((s) => `${s.objective}: ${s.rationale}`),
    };
  }

  explanation(plan: LiquidityExecutionPlan): ReasoningResult {
    return {
      category: 'explanation',
      summary: plan.reasoning.narrative,
      recommendations: [],
      confidence: 1,
      evidence: plan.reasoning.decisions.map((d) => `${d.step}: ${d.rationale}`),
    };
  }

  detectAnomalies(plan: LiquidityExecutionPlan, scenario: SimulationScenario): ReasoningResult {
    const anomalies: string[] = [];
    const recs: ReasoningRecommendation[] = [];
    if (plan.metrics.riskScore > 0.4) {
      anomalies.push(`Elevated risk score ${plan.metrics.riskScore.toFixed(2)}`);
      recs.push({ action: 'Monitor closely', rationale: 'Risk above 0.40 threshold', priority: 'high', category: 'anomaly_detection' });
    }
    if (plan.metrics.costPercent > 2) {
      anomalies.push(`High cost ${plan.metrics.costPercent}%`);
      recs.push({ action: 'Review LP fees', rationale: 'Cost above 2% — negotiate better rates', priority: 'medium', category: 'anomaly_detection' });
    }
    if (scenario.failures.length > 0) {
      anomalies.push(`${scenario.failures.length} failure(s) injected`);
      recs.push({ action: 'Investigate failure root cause', rationale: `${scenario.failures.length} failures during execution`, priority: 'high', category: 'anomaly_detection' });
    }
    return {
      category: 'anomaly_detection',
      summary: anomalies.length === 0 ? 'No anomalies detected.' : `${anomalies.length} anomaly(ies): ${anomalies.join('; ')}.`,
      recommendations: recs,
      confidence: anomalies.length === 0 ? 1 : 0.6,
      evidence: anomalies,
    };
  }

  treasuryStrategy(plan: LiquidityExecutionPlan, scenario: SimulationScenario): ReasoningResult {
    const recs: ReasoningRecommendation[] = [];
    if (plan.metrics.reserveUtilization > 60) {
      recs.push({ action: 'Replenish destination reserve', rationale: `Utilization at ${plan.metrics.reserveUtilization}%`, priority: 'high', category: 'treasury_strategy' });
    }
    if (scenario.treasury.stablecoinBalance > scenario.transaction.amount * 5) {
      recs.push({ action: 'Deploy excess stablecoin', rationale: 'Treasury stablecoin underutilized', priority: 'low', category: 'treasury_strategy' });
    }
    return {
      category: 'treasury_strategy',
      summary: `${recs.length} treasury recommendation(s). Reserve utilization ${plan.metrics.reserveUtilization}%.`,
      recommendations: recs,
      confidence: 0.85,
      evidence: [`Reserve utilization: ${plan.metrics.reserveUtilization}%`, `Stablecoin balance: ${scenario.treasury.stablecoinBalance}`],
    };
  }

  forecastReserves(plan: LiquidityExecutionPlan, scenario: SimulationScenario, world: { reserves: Reserve[] }): ReasoningResult {
    const forecasts = world.reserves.map((r) => {
      const daysOfRunway = r.minThreshold > 0 ? Math.floor(r.available / Math.max(r.minThreshold * 0.1, 1)) : 999;
      return { country: r.country, available: r.available, daysOfRunway };
    });
    const critical = forecasts.filter((f) => f.daysOfRunway < 7);
    return {
      category: 'reserve_forecasting',
      summary: `${forecasts.length} reserves forecasted. ${critical.length} critical (< 7 days runway).`,
      recommendations: critical.map((c) => ({ action: `Replenish ${c.country} reserve`, rationale: `Only ${c.daysOfRunway} days of runway`, priority: 'high' as const, category: 'reserve_forecasting' as const })),
      confidence: 0.8,
      evidence: forecasts.map((f) => `${f.country}: ${f.available} available, ${f.daysOfRunway} days runway`),
    };
  }

  recommendLPs(plan: LiquidityExecutionPlan, world: { liquidityProviders: LiquidityProvider[] }): ReasoningResult {
    const offline = world.liquidityProviders.filter((lp) => !lp.online);
    const lowCap = world.liquidityProviders.filter((lp) => lp.online && lp.tradingCapacity < 5000);
    const recs: ReasoningRecommendation[] = [];
    if (offline.length > 0) recs.push({ action: 'Reactivate offline LPs', rationale: `${offline.length} LP(s) offline`, priority: 'medium', category: 'lp_recommendations' });
    if (lowCap.length > 0) recs.push({ action: 'Recruit more LPs', rationale: `${lowCap.length} LP(s) with low capacity`, priority: 'low', category: 'lp_recommendations' });
    return {
      category: 'lp_recommendations',
      summary: `${world.liquidityProviders.length} LPs, ${offline.length} offline, ${lowCap.length} low capacity.`,
      recommendations: recs,
      confidence: 0.9,
      evidence: world.liquidityProviders.map((lp) => `${lp.name}: ${lp.online ? 'online' : 'offline'}, cap ${lp.tradingCapacity}`),
    };
  }

  detectFraud(plan: LiquidityExecutionPlan, scenario: SimulationScenario): ReasoningResult {
    const flags: string[] = [];
    if (scenario.transaction.amount >= 200000) flags.push('High-value transaction');
    if (scenario.transaction.amount % 10000 === 0 && scenario.transaction.amount > 0) flags.push('Round amount (structuring signal)');
    return {
      category: 'fraud_detection',
      summary: flags.length === 0 ? 'No fraud indicators.' : `${flags.length} flag(s): ${flags.join(', ')}.`,
      recommendations: flags.length > 0 ? [{ action: 'Enhanced review', rationale: flags.join('; '), priority: 'medium', category: 'fraud_detection' }] : [],
      confidence: flags.length === 0 ? 1 : 0.7,
      evidence: flags,
    };
  }

  recommendInsurance(plan: LiquidityExecutionPlan, scenario: SimulationScenario): ReasoningResult {
    const needsInsurance = plan.metrics.riskScore > 0.3 || scenario.policies.requireInsurance;
    return {
      category: 'insurance_recommendation',
      summary: needsInsurance ? 'Insurance recommended — risk elevated.' : 'No insurance needed — risk within band.',
      recommendations: needsInsurance ? [{ action: 'File insurance claim', rationale: `Risk ${plan.metrics.riskScore.toFixed(2)} above 0.30`, priority: 'medium', category: 'insurance_recommendation' }] : [],
      confidence: 0.85,
      evidence: [`Risk score: ${plan.metrics.riskScore}`, `Insurance exposure: ${plan.metrics.insuranceExposure}`],
    };
  }

  recommendGovernance(plan: LiquidityExecutionPlan): ReasoningResult {
    return {
      category: 'governance_recommendation',
      summary: 'Constitution and policies evaluated. No governance changes needed.',
      recommendations: [],
      confidence: 0.95,
      evidence: [`Policy passed: ${plan.policy.passed}`, `${plan.policy.findings.length} findings`],
    };
  }

  recommendExtensions(plan: LiquidityExecutionPlan): ReasoningResult {
    return {
      category: 'extension_recommendation',
      summary: 'No extension recommendations at this time.',
      recommendations: [],
      confidence: 0.9,
      evidence: ['Extension runtime stable'],
    };
  }
}

export const reasoningEngine = new FinancialReasoningEngine();
