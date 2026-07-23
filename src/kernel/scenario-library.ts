/**
 * Scenario Library — saved simulations become regression tests.
 *
 * Every simulation can be saved as a named scenario ("Cross-border with
 * reserves in origin only", "Dual LP failure", "Reserve exhaustion + manual
 * settlement", "Nigeria PSP outage"). Re-running the library against the
 * current kernel compares each scenario's baseline metrics (cost, time, risk,
 * confidence) against the saved baseline and flags drift — turning the
 * simulator into a continuous verification system.
 */
import type { SavedScenario, SimulationScenario, RegressionResult, SimulationResult } from './types';
import { uid } from './support';

/** In-memory store (mirrored to Prisma by the API route). */
const store: Map<string, SavedScenario> = new Map();

export const ScenarioLibrary = {
  list(): SavedScenario[] {
    return [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
  },

  get(id: string): SavedScenario | undefined {
    return store.get(id);
  },

  save(scenario: SimulationScenario, baseline: SimulationResult, category = 'Custom'): SavedScenario {
    const existing = scenario.id ? store.get(scenario.id) : undefined;
    const saved: SavedScenario = {
      id: scenario.id ?? uid('scn'),
      name: scenario.name,
      description: scenario.description ?? '',
      category,
      scenario: { ...scenario, id: scenario.id ?? uid('scn') },
      baselineHash: baseline.resultHash,
      baselineMetrics: {
        costPercent: baseline.plan.metrics.costPercent,
        settlementTimeMs: baseline.plan.metrics.settlementTimeMs,
        riskScore: baseline.plan.metrics.riskScore,
        confidence: baseline.plan.metrics.confidence,
      },
      createdAt: existing?.createdAt ?? Date.now(),
      lastRunAt: Date.now(),
      lastRunPassed: true,
    };
    store.set(saved.id, saved);
    return saved;
  },

  remove(id: string): boolean {
    return store.delete(id);
  },

  /** Compare current results against baselines; returns drift report. */
  regress(current: SavedScenario[], results: Map<string, SimulationResult>): RegressionResult[] {
    return current.map((s) => {
      const result = results.get(s.id);
      if (!result) {
        return { scenarioId: s.id, name: s.name, passed: false, baseline: s.baselineMetrics, current: s.baselineMetrics, drift: { costPercent: 0, settlementTimeMs: 0, riskScore: 0 } };
      }
      const cur = {
        costPercent: result.plan.metrics.costPercent,
        settlementTimeMs: result.plan.metrics.settlementTimeMs,
        riskScore: result.plan.metrics.riskScore,
        confidence: result.plan.metrics.confidence,
      };
      const drift = {
        costPercent: Math.round((cur.costPercent - s.baselineMetrics.costPercent) * 100) / 100,
        settlementTimeMs: cur.settlementTimeMs - s.baselineMetrics.settlementTimeMs,
        riskScore: Math.round((cur.riskScore - s.baselineMetrics.riskScore) * 100) / 100,
      };
      // Pass if cost/risk drift within tolerance and hash matches.
      const passed = Math.abs(drift.costPercent) < 0.3 && Math.abs(drift.riskScore) < 0.1 && result.resultHash === s.baselineHash;
      return { scenarioId: s.id, name: s.name, passed, baseline: s.baselineMetrics, current: cur, drift };
    });
  },
};
