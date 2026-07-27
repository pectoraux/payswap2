/**
 * GET /api/runtime/projections/treasury — health metrics for the treasury
 * projection. (M-RT-24, Treasury Kernel.)
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await runtime.treasuryBackfill.status();
    const health = await runtime.treasury.health(status.prismaCount);
    return NextResponse.json({ ok: true, ...health });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
