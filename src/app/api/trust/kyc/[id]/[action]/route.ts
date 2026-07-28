import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { kycService, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

const STATUS_BY_ACTION: Record<string, string> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  'request-review': 'REVIEW_NEEDED',
};

const AUDIT_ACTION: Record<string, string> = {
  approve: 'trust.kyc.approve',
  reject: 'trust.kyc.reject',
  'request-review': 'trust.kyc.request_review',
};

/**
 * POST /api/trust/kyc/[id]/approve
 * POST /api/trust/kyc/[id]/reject
 * POST /api/trust/kyc/[id]/request-review
 *
 * Body (optional): { notes? }
 */
async function handleAction(
  req: NextRequest,
  params: { id: string; action: string },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => COMPLIANCE_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;

  const { id, action } = params;
  const normalized = action.toLowerCase();
  const trustDecision =
    normalized === 'approve'
      ? ('approved' as const)
      : normalized === 'reject'
      ? ('rejected' as const)
      : null;

  const existing = await kycService.get(id);
  if (!existing) {
    return NextResponse.json(
      { error: 'KYC verification not found' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const notes =
    typeof body?.notes === 'string' && body.notes.trim()
      ? body.notes.trim()
      : undefined;

  let updated;
  if (trustDecision) {
    updated = await kycService.review(id, trustDecision, userId ?? 'unknown', notes);
  } else if (normalized === 'request-review') {
    updated = await kycService.requestReview(id, userId ?? 'unknown', notes);
  } else {
    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  }

  // Mirror to ComplianceReview Prisma model (best-effort).
  const prismaStatus = STATUS_BY_ACTION[normalized];
  if (prismaStatus) {
    try {
      await db.complianceReview.update({
        where: { id },
        data: {
          status: prismaStatus,
          reviewerId: userId ?? null,
          reviewedAt: new Date(),
          notes: notes ?? null,
        },
      });
    } catch {
      // best-effort — the in-memory record is the source of truth for the
      // trust engine. The Prisma mirror may not exist if the verification
      // was created purely in-memory.
      try {
        await db.complianceReview.create({
          data: {
            id,
            entityType: existing.type.toUpperCase(),
            entityId: existing.entityId,
            type: existing.type.toUpperCase(),
            status: prismaStatus,
            data: JSON.stringify({
              documents: existing.documents,
              verifications: existing.verifications,
            }),
            reviewerId: userId ?? null,
            reviewedAt: new Date(),
            notes: notes ?? null,
          },
        });
      } catch {
        // best-effort
      }
    }
  }

  await complianceAuditTrail.record({
    action: AUDIT_ACTION[normalized],
    actorId: userId ?? 'unknown',
    entityType: existing.type,
    entityId: existing.entityId,
    details: {
      verificationId: id,
      kycType: existing.type,
      previousStatus: existing.status,
      nextStatus: updated.status,
      notes,
    },
    result: 'success',
  });

  return NextResponse.json({ verification: updated });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await ctx.params;
  return handleAction(req, { id, action });
}
