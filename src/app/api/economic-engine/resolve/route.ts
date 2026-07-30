import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { economicEngine, resolve, engineStore, type EconomicProof } from '@/economic-engine';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serializeProof(p: EconomicProof) {
  return {
    id: p.id, goalId: p.goalId, goalName: p.goalName, strategy: p.strategy,
    strategyRationale: p.strategyRationale,
    nodes: p.nodes, edges: p.edges,
    totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs, trustScore: p.trustScore,
    carbon: p.carbon, risk: p.risk,
    organizationCount: p.organizationCount, opportunisticCount: p.opportunisticCount,
    plannerScore: p.plannerScore, scoreBreakdown: p.scoreBreakdown,
    status: p.status, verification: p.verification,
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
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const goalId = typeof body?.goalId === 'string' ? body.goalId : '';
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Parameters<typeof resolve>[1];

  if (!goalId) return NextResponse.json({ error: 'goalId is required' }, { status: 400 });
  const goal = economicEngine.getGoal(goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const result = resolve(goal, constraints);
  for (const p of result.proofs) engineStore.proofs.unshift(p);
  if (engineStore.proofs.length > 100) engineStore.proofs.length = 100;

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'ECONOMIC_ENGINE.RESOLVED',
        resourceType: 'Goal',
        resourceId: goalId,
        result: 'SUCCESS',
        details: JSON.stringify({ goalName: goal.name, strategiesExplored: result.totalStrategiesExplored, proofsFound: result.proofs.length, bestScore: result.proofs[0]?.plannerScore, planningMs: result.planningMs, actorEmail: actorEmail ?? null }),
      },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    goalId: goal.id, goalName: goal.name,
    proofs: result.proofs.map(serializeProof),
    bestProofId: result.bestProofId,
    totalStrategiesExplored: result.totalStrategiesExplored,
    planningMs: result.planningMs,
  }, { status: 201 });
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();
  const proofs = economicEngine.listProofs(20).map(serializeProof);
  return NextResponse.json({ proofs, count: proofs.length });
}
