import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  claimsService,
  type ResolutionDecision,
} from '@/claims';
import {
  requireSession,
  unauthorized,
  forbidden,
  requireAdminSession,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DECISIONS: ResolutionDecision[] = ['approved', 'rejected', 'vetoed'];

/**
 * POST /api/claims/[id]/resolve
 *
 * Admin resolves / vetoes a claim. This is the override path — community
 * voting tallies are recorded in the resolution but the admin's decision is
 * final.
 *
 * Body: { decision: 'approved' | 'rejected' | 'vetoed', notes?: string }
 *
 * Auth: ADMIN / SUPER_ADMIN only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();
  const actorEmail = (session.user as any)?.email as string | undefined;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Claim id is required' }, { status: 400 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const decisionRaw =
    typeof body?.decision === 'string' ? body.decision : '';
  const notes =
    typeof body?.notes === 'string' ? body.notes.trim() : undefined;

  if (!VALID_DECISIONS.includes(decisionRaw as ResolutionDecision)) {
    return NextResponse.json(
      { error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const decision: ResolutionDecision = decisionRaw as ResolutionDecision;
  if (notes && notes.length > 5000) {
    return NextResponse.json(
      { error: 'notes must be ≤ 5000 chars' },
      { status: 400 },
    );
  }

  const claim = claimsService.get(id);
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  }
  if (claim.status === 'resolved') {
    return NextResponse.json(
      { error: 'Claim is already resolved' },
      { status: 409 },
    );
  }

  const resolved = claimsService.resolve(id, {
    decision,
    notes,
    resolvedByUserId: userId,
    resolvedByEmail: actorEmail,
  });
  if (!resolved) {
    return NextResponse.json(
      { error: 'Failed to resolve claim' },
      { status: 500 },
    );
  }

  // Audit log.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'CLAIM_RESOLVED',
        resourceType: 'Claim',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          claimId: id,
          decision,
          notes: notes?.slice(0, 500) ?? null,
          communityTally: resolved.resolution?.communityTally,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    claim: {
      ...resolved,
      createdAt: new Date(resolved.createdAt).toISOString(),
      updatedAt: new Date(resolved.updatedAt).toISOString(),
      resolvedAt: resolved.resolvedAt
        ? new Date(resolved.resolvedAt).toISOString()
        : null,
      evidence: resolved.evidence.map((e) => ({
        ...e,
        submittedAt: new Date(e.submittedAt).toISOString(),
      })),
      votes: resolved.votes.map((v) => ({
        ...v,
        votedAt: new Date(v.votedAt).toISOString(),
      })),
      resolution: resolved.resolution
        ? {
            ...resolved.resolution,
            resolvedAt: new Date(
              resolved.resolution.resolvedAt,
            ).toISOString(),
          }
        : null,
    },
  });
}
