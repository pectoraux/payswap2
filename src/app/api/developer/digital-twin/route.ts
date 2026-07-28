/**
 * GET /api/developer/digital-twin
 *
 * Returns the complete Digital Twin state for visualization:
 *   - Liquidity Digital Twin (countries, reserves, LPs, corridors, flows, totals)
 *   - 5-year expansion projection (from runtime.directorate.simulate)
 *   - Current balance sheet (assets, liabilities, solvency)
 *   - Network optimization summary
 *   - Last refreshed timestamp
 *
 * Calls runtime.controlPlane.buildDigitalTwin() (frozen kernel, read-only).
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  try {
    // 1. Build the Liquidity Digital Twin (live snapshot).
    const twin = runtime.controlPlane.buildDigitalTwin();

    // 2. Compute the network optimization (LP density, capital efficiency).
    const network = runtime.controlPlane.optimizeNetwork();

    // 3. Current balance sheet (Assets = Liabilities + Equity).
    const balanceSheet = runtime.ledger.getBalanceSheet();
    const solvency = runtime.ledger.getSolvencyReport();

    // 4. 5-year expansion projection (year-by-year).
    // The task description references runtime.expansion.simulateExpansion(5),
    // but the actual surface is runtime.directorate.simulate({ yearsProjected: 5 }).
    // That returns a StrategicSimulation with yearByYear: YearProjection[].
    const projection = runtime.directorate.simulate({
      description: 'Digital Twin — 5-year network expansion projection',
      yearsProjected: 5,
      openReserves: twin.countries
        .filter((c) => c.maturity === 'stablecoin_only')
        .map((c) => c.country),
      recruitLPs: Math.max(0, 3 * twin.countries.length),
      reduceStablecoins: twin.stablecoinDependency > 0.5 ? 1 : 0,
    });

    // 5. Capital allocations (current recommendations from the control plane).
    const allocations = runtime.controlPlane.allocateCapital();
    const reserveEvolution = runtime.controlPlane.planReserveEvolution();

    // 6. LPs (from runtime.lpRuntime — the canonical LP read model).
    const lps = runtime.lpRuntime.listLPs().map((lp) => ({
      lpId: lp.lpId,
      name: lp.name,
      confidence: lp.confidence,
      riskScore: lp.riskScore,
      totalCapacity: lp.totalCapacity,
      supportedCorridors: lp.supportedCorridors.length,
    }));

    return NextResponse.json({
      ok: true,
      generatedAt: Date.now(),
      twin,
      network,
      balanceSheet,
      solvency,
      projection: {
        simulationId: projection.simulationId,
        scenario: projection.scenario,
        yearsProjected: projection.yearsProjected,
        projectedROI: projection.projectedROI,
        projectedRisk: projection.projectedRisk,
        projectedTwinTokenGrowth: projection.projectedTwinTokenGrowth,
        projectedStablecoinReduction: projection.projectedStablecoinReduction,
        projectedReserveGrowth: projection.projectedReserveGrowth,
        yearByYear: projection.yearByYear,
        recommendation: projection.recommendation,
        confidence: projection.confidence,
        simulatedAt: projection.simulatedAt,
      },
      allocations,
      reserveEvolution,
      lps,
    });
  } catch (err) {
    console.error('[api/developer/digital-twin GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
