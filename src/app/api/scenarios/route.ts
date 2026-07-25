import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { simulationEngine, ScenarioLibrary, type SimulationScenario, type SimulationResult } from '@/kernel';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/scenarios — list all saved scenarios. */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  // Load from DB into the in-memory library.
  const records = await db.savedScenarioRecord.findMany({ orderBy: { createdAt: 'desc' } });
  for (const r of records) {
    const scenario = JSON.parse(r.scenario) as SimulationScenario;
    ScenarioLibrary.save(scenario, {
      resultHash: r.baselineHash,
      plan: { metrics: { costPercent: r.baselineCost, settlementTimeMs: r.baselineTime, riskScore: r.baselineRisk, confidence: r.baselineConf } },
    } as SimulationResult, r.category);
  }
  return NextResponse.json({ scenarios: ScenarioLibrary.list() });
}

/** POST /api/scenarios — save a scenario (runs it first to capture baseline). */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const scenario = body?.scenario as SimulationScenario;
  const category = (body?.category as string) ?? 'Custom';
  if (!scenario) return NextResponse.json({ error: 'scenario required' }, { status: 400 });

  // Run to capture baseline metrics.
  const result = simulationEngine.run(scenario);
  const saved = ScenarioLibrary.save(scenario, result, category);

  // Persist to DB (upsert).
  await db.savedScenarioRecord.upsert({
    where: { scenarioId: saved.id },
    create: {
      scenarioId: saved.id,
      name: saved.name,
      description: saved.description,
      category: saved.category,
      scenario: JSON.stringify(saved.scenario),
      baselineHash: saved.baselineHash,
      baselineCost: saved.baselineMetrics.costPercent,
      baselineTime: saved.baselineMetrics.settlementTimeMs,
      baselineRisk: saved.baselineMetrics.riskScore,
      baselineConf: saved.baselineMetrics.confidence,
      lastRunAt: new Date(),
      lastRunPassed: true,
    },
    update: {
      name: saved.name,
      description: saved.description,
      category: saved.category,
      scenario: JSON.stringify(saved.scenario),
      baselineHash: saved.baselineHash,
      baselineCost: saved.baselineMetrics.costPercent,
      baselineTime: saved.baselineMetrics.settlementTimeMs,
      baselineRisk: saved.baselineMetrics.riskScore,
      baselineConf: saved.baselineMetrics.confidence,
      lastRunAt: new Date(),
      lastRunPassed: true,
    },
  });

  return NextResponse.json({ saved, result });
}

/** DELETE /api/scenarios?id=... — remove a saved scenario. */
export async function DELETE(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  ScenarioLibrary.remove(id);
  await db.savedScenarioRecord.deleteMany({ where: { scenarioId: id } });
  return NextResponse.json({ removed: id });
}
