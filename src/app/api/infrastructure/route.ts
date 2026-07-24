import { NextResponse } from 'next/server';
import { infrastructureScenarios, runInfraScenario } from '@/domains/infrastructure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const scenarios = infrastructureScenarios();
  return NextResponse.json({
    scenarios: scenarios.map((s) => ({ id: s.id, name: s.name, description: s.description, expectedBehavior: s.expectedBehavior, validates: s.validates })),
    domain: 'Infrastructure Orchestration (non-financial, non-logistics)',
    kernelShared: true,
  });
}

export async function POST() {
  const scenarios = infrastructureScenarios();
  const results = scenarios.map((s) => {
    try { return runInfraScenario(s); }
    catch (e) { return { scenarioId: s.id, scenarioName: s.name, feasible: false, converged: false, error: e instanceof Error ? e.message : 'Unknown' }; }
  });
  const converged = results.filter((r: any) => r.converged).length;
  return NextResponse.json({ results, summary: { total: results.length, converged, kernelShared: true, zeroKernelChanges: true } });
}
