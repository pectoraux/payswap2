import { NextResponse } from 'next/server';
import { treasury } from '@/protocol/treasury';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/treasury/status — treasury positions + recommendations. */
export async function GET() {
  const positions = treasury.allPositions();
  const pending = treasury.pendingRecommendations();
  const recommendations = treasury.allRecommendations();
  const totalReserves = positions.reduce((s, p) => s + p.totalReserves, 0);
  return NextResponse.json({
    positions,
    pendingRecommendations: pending,
    recommendations,
    totalReserves,
    positionCount: positions.length,
    pendingCount: pending.length,
    checkedAt: Date.now(),
  });
}
