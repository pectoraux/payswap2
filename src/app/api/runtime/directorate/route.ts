/**
 * GET /api/runtime/directorate — Global Economic Directorate report.
 * (M-ECO-36.)
 *
 * Returns the complete directorate report:
 *   - All director recommendations (treasury, corridor, LP, FX, settlement, country)
 *   - Global plan (capital reallocation, expansion plans)
 *   - Economic memory
 *   - Network status
 *
 * POST: simulate a multi-year strategy.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = runtime.directorate.getReport();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const simulation = runtime.directorate.simulate({
      description: body.description || 'Strategic simulation',
      openReserves: body.openReserves,
      recruitLPs: body.recruitLPs,
      reduceStablecoins: body.reduceStablecoins,
      yearsProjected: body.yearsProjected || 5,
    });
    return NextResponse.json({ ok: true, ...simulation });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
