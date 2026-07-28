import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { amlPipeline, complianceAuditTrail } from '@/trust';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPLIANCE_ROLES = new Set(['COMPLIANCE', 'ADMIN', 'SUPER_ADMIN']);

const STATUS_BY_ACTION: Record<string, string> = {
  investigate: 'investigating',
  escalate: 'escalated',
  close: 'closed',
  'file-sar': 'sar_filed',
};

const AUDIT_ACTION: Record<string, string> = {
  investigate: 'trust.alert.investigate',
  escalate: 'trust.alert.escalate',
  close: 'trust.alert.close',
  'file-sar': 'trust.alert.file_sar',
};

/**
 * POST /api/trust/alerts/[id]/investigate
 * POST /api/trust/alerts/[id]/escalate
 * POST /api/trust/alerts/[id]/close
 * POST /api/trust/alerts/[id]/file-sar
 *
 * Body (optional): { notes?, assignee? }
 *
 * Each verb updates the alert's status, mirrors the change to the
 * `AMLAlert` Prisma model (best-effort), and records an audit entry.
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
  const nextStatus = STATUS_BY_ACTION[normalized];
  if (!nextStatus) {
    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  }

  const existing = await amlPipeline.getAlert(id);
  if (!existing) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
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
  const assignee =
    typeof body?.assignee === 'string' && body.assignee.trim()
      ? body.assignee.trim()
      : undefined;

  const updated = await amlPipeline.updateAlertStatus(id, nextStatus as any, notes);

  // Mirror to AMLAlert Prisma model (best-effort).
  const prismaStatus = nextStatus.toUpperCase();
  try {
    await db.aMLAlert.update({
      where: { id },
      data: {
        status: prismaStatus,
        assignedTo: assignee ?? undefined,
        closedAt:
          nextStatus === 'closed' || nextStatus === 'sar_filed'
            ? new Date()
            : undefined,
      },
    });
  } catch {
    // Alert may exist only in-memory (created by AML pipeline). Fall back to
    // creating it if it's missing — this keeps the audit + display in sync.
    try {
      await db.aMLAlert.create({
        data: {
          id,
          entityType: existing.entityType.toUpperCase(),
          entityId: existing.entityId,
          alertType: existing.ruleId.toUpperCase(),
          severity: existing.severity.toUpperCase(),
          score: existing.riskScore ?? 0,
          details: JSON.stringify({
            ruleId: existing.ruleId,
            ruleName: existing.ruleName,
            evidence: existing.evidence,
            notes,
          }),
          status: prismaStatus,
          assignedTo: assignee ?? undefined,
          environment: 'sandbox',
          createdAt: new Date(existing.createdAt),
          closedAt:
            nextStatus === 'closed' || nextStatus === 'sar_filed'
              ? new Date()
              : null,
        },
      });
    } catch {
      // best-effort
    }
  }

  await complianceAuditTrail.record({
    action: AUDIT_ACTION[normalized],
    actorId: userId ?? 'unknown',
    entityType: existing.entityType,
    entityId: existing.entityId,
    details: {
      alertId: id,
      ruleId: existing.ruleId,
      ruleName: existing.ruleName,
      previousStatus: existing.status,
      nextStatus,
      notes,
      assignee,
    },
    result: 'success',
  });

  // Persist to AuditLog (best-effort).
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: AUDIT_ACTION[normalized],
        resourceType: 'AMLAlert',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          previousStatus: existing.status,
          nextStatus,
          notes,
          assignee,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({ alert: updated });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await ctx.params;
  return handleAction(req, { id, action });
}
