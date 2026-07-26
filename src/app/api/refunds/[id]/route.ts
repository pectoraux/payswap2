import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Allowed terminal refund statuses. These are the only values the
 * Dispute Center can transition a refund into via the Approve / Reject
 * actions:
 *
 *   PROCESSED — the merchant honours the dispute and the refund is paid out.
 *   REJECTED  — the merchant contests the dispute and declines the refund.
 *
 * PENDING is intentionally excluded — once a refund has been actioned it
 * should not be returned to PENDING through this endpoint.
 */
const ALLOWED_STATUS = new Set(['PROCESSED', 'REJECTED']);

/** Map a guard error to the appropriate HTTP response. */
function guardErrorResponse(code: string) {
  if (code === 'UNAUTHORIZED') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * PATCH /api/refunds/[id]
 *
 * Update the status of a refund that belongs to the authenticated
 * merchant. Used by the Dispute Center to Approve (PROCESSED) or
 * Reject (REJECTED) an open dispute.
 *
 * Body (any one of):
 *   { status: 'PROCESSED' | 'REJECTED' }
 *   { action: 'APPROVE' }   -> status = PROCESSED
 *   { action: 'REJECT' }    -> status = REJECTED
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const userId = (session.user as any)?.id as string | undefined;

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Refund ID is required' },
      { status: 400 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional in some flows — fall through to validation below.
  }

  // Resolve the target status from either an explicit `status` field or a
  // convenience `action` alias.
  let nextStatus = '';
  if (typeof body?.status === 'string') {
    nextStatus = body.status.trim().toUpperCase();
  } else if (typeof body?.action === 'string') {
    const action = body.action.trim().toUpperCase();
    if (action === 'APPROVE') nextStatus = 'PROCESSED';
    else if (action === 'REJECT') nextStatus = 'REJECTED';
  }

  if (!nextStatus || !ALLOWED_STATUS.has(nextStatus)) {
    return NextResponse.json(
      { error: 'Status must be one of PROCESSED, REJECTED' },
      { status: 400 },
    );
  }

  const refund = await db.refund.findUnique({ where: { id } });
  if (!refund) {
    return NextResponse.json({ error: 'Refund not found' }, { status: 404 });
  }
  if (refund.merchantId !== merchantId) {
    return NextResponse.json(
      { error: 'Refund does not belong to this merchant' },
      { status: 403 },
    );
  }

  const updated = await db.refund.update({
    where: { id },
    data: {
      status: nextStatus,
      approvedBy: userId || 'unknown',
      processedAt: new Date(),
    },
  });

  // Best-effort audit log so the action is traceable.
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action:
          nextStatus === 'PROCESSED'
            ? 'DISPUTE.APPROVE'
            : 'DISPUTE.REJECT',
        resourceType: 'Refund',
        resourceId: id,
        result: 'SUCCESS',
        details: JSON.stringify({
          paymentId: refund.paymentId,
          amount: refund.amount,
        }),
      },
    });
  } catch {
    // Audit log is best-effort — never fail the request because of it.
  }

  return NextResponse.json({ refund: updated });
}
