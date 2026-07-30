import { NextRequest, NextResponse } from 'next/server';
import { economicEngine } from '@/economic-engine';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit') ? Number(sp.get('limit')) : 50;
  const proofs = economicEngine.listProofs(limit).map((p) => ({
    id: p.id, goalId: p.goalId, goalName: p.goalName, strategy: p.strategy,
    strategyRationale: p.strategyRationale,
    totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs, trustScore: p.trustScore,
    carbon: p.carbon, risk: p.risk, organizationCount: p.organizationCount,
    plannerScore: p.plannerScore, status: p.status,
    memoryHits: p.memoryHits, predictedSuccessRate: p.predictedSuccessRate,
    createdAt: new Date(p.createdAt).toISOString(),
  }));
  return NextResponse.json({ proofs, count: proofs.length });
}
