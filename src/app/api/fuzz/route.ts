import { NextRequest, NextResponse } from 'next/server';
import { fuzz } from '@/protocol/fuzz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/fuzz — run continuous fuzzing. Body: { count: number } */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const count = Math.min(body?.count ?? 50, 500); // cap at 500 for response size

  const { results, summary } = fuzz(count);

  return NextResponse.json({
    summary,
    results: results.map((r) => ({
      iteration: r.iteration,
      scenarioName: r.scenarioName,
      settled: r.settled,
      constitutionPassed: r.constitutionPassed,
      deterministic: r.deterministic,
      obligationsConverged: r.obligationsConverged,
      ledgerBalanced: r.ledgerBalanced,
      noDoubleSettlement: r.noDoubleSettlement,
      noAssetCreation: r.noAssetCreation,
      noExposureOverflow: r.noExposureOverflow,
      replayIdentical: r.replayIdentical,
      errors: r.errors,
      durationMs: r.durationMs,
    })),
  });
}
