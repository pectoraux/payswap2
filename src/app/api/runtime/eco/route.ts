/**
 * GET /api/runtime/eco — economic health dashboard. (M-ECO-31.)
 *
 * Returns the complete economic intelligence dashboard:
 *   - Country economic health scores
 *   - Corridor intelligence + classifications
 *   - LP rankings (expected cost, not just spread)
 *   - Reserve expansion recommendations
 *   - Treasury policy decisions (buy/sell/hold)
 *   - Predictive marketplace opportunities
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dashboard = runtime.intelligence.getDashboard();
    return NextResponse.json({ ok: true, ...dashboard });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
