/**
 * GET /api/runtime/reserves/forecast — forecasts for all reserves. (M-RT-4.)
 * READ-ONLY. Forecasts are hypotheses, never stored as state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  const snapshot = await payswapRuntime.reserveMarket.getMarketSnapshotAll(environment);

  const forecasts = snapshot.reserves.map((r) => ({
    reserveId: r.reserveId,
    asset: r.asset,
    currentUtilization: r.utilization,
    forecast: r.forecast,
  }));

  return NextResponse.json({
    forecasts,
    generatedAt: snapshot.generatedAt,
    note: 'Forecasts are hypotheses, never stored as state. They are recomputed on every call.',
  });
}
