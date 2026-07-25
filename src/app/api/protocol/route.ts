import { NextRequest, NextResponse } from 'next/server';
import { simulationEngine, type SimulationScenario } from '@/kernel';
import { protocolScenarios, CONSTITUTIONAL_TESTS, type ProtocolScenario } from '@/protocol/scenarios';
import { runProtocolScenario, runAllProtocolScenarios, verifyConstitutional } from '@/protocol/runner';
import { createFiatProof, computeConfidence } from '@/protocol/economics/fiat-proof';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/protocol — list all 20 protocol scenarios. */
export async function GET() {
  const scenarios = protocolScenarios();
  return NextResponse.json({
    scenarios: scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      expectedBehavior: s.expectedBehavior,
      validates: s.validates,
    })),
    constitutionalTests: CONSTITUTIONAL_TESTS,
  });
}

/** POST /api/protocol — run a specific protocol scenario by ID, or run all. */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const scenarioId = body?.scenarioId as string;
  const runAll = body?.runAll === true;

  if (runAll) {
    // Run all 20 scenarios — the architecture proof
    const scenarios = protocolScenarios();
    const results = runAllProtocolScenarios(scenarios);
    const summary = results.map(({ scenario, result, error }) => {
      if (error || !result) {
        return { scenarioId: scenario.id, name: scenario.name, passed: false, error, settled: false };
      }
      const verification = verifyConstitutional(result);
      return {
        scenarioId: scenario.id,
        name: scenario.name,
        category: scenario.category,
        passed: verification.passed,
        settled: result.settled,
        constitutionPassed: result.constitution.passed,
        cost: result.plan.metrics.costPercent,
        risk: result.plan.metrics.riskScore,
        time: result.plan.metrics.settlementTimeLabel,
        candidates: result.solverCandidates.length,
        transitions: result.transitions.length,
        escrowEntries: result.protocol.escrowEntries.length,
        collateralEntries: result.protocol.collateralEntries.length,
        fiatProofs: result.fiatProofs.length,
        validates: scenario.validates,
        verifiedInvariants: verification.checks.filter((c) => c.passed).length,
        totalInvariants: verification.checks.length,
      };
    });
    const passed = summary.filter((s) => s.passed).length;
    return NextResponse.json({ summary, passed, total: summary.length, constitutionalTests: CONSTITUTIONAL_TESTS });
  }

  // Run a single scenario
  const scenarios = protocolScenarios();
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    return NextResponse.json({ error: `Scenario ${scenarioId} not found` }, { status: 404 });
  }

  const result = runProtocolScenario(scenario);
  const verification = verifyConstitutional(result);

  return NextResponse.json({ result, verification, scenario });
}
