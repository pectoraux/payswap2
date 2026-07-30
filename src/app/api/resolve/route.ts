import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { prove, simulate, getGoals, issueCertificate, getProof, type Goal, type Constraints } from '@/ekg';
import { compileDSL } from '@/ekg';
import { requireSession, requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PHASE 8: The universal resolve() API. The primary developer programming model.
 *
 *   POST /api/resolve
 *   {
 *     "goal": "goalId" | { "dsl": "goal Name\n  produces\n    ..." },
 *     "constraints": { "budget": 50, "minTrust": 80, ... },
 *     "formal": true,        // issue a formal certificate?
 *     "simulate": true       // simulate the best proof?
 *   }
 *
 *   → {
 *       "proofs": [...],           // ranked proofs
 *       "best": proof,             // highest-scoring proof
 *       "certificate": {...},      // formal certificate (if formal=true)
 *       "simulation": {...},       // simulation result (if simulate=true)
 *       "goal": { id, name, ... }, // the resolved goal
 *     }
 *
 * This is the one API developers use. Everything else is implementation.
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

  const goalInput = body?.goal;
  const constraints = (body?.constraints && typeof body.constraints === 'object' ? body.constraints : {}) as Constraints;
  const wantFormal = body?.formal !== false; // default true
  const wantSimulate = body?.simulate === true; // default false

  // ── Resolve the goal ──
  let goal: Goal | null = null;
  let dslErrors: string[] = [];

  if (typeof goalInput === 'string') {
    // goalInput is a goal id
    goal = getGoals().find((g) => g.id === goalInput) ?? null;
    if (!goal) return NextResponse.json({ error: `Goal not found: ${goalInput}` }, { status: 404 });
  } else if (typeof goalInput === 'object' && goalInput !== null) {
    const goalObj = goalInput as Record<string, unknown>;
    if (typeof goalObj.dsl === 'string') {
      // Compile DSL
      const compiled = compileDSL(goalObj.dsl);
      if (compiled.parseErrors.length > 0 || compiled.compileErrors.length > 0) {
        dslErrors = [...compiled.parseErrors, ...compiled.compileErrors];
        return NextResponse.json({ error: 'DSL compilation failed', parseErrors: compiled.parseErrors, compileErrors: compiled.compileErrors }, { status: 422 });
      }
      goal = compiled.goal;
    } else if (typeof goalObj.id === 'string') {
      goal = getGoals().find((g) => g.id === goalObj.id) ?? null;
      if (!goal) return NextResponse.json({ error: `Goal not found: ${goalObj.id}` }, { status: 404 });
    } else {
      return NextResponse.json({ error: 'goal must be a goalId string, or { dsl: "..." }, or { id: "..." }' }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: 'goal is required (goalId string, { dsl: "..." }, or { id: "..." })' }, { status: 400 });
  }

  // ── Prove ──
  if (!goal) return NextResponse.json({ error: 'Goal could not be resolved' }, { status: 422 });
  const resolvedGoal: Goal = goal;
  const proofs = prove(resolvedGoal, constraints);
  if (proofs.length === 0) {
    return NextResponse.json({
      goal: { id: resolvedGoal.id, name: resolvedGoal.name },
      proofs: [],
      message: 'No proofs found — the goal cannot be satisfied under the given constraints',
    }, { status: 422 });
  }

  const best = proofs[0];

  // ── Optional: formal certificate ──
  let certificate: ReturnType<typeof issueCertificate> | undefined;
  if (wantFormal) {
    certificate = issueCertificate(best, resolvedGoal, constraints);
  }

  // ── Optional: simulation ──
  let simulation: ReturnType<typeof simulate> | undefined;
  if (wantSimulate) {
    simulation = simulate(best);
  }

  try {
    await db.auditLog.create({
      data: { userId: userId ?? null, action: 'RESOLVE.UNIVERSAL', resourceType: 'Goal', resourceId: resolvedGoal.id, result: 'SUCCESS',
        details: JSON.stringify({ goalName: resolvedGoal.name, proofsFound: proofs.length, bestScore: best.plannerScore, formal: wantFormal, simulated: wantSimulate, certificateValid: certificate?.valid, actorEmail: actorEmail ?? null }) },
    });
  } catch { /* best-effort */ }

  // Serialize the best proof's tree
  const serializeStep = (s: typeof best.root) => ({ ...s, children: s.children.map(serializeStep) });

  return NextResponse.json({
    goal: { id: resolvedGoal.id, name: resolvedGoal.name, description: resolvedGoal.description, targetAsset: resolvedGoal.targetAsset },
    proofs: proofs.map((p) => ({
      id: p.id, plannerScore: p.plannerScore, totalCost: p.totalCost, totalLatencyMs: p.totalLatencyMs,
      trustScore: p.trustScore, carbon: p.carbon, risk: p.risk,
      capabilityCount: p.capabilityCount, entityCount: p.entityCount, entityLabels: p.entityLabels,
      status: p.status, memoryHits: p.memoryHits, predictedSuccessRate: p.predictedSuccessRate,
    })),
    best: {
      ...best,
      root: serializeStep(best.root),
    },
    certificate: certificate ? {
      id: certificate.id, valid: certificate.valid, fingerprint: certificate.fingerprint,
      statement: certificate.statement,
      invariants: certificate.invariants.map((i) => ({ name: i.name, holds: i.holds, severity: i.severity, explanation: i.explanation })),
    } : undefined,
    simulation: simulation ? {
      estimatedCost: simulation.estimatedCost, estimatedLatencyMs: simulation.estimatedLatencyMs,
      successProbability: simulation.successProbability, counterfactual: simulation.counterfactual,
      projectedStateChanges: simulation.projectedStateChanges.length,
    } : undefined,
    message: `✓ Resolved: ${proofs.length} proofs found. Best score: ${best.plannerScore}. ${certificate ? `Certificate ${certificate.valid ? 'valid' : 'INVALID'}.` : ''} ${simulation ? `Simulated ${simulation.successProbability * 100}% success.` : ''}`,
  }, { status: 201 });
}
