/**
 * AI Agent Engine — explainable multi-objective optimization.
 *
 * In the Global Liquidity OS architecture, the Liquidity Planner owns plan
 * generation and objective scoring. This engine remains as a thin facade for
 * backward compatibility and for extension agents that want to reason over a
 * completed plan's metrics without re-running the planner.
 */
import type { AIRecommendation, SimulationScenario } from './types';
import { round } from './support';

export interface AIContext {
  scenario: SimulationScenario;
  reasoning: AIRecommendation;
}

export class AIAgentEngine {
  summarize(ctx: AIContext): string {
    const r = ctx.reasoning;
    return `${r.strategy}. Weighted score ${r.weightedScore}. ${r.decisions.length} decisions recorded.`;
  }

  /** Returns the dominant objective (highest weighted contribution). */
  dominantObjective(reasoning: AIRecommendation): string {
    if (reasoning.objectiveScores.length === 0) return 'none';
    const top = [...reasoning.objectiveScores].sort((a, b) => b.score - a.score)[0];
    return `${top.objective} (${round(top.score * 100, 1)}%)`;
  }
}

export const aiAgentEngine = new AIAgentEngine();
