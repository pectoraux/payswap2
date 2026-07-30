import { NextResponse } from 'next/server';
import { listProofs } from '@/ekg';
import { requireSession, unauthorized } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const proofs = listProofs(20).map((p) => ({
    id: p.id, goalId: p.goalId, goalName: p.goalName,
    totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs, trustScore: p.trustScore,
    carbon: p.carbon, risk: p.risk, entityLabels: p.entityLabels,
    capabilityCount: p.capabilityCount, entityCount: p.entityCount,
    plannerScore: p.plannerScore, status: p.status,
    verificationSignature: p.verification?.signature,
    memoryHits: p.memoryHits, predictedSuccessRate: p.predictedSuccessRate,
    createdAt: new Date(p.createdAt).toISOString(),
  }));
  return NextResponse.json({ proofs, count: proofs.length });
}
