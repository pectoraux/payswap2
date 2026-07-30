import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { execute, getProof, getGoals, type Proof, type Goal, type Constraints } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 2: Idempotency. Safe retry forever. Exactly-once settlement.
 *
 * POST this with an idempotencyKey. If the key was seen before, return the
 * cached result — do NOT re-execute. This means:
 *
 *   POST /idempotent-execute {proofId, idempotencyKey: "abc"}
 *   POST /idempotent-execute {proofId, idempotencyKey: "abc"}
 *   POST /idempotent-execute {proofId, idempotencyKey: "abc"}
 *
 * → exactly ONE execution, three identical responses.
 */

interface CachedExecution {
  idempotencyKey: string;
  result: import('@/ekg').ExecutionResult;
  cachedAt: number;
}

const globalForIdempotency = globalThis as unknown as {
  __PAYSWAP_EKG_IDEMPOTENCY__?: Map<string, CachedExecution>;
};

const idempotencyCache: Map<string, CachedExecution> =
  globalForIdempotency.__PAYSWAP_EKG_IDEMPOTENCY__ ?? new Map();
if (!globalForIdempotency.__PAYSWAP_EKG_IDEMPOTENCY__) {
  globalForIdempotency.__PAYSWAP_EKG_IDEMPOTENCY__ = idempotencyCache;
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
  const proofId = typeof body?.proofId === 'string' ? body.proofId : '';
  const idempotencyKey = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '';
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Constraints;
  if (!proofId) return NextResponse.json({ error: 'proofId is required' }, { status: 400 });
  if (!idempotencyKey) return NextResponse.json({ error: 'idempotencyKey is required (required for exactly-once semantics)' }, { status: 400 });

  // ── IDEMPOTENCY CHECK ──
  // If we've seen this key before, return the cached result — do NOT re-execute.
  const cached = idempotencyCache.get(idempotencyKey);
  if (cached) {
    return NextResponse.json({
      ...cached.result,
      idempotent: true,
      cachedAt: new Date(cached.cachedAt).toISOString(),
      message: '✓ Idempotent — returned cached result (no re-execution)',
    });
  }

  // ── EXECUTE (first time with this key) ──
  const proof = getProof(proofId);
  if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });
  const goal = getGoals().find((g) => g.id === proof.goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const result = execute(proof as Proof, goal as Goal, constraints);

  // Cache the result for future retries with the same key
  idempotencyCache.set(idempotencyKey, { idempotencyKey, result, cachedAt: Date.now() });

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'EKG.IDEMPOTENT_EXECUTE', resourceType: 'Proof', resourceId: proofId, result: result.status === 'SETTLED' ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({ idempotencyKey, goalName: goal.name, status: result.status, signature: result.verification.signature, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    ...result,
    idempotent: false,
    idempotencyKey,
    message: '✓ Executed + cached — future retries with this key return the cached result (exactly-once)',
  }, { status: 201 });
}
