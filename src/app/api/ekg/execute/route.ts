import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { execute, getProof, getGoals, type Proof, type Goal, type Constraints } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const proofId = typeof body?.proofId === 'string' ? body.proofId : '';
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Constraints;
  if (!proofId) return NextResponse.json({ error: 'proofId is required' }, { status: 400 });

  const proof = getProof(proofId);
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });
  const goal = getGoals().find((g) => g.id === proof.goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const result = execute(proof as Proof, goal as Goal, constraints);

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'EKG.EXECUTE', resourceType: 'Proof', resourceId: proofId, result: result.status === 'SETTLED' ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({ goalName: goal.name, status: result.status, signature: result.verification.signature, versionedNodes: result.versionedNodes, revenue: result.totalRevenue, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    proofId: result.proofId, goalId: result.goalId, goalName: result.goalName, status: result.status,
    verification: { ...result.verification, verifiedAt: new Date(result.verification.verifiedAt).toISOString() },
    memoryNodeId: result.memoryNodeId, affectedEntities: result.affectedEntities,
    totalRevenue: result.totalRevenue, totalCost: result.totalCost,
    versionedNodes: result.versionedNodes, durationMs: result.durationMs,
  }, { status: 201 });
}
