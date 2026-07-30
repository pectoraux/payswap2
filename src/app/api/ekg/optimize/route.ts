import { NextRequest, NextResponse } from 'next/server';
import { prove, getGoals, optimize, type Constraints } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const goalId = typeof body?.goalId === 'string' ? body.goalId : '';
  if (!goalId) return NextResponse.json({ error: 'goalId is required' }, { status: 400 });
  const goals = getGoals();
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
  const constraints = (body?.constraints ?? {}) as Constraints;
  const proofs = prove(goal, constraints);
  if (proofs.length === 0) return NextResponse.json({ error: 'No proofs found' }, { status: 422 });
  const result = optimize(proofs);
  return NextResponse.json({
    frontier: result.frontier.map((pp) => ({
      proofId: pp.proof.id, plannerScore: pp.proof.plannerScore,
      cost: pp.proof.totalCost, latencyMs: pp.proof.totalLatencyMs,
      trust: pp.proof.trustScore, carbon: pp.proof.carbon,
      bestAt: pp.bestAt,
    })),
    recommendations: {
      minCost: result.recommendations.minCost ? { proofId: result.recommendations.minCost.proof.id, cost: result.recommendations.minCost.proof.totalCost } : null,
      minLatency: result.recommendations.minLatency ? { proofId: result.recommendations.minLatency.proof.id, latencyMs: result.recommendations.minLatency.proof.totalLatencyMs } : null,
      maxTrust: result.recommendations.maxTrust ? { proofId: result.recommendations.maxTrust.proof.id, trust: result.recommendations.maxTrust.proof.trustScore } : null,
      minCarbon: result.recommendations.minCarbon ? { proofId: result.recommendations.minCarbon.proof.id, carbon: result.recommendations.minCarbon.proof.carbon } : null,
      balanced: result.recommendations.balanced ? { proofId: result.recommendations.balanced.proof.id, score: result.recommendations.balanced.proof.plannerScore } : null,
    },
    utopianPoint: result.utopianPoint,
    totalCandidates: result.totalCandidates,
    frontierSize: result.frontierSize,
    message: `${result.frontierSize} proofs on Pareto frontier (out of ${result.totalCandidates} candidates). Min cost: $${result.recommendations.minCost?.proof.totalCost.toFixed(4) ?? 'N/A'}. Min latency: ${result.recommendations.minLatency?.proof.totalLatencyMs ?? 'N/A'}ms. Max trust: ${result.recommendations.maxTrust?.proof.trustScore ?? 'N/A'}.`,
  }, { status: 201 });
}
