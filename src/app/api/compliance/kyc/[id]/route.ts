import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

const ACTIONS = new Set(['APPROVE', 'REJECT', 'REQUEST_REVIEW']);

/** Map an action verb to the resulting KYC review status. */
const STATUS_BY_ACTION: Record<string, string> = {
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  REQUEST_REVIEW: 'REVIEW_NEEDED',
};

const AUDIT_ACTION: Record<string, string> = {
  APPROVE: 'COMPLIANCE.KYC_APPROVE',
  REJECT: 'COMPLIANCE.KYC_REJECT',
  REQUEST_REVIEW: 'COMPLIANCE.KYC_REQUEST_REVIEW',
};

/**
 * PATCH /api/compliance/kyc/[id]
 *
 * Update a KYC compliance review's status. Body:
 *   { action: 'APPROVE' | 'REJECT' | 'REQUEST_REVIEW',
 *     notes?: string }
 *
 * Each action flips the review status, stamps the reviewer + reviewedAt
 * timestamp, and writes an AuditLog entry so the KYC workflow is fully
 * traceable. PENDING reviews can be approved / rejected / flagged for
 * re-review. REVIEW_NEEDED reviews can be approved / rejected once the
 * additional information is in. APPROVED / REJECTED are terminal.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'KYC review ID is required' },
      { status: 400 },
    );
  }

  const existing = await db.complianceReview.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json(
      { error: 'KYC review not found' },
      { status: 404 },
    );
  }
  if (existing.type !== 'KYC') {
    return NextResponse.json(
      { error: 'Resource is not a KYC review' },
      { status: 400 },
    );
  }

  const terminal = new Set(['APPROVED', 'REJECTED']);
  if (terminal.has((existing.status || '').toUpperCase())) {
    return NextResponse.json(
      {
        error: `KYC review is already ${existing.status} (terminal state)`,
      },
      { status: 409 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!ACTIONS.has(action)) {
    return NextResponse.json(
      {
        error:
          "action must be one of 'APPROVE', 'REJECT', 'REQUEST_REVIEW'",
      },
      { status: 400 },
    );
  }

  const notes =
    typeof body?.notes === 'string' && body.notes.trim()
      ? body.notes.trim()
      : null;

  const patch: {
    status: string;
    reviewerId: string | null;
    reviewedAt?: Date;
    notes?: string | null;
  } = {
    status: STATUS_BY_ACTION[action],
    reviewerId: userId ?? null,
  };

  // APPROVE / REJECT are terminal — stamp reviewedAt. REQUEST_REVIEW keeps
  // the review open (reviewedAt stays null until final disposition).
  if (action === 'APPROVE' || action === 'REJECT') {
    patch.reviewedAt = new Date();
  }
  if (notes) {
    patch.notes = notes;
  }

  const updated = await db.complianceReview.update({
    where: { id },
    data: patch,
  });

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: AUDIT_ACTION[action],
        resourceType: 'ComplianceReview',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          action,
          previousStatus: existing.status,
          nextStatus: patch.status,
          entityType: existing.entityType,
          entityId: existing.entityId,
          notes,
        }),
      },
    });
  } catch {
    // best-effort — never block on audit
  }

  return NextResponse.json({ review: updated });
}
