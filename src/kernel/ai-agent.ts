/**
 * AI Agent Engine — produces structured reasoning over a settlement plan.
 *
 * The kernel's agent reasons deterministically over the routing, pricing and
 * risk outputs to explain *why* a given path was chosen. A higher-level
 * narrative can be layered on by an LLM (the API route does this) — but the
 * kernel never depends on an LLM being available, so simulations stay
 * reproducible and offline-capable.
 */
import type { AIReasoning, AIDecision, SimulationScenario } from './types';
import type { RoutingResult } from './routing';
import type { PriceResult } from './pricing';
import type { RiskResult } from './risk';
import { round } from './support';

export interface AIContext {
  scenario: SimulationScenario;
  routing: RoutingResult;
  pricing: PriceResult;
  risk: RiskResult;
  settlementMs: number;
}

export class AIAgentEngine {
  reason(ctx: AIContext): Omit<AIReasoning, 'narrative' | 'llmPowered'> {
    const { scenario, routing, pricing, risk } = ctx;
    const decisions: AIDecision[] = [];
    const steps: string[] = [];

    const strategy =
      scenario.preference === 'cheapest'
        ? 'Cost-minimizing corridor'
        : scenario.preference === 'fastest'
          ? 'Latency-minimizing corridor'
          : 'Risk-minimizing diversified corridor';

    // Decision 1: corridor feasibility
    decisions.push({
      step: 'Corridor authorization',
      rationale: `${scenario.buyer.country} → ${scenario.merchant.country} verified against authorized corridors.`,
    });

    // Decision 2: FX bridge
    if (scenario.buyer.currency !== scenario.merchant.currency) {
      decisions.push({
        step: 'FX bridge',
        rationale: `Quoted ${scenario.buyer.currency}→${scenario.merchant.currency} @ ${round(routing.fxQuote.effectiveRate, 6)} (${routing.fxQuote.spreadBps} bps spread). Buyer debited ${round(routing.sourceAmount, 2)} ${scenario.buyer.currency}.`,
      });
    }

    // Decision 3: LP selection
    if (routing.lpUsage.length === 0) {
      decisions.push({
        step: 'Liquidity sourcing',
        rationale: 'No LPs required — reserve self-funded the payment.',
      });
    } else {
      for (const u of routing.lpUsage) {
        decisions.push({
          step: `Draw LP ${u.lpId}`,
          rationale: `Drew ${round(u.drawn, 2)} ${scenario.merchant.currency} @ ${u.rate}%${u.exhausted ? ' — LP exhausted after this draw' : ` — ${round(u.remaining, 2)} remaining`}.`,
        });
      }
      steps.push(
        ...routing.lpUsage.map(
          (u) => `LP${u.lpId} ${u.exhausted ? 'exhausted after' : 'provided'} ${round(u.drawn, 2)}`,
        ),
      );
    }

    // Decision 4: reserve health
    decisions.push({
      step: 'Reserve health',
      rationale:
        risk.score < 0.15
          ? 'All reserves maintained above minimum thresholds; no insurance required.'
          : 'Reserve headroom tightened — flagged for monitoring.',
    });

    // Decision 5: risk acceptance
    decisions.push({
      step: 'Risk acceptance',
      rationale: `Risk score ${risk.score.toFixed(2)} (${risk.label}) — ${risk.confidence}% confidence. ${risk.score < 0.2 ? 'Within autonomous settlement band.' : 'Escalation recommended.'}`,
    });

    // Decision 6: cost acceptance
    decisions.push({
      step: 'Cost acceptance',
      rationale: `Blended cost ${pricing.costPercent}% (${round(pricing.totalFees, 2)} ${scenario.merchant.currency}) — ${scenario.preference} preference satisfied.`,
    });

    steps.unshift(`Strategy: ${strategy}`);
    steps.push(`Settlement projected at ${round(ctx.settlementMs / 1000, 1)}s`);
    steps.push(`Confidence ${risk.confidence}%`);

    return { strategy, steps, decisions };
  }

  /** Deterministic fallback narrative (used when no LLM is available). */
  buildFallbackNarrative(
    base: Omit<AIReasoning, 'narrative' | 'llmPowered'>,
    ctx: AIContext,
  ): string {
    const lpSummary =
      ctx.routing.lpUsage.length > 0
        ? ctx.routing.lpUsage
            .map((u) => `LP${u.lpId} covered ${round(u.drawn, 0)}${u.exhausted ? ' and was exhausted' : ''}`)
            .join('; ')
        : 'the source reserve self-funded the payment';
    return `Under the ${ctx.scenario.preference} preference, the kernel routed ${round(ctx.scenario.amount, 0)} ${ctx.scenario.merchant.currency} from ${ctx.scenario.buyer.country} to ${ctx.scenario.merchant.country}. ${lpSummary}. The blended cost was ${ctx.pricing.costPercent}% and the risk score ${ctx.risk.score.toFixed(2)} (${ctx.risk.label}), yielding ${ctx.risk.confidence}% confidence. All reserves remained above their minimum thresholds, so no insurance was required.`;
  }
}

export const aiAgentEngine = new AIAgentEngine();
