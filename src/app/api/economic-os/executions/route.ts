import { NextRequest, NextResponse } from 'next/server';
import { economicOS } from '@/economic-os';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const settlements = economicOS.listSettlements(limit);
  return NextResponse.json({
    settlements: settlements.map((s) => ({
      id: s.id, graphId: s.graphId, intentId: s.intentId, intentName: s.intentName,
      steps: s.steps.map((st) => ({ ...st, ts: new Date(st.ts).toISOString() })),
      status: s.status, totalRevenue: s.totalRevenue, totalCost: s.totalCost,
      startedAt: new Date(s.startedAt).toISOString(),
      completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : null,
      durationMs: s.durationMs,
    })),
    count: settlements.length,
  });
}
