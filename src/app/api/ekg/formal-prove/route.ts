import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { prove, getGoals, issueCertificate, certificates, type Goal, type Constraints } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 3: Formal proof. prove(goal) → Proof[] → issueCertificate(bestProof).
 * Produces a machine-verifiable FormalProofCertificate with 12 named invariants.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as { id?: string })?.id as string | undefined;
  const actorEmail = (session.user as { email?: string })?.email as string | undefined;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const goalId = typeof body?.goalId === 'string' ? body.goalId : '';
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Constraints;
  if (!goalId) return NextResponse.json({ error: 'goalId is required' }, { status: 400 });

  const goal = getGoals().find((g) => g.id === goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });

  const proofs = prove(goal as Goal, constraints);
  if (proofs.length === 0) return NextResponse.json({ error: 'No proofs found — goal cannot be satisfied' }, { status: 422 });

  // Issue a formal certificate for the best proof
  const certificate = issueCertificate(proofs[0], goal as Goal, constraints);
  certificates.unshift(certificate);
  if (certificates.length > 50) certificates.length = 50;

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'EKG.FORMAL_PROVE', resourceType: 'Goal', resourceId: goalId, result: certificate.valid ? 'SUCCESS' : 'ERROR',
        details: JSON.stringify({ goalName: goal.name, certificateId: certificate.id, valid: certificate.valid, invariants: certificate.invariants.length, passing: certificate.invariants.filter((i) => i.holds).length, fingerprint: certificate.fingerprint, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    certificateId: certificate.id,
    goalId: certificate.goalId,
    goalName: certificate.goalName,
    statement: certificate.statement,
    valid: certificate.valid,
    fingerprint: certificate.fingerprint,
    invariants: certificate.invariants.map((i) => ({ name: i.name, holds: i.holds, severity: i.severity, explanation: i.explanation })),
    verificationChain: certificate.verificationChain,
    decomposition: certificate.decomposition,
    proofsFound: proofs.length,
    bestPlannerScore: proofs[0].plannerScore,
  }, { status: 201 });
}
