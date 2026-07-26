import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

const ACTIONS = new Set(['INVESTIGATE', 'ESCALATE', 'CLOSE', 'SAR']);

/** Map an action verb to the resulting alert status. */
const STATUS_BY_ACTION: Record<string, string> = {
  INVESTIGATE: 'INVESTIGATING',
  ESCALATE: 'ESCALATED',
  CLOSE: 'CLOSED',
  SAR: 'SAR_FILED',
};

const AUDIT_ACTION: Record<string, string> = {
  INVESTIGATE: 'COMPLIANCE.ALERT_INVESTIGATE',
  ESCALATE: 'COMPLIANCE.ALERT_ESCALATE',
  CLOSE: 'COMPLIANCE.ALERT_CLOSE',
  SAR: 'COMPLIANCE.ALERT_SAR',
};

/**
 * PATCH /api/compliance/alerts/[id]
 *
 * Update an AML alert's status. Body:
 *   { action: 'INVESTIGATE' | 'ESCALATE' | 'CLOSE' | 'SAR',
 *     notes?: string }
 *
 * Each action flips the alert status, optionally stamps the closure time, and
 * writes an AuditLog entry so the alert workflow is fully traceable.
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
      { error: 'Alert ID is required' },
      { status: 400 },
    );
  }

  const existing = await db.aMLAlert.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
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
          "action must be one of 'INVESTIGATE', 'ESCALATE', 'CLOSE', 'SAR'",
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
    assignedTo?: string | null;
    closedAt?: Date | null;
  } = {
    status: STATUS_BY_ACTION[action],
  };

  if (action === 'CLOSE' || action === 'SAR') {
    patch.closedAt = new Date();
  }
  if (action === 'INVESTIGATE' && !existing.assignedTo && userId) {
    patch.assignedTo = userId;
  }

  const updated = await db.aMLAlert.update({
    where: { id },
    data: patch,
  });

  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: AUDIT_ACTION[action],
        resourceType: 'AMLAlert',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          action,
          previousStatus: existing.status,
          nextStatus: patch.status,
          notes,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ alert: updated });
}
