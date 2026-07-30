import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { platform, resolveGoal, platformStore, type EconomicProof } from '@/economic-platform';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeProof(p: EconomicProof) {
  return {
    id: p.id, goalId: p.goalId, goalName: p.goalName,
    nodes: p.nodes, edges: p.edges,
    totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs, trustScore: p.trustScore, carbon: p.carbon,
    capabilityCount: p.capabilityCount, providerCount: p.providerCount, providerKinds: p.providerKinds,
    plannerScore: p.plannerScore, scoreBreakdown: p.scoreBreakdown,
    status: p.status, verification: p.verification ? { ...p.verification, verifiedAt: new Date(p.verification.verifiedAt).toISOString() } : undefined,
    memoryHits: p.memoryHits, predictedSuccessRate: p.predictedSuccessRate,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const goalId = typeof body?.goalId === 'string' ? body.goalId : '';
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Parameters<typeof resolveGoal>[1];
  if (!goalId) return NextResponse.json({ error: 'goalId is required' }, { status: 400 });
  const goal = platform.getGoal(goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const proof = resolveGoal(goal, constraints);
  if (!proof) return NextResponse.json({ error: 'Could not resolve goal — no capability path found' }, { status: 422 });
  platformStore.proofs.unshift(proof);
  if (platformStore.proofs.length > 100) platformStore.proofs.length = 100;

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'PLATFORM.RESOLVED', resourceType: 'Goal', resourceId: goalId, result: 'SUCCESS',
        details: JSON.stringify({ goalName: goal.name, capabilities: proof.capabilityCount, providers: proof.providerCount, providerKinds: proof.providerKinds, score: proof.plannerScore, cost: proof.totalCost, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ proof: serializeProof(proof) }, { status: 201 });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const proofs = platform.listProofs(20).map(serializeProof);
  return NextResponse.json({ proofs, count: proofs.length });
}
