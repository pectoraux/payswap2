import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

const ACTIONS = new Set(['ASSIGN', 'ESCALATE', 'APPROVE', 'REJECT', 'CLOSE']);

/** Map an action verb to the resulting case status. */
const STATUS_BY_ACTION: Record<string, string> = {
  ASSIGN: 'OPEN', // stays open but is now assigned
  ESCALATE: 'ESCALATED',
  APPROVE: 'APPROVED',
  REJECT: 'REJECTED',
  CLOSE: 'CLOSED',
};

const AUDIT_ACTION: Record<string, string> = {
  ASSIGN: 'COMPLIANCE.CASE_ASSIGN',
  ESCALATE: 'COMPLIANCE.CASE_ESCALATE',
  APPROVE: 'COMPLIANCE.CASE_APPROVE',
  REJECT: 'COMPLIANCE.CASE_REJECT',
  CLOSE: 'COMPLIANCE.CASE_CLOSE',
};

/**
 * PATCH /api/compliance/cases/[id]
 *
 * Update a compliance case. Body:
 *   { action: 'ASSIGN' | 'ESCALATE' | 'APPROVE' | 'REJECT' | 'CLOSE',
 *     assignee?: string,
 *     notes?: string }
 *
 * Each action flips the case status (except ASSIGN which keeps it OPEN but
 * records the reviewer) and writes an AuditLog entry.
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
      { error: 'Case ID is required' },
      { status: 400 },
    );
  }

  const existing = await db.complianceReview.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }
  if (existing.type !== 'CASE') {
    return NextResponse.json(
      { error: 'Resource is not a compliance case' },
      { status: 400 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!ACTIONS.has(action)) {
    return NextResponse.json(
      {
        error:
          "action must be one of 'ASSIGN', 'ESCALATE', 'APPROVE', 'REJECT', 'CLOSE'",
      },
      { status: 400 },
    );
  }

  const assignee =
    typeof body?.assignee === 'string' ? body.assignee.trim() : '';
  if (action === 'ASSIGN' && !assignee) {
    return NextResponse.json(
      { error: 'assignee is required when action is ASSIGN' },
      { status: 400 },
    );
  }
  const notes =
    typeof body?.notes === 'string' && body.notes.trim()
      ? body.notes.trim()
      : null;

  const patch: {
    status: string;
    reviewerId?: string | null;
    reviewedAt?: Date;
    notes?: string | null;
  } = {
    status: STATUS_BY_ACTION[action],
  };

  if (action === 'ASSIGN') {
    patch.reviewerId = assignee;
  } else if (action === 'CLOSE' || action === 'APPROVE' || action === 'REJECT') {
    patch.reviewedAt = new Date();
    if (notes) patch.notes = notes;
  } else if (action === 'ESCALATE') {
    if (notes) patch.notes = notes;
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
          assignee: assignee || undefined,
          notes,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ case: updated });
}
