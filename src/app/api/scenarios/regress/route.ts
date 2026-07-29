import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { simulationEngine, ScenarioLibrary, type SimulationScenario, type SimulationResult } from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/scenarios/regress — re-run every saved scenario against the current
 * kernel and report drift vs the stored baseline. Turns the simulator into a
 * continuous verification system.
 */
export async function POST() {
  const records = await db.savedScenarioRecord.findMany();
  const saved = records.map((r) => {
    const scenario = JSON.parse(r.scenario) as SimulationScenario;
    return ScenarioLibrary.save(scenario, {
      resultHash: r.baselineHash,
      plan: { metrics: { costPercent: Number(r.baselineCost), settlementTimeMs: r.baselineTime, riskScore: Number(r.baselineRisk), confidence: Number(r.baselineConf) } },
    } as SimulationResult, r.category ?? undefined);
  });

  const results = new Map<string, SimulationResult>();
  for (const s of saved) {
    const result = simulationEngine.run(s.scenario);
    results.set(s.id, result);
    // Update lastRun in DB.
    const drift = {
      costPercent: Math.round((result.plan.metrics.costPercent - s.baselineMetrics.costPercent) * 100) / 100,
      settlementTimeMs: result.plan.metrics.settlementTimeMs - s.baselineMetrics.settlementTimeMs,
      riskScore: Math.round((result.plan.metrics.riskScore - s.baselineMetrics.riskScore) * 100) / 100,
    };
    const passed = Math.abs(drift.costPercent) < 0.3 && Math.abs(drift.riskScore) < 0.1 && result.resultHash === s.baselineHash;
    try {
      await db.savedScenarioRecord.update({
        where: { scenarioId: s.id },
        data: { lastRunAt: new Date(), lastRunPassed: passed },
      });
    } catch {
      // record may not exist if saved in-memory only; skip persistence
    }
  }

  const regression = ScenarioLibrary.regress(saved, results);
  return NextResponse.json({ regression, runAt: Date.now() });
}
