import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { prove, getGoals, listProofs, type Proof, type Constraints } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeProofStep(s: import('@/ekg').ProofStep): import('@/ekg').ProofStep {
  return { ...s, children: s.children.map(serializeProofStep) };
}
function serializeProof(p: Proof) {
  return {
    id: p.id, goalId: p.goalId, goalName: p.goalName,
    root: serializeProofStep(p.root),
    totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs, trustScore: p.trustScore, carbon: p.carbon, risk: p.risk,
    entityLabels: p.entityLabels, capabilityCount: p.capabilityCount, entityCount: p.entityCount,
    plannerScore: p.plannerScore, scoreBreakdown: p.scoreBreakdown,
    status: p.status, verification: p.verification, simulation: p.simulation,
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
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Constraints;
  if (!goalId) return NextResponse.json({ error: 'goalId is required' }, { status: 400 });

  const goals = getGoals();
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const proofs = prove(goal, constraints);
  // Store proofs so they can be simulated/executed later
  const { proofs: proofStore } = await import('@/ekg/verifier');
  for (const p of proofs) proofStore.unshift(p);
  if (proofStore.length > 50) proofStore.length = 50;

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'EKG.PROVE', resourceType: 'Goal', resourceId: goalId, result: 'SUCCESS',
        details: JSON.stringify({ goalName: goal.name, proofsFound: proofs.length, bestScore: proofs[0]?.plannerScore, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ goalId: goal.id, goalName: goal.name, proofs: proofs.map(serializeProof), bestProofId: proofs[0]?.id ?? '' }, { status: 201 });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const proofs = listProofs(20).map(serializeProof);
  return NextResponse.json({ proofs, count: proofs.length });
}
