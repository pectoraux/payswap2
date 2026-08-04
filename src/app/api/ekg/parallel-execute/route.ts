import { NextRequest, NextResponse } from 'next/server';
import { getProof, getGoals, executeParallel, executionSummary, startTrace, type Proof, type Goal, type ProofStep } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const proofId = typeof body?.proofId === 'string' ? body.proofId : '';
  if (!proofId) return NextResponse.json({ error: 'proofId is required' }, { status: 400 });
  const proof = getProof(proofId);
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });

  // Create a trace for this execution
  const { traceId, rootSpan } = startTrace(`parallel-execute: ${proof.goalName}`);

  // Execute with a mock step executor (in production, this invokes real capabilities)
  const result = await executeParallel(
    proof,
    async (step: ProofStep) => {
      // Mock execution — in production, this calls the capability provider
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 50));
      return { stepId: step.id, status: 'ok', capability: step.capabilityName };
    },
    rootSpan,
  );

  rootSpan.end(result.status === 'completed' ? 'ok' : 'error', undefined, {
    completedCount: result.completedCount,
    failedCount: result.failedCount,
    parallelBranches: result.parallelBranches,
    totalDurationMs: result.totalDurationMs,
  });

  return NextResponse.json({
    executionId: result.executionId,
    proofId: result.proofId,
    status: result.status,
    totalDurationMs: result.totalDurationMs,
    parallelBranches: result.parallelBranches,
    maxDepth: result.maxDepth,
    completedCount: result.completedCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    traceId,
    summary: executionSummary(result),
    message: `✓ ${executionSummary(result)}`,
  }, { status: 201 });
}
