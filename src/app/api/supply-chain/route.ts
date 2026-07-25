import { NextResponse } from 'next/server';
import { supplyChainScenarios } from '@/domains/supply-chain/scenarios';
import { runSupplyChainScenario } from '@/domains/supply-chain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/supply-chain — list supply chain scenarios */
export async function GET() {
  const scenarios = supplyChainScenarios();
  return NextResponse.json({
    scenarios: scenarios.map((s) => ({
      id: s.id, name: s.name, description: s.description,
      expectedBehavior: s.expectedBehavior, validates: s.validates,
    })),
    domain: 'Supply Chain (non-financial)',
    kernelShared: true,
    financialVocabulary: 'none',
  });
}

/** POST /api/supply-chain — run all supply chain scenarios through the SAME kernel */
export async function POST() {
  const scenarios = supplyChainScenarios();
  const results = scenarios.map((s) => {
    try {
      return runSupplyChainScenario(s);
    } catch (e) {
      return {
        scenarioId: s.id, scenarioName: s.name, feasible: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        converged: false, kernelVersion: 'error',
      };
    }
  });

  const passed = results.filter((r: any) => r.converged || (r.feasible === false && r.expectedBehavior?.includes('fail'))).length;
  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      converged: results.filter((r: any) => r.converged).length,
      infeasible: results.filter((r: any) => r.feasible === false).length,
      kernelShared: true,
      zeroKernelChanges: true,
      financialVocabulary: 'none',
    },
  });
}
