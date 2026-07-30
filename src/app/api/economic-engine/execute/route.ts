import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicEngine, executeProof, engineStore, type EconomicProof, type ConstraintBundle, type Goal } from '@/economic-engine';
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
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const proofId = typeof body?.proofId === 'string' ? body.proofId : '';
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as ConstraintBundle;
  if (!proofId) return NextResponse.json({ error: 'proofId is required' }, { status: 400 });

  const proof = economicEngine.getProof(proofId) ?? engineStore.proofs.find((p) => p.id === proofId);
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });

  const goal = economicEngine.getGoal(proof.goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const result = executeProof(proof, goal, constraints);

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'ECONOMIC_ENGINE.EXECUTED',
        resourceType: 'EconomicProof',
        resourceId: proofId,
        result: result.status === 'SETTLED' ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({ goalName: goal.name, strategy: proof.strategy, status: result.status, revenue: result.totalRevenue, cost: result.totalCost, verification: { allPassed: result.verification.allPassed, critical: result.verification.criticalFailures, major: result.verification.majorFailures }, actorEmail: actorEmail ?? null }),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    proofId: result.proofId, goalId: result.goalId, goalName: result.goalName,
    strategy: result.strategy, status: result.status,
    verification: {
      ...result.verification,
      verifiedAt: new Date(result.verification.verifiedAt).toISOString(),
    },
    memoryEntry: {
      ...result.memoryEntry,
      executedAt: new Date(result.memoryEntry.executedAt).toISOString(),
    },
    organizationIds: result.organizationIds,
    totalRevenue: result.totalRevenue, totalCost: result.totalCost,
    durationMs: result.durationMs,
  }, { status: 201 });
}
