/**
 * Public Economic API — no auth required. (M-TRUST-5.)
 * Anyone can query PaySwap's current economic state.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = runtime.trust.getPublicEconomicState();
    const health = runtime.trust.getNetworkHealth();
    const verification = runtime.trust.verifyInvariants();

    return NextResponse.json({
      ok: true,
      network: 'PaySwap',
      ...state,
      health: {
        globalScore: health.globalHealthScore,
        reserveCoverage: health.reserveCoverage,
        settlementSuccessRate: health.settlementSuccessRate,
        twinTokenBacking: health.twinTokenBacking,
        solvencyRatio: health.solvencyRatio,
        countries: health.countries,
      },
      verification: {
        allInvariantsHold: verification.allHold,
        invariants: verification.invariants.map((i) => ({ name: i.name, holds: i.holds })),
      },
      disclaimer: 'This data is derived from PaySwap event-sourced runtime. All figures are real-time and auditable.',
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
