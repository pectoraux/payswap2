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
 * POST /api/payouts/[id]/cancel
 *
 * Marks a merchant's payout as CANCELLED. Allowed only when the payout is in
 * a pre-processing state (REQUESTED or REVIEWING). Once a payout has been
 * processed or completed the funds have already left the merchant balance
 * and the cancellation must be handled out-of-band.
 *
 * Body:
 *   { reason?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: 'Payout ID is required' },
      { status: 400 },
    );
  }

  const payout = await db.payout.findUnique({ where: { id } });
  if (!payout) {
    return NextResponse.json({ error: 'Payout not found' }, { status: 404 });
  }
  if (payout.merchantId !== merchantId) {
    return NextResponse.json(
      { error: 'Payout does not belong to this merchant' },
      { status: 403 },
    );
  }

  const cancellable = new Set(['REQUESTED', 'REVIEWING', 'PENDING']);
  if (!cancellable.has(payout.status.toUpperCase())) {
    return NextResponse.json(
      {
        error: `Payout cannot be cancelled in its current state (${payout.status})`,
      },
      { status: 409 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional — empty JSON / no body is fine.
  }
  const reason =
    typeof body?.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Cancelled by merchant';

  const updated = await db.payout.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      failureReason: reason,
    },
  });

  // Record an audit entry so the cancellation is traceable.
  try {
    await db.auditLog.create({
      data: {
        userId: (session.user as any)?.id ?? null,
        action: 'PAYOUT.CANCEL',
        resourceType: 'Payout',
        resourceId: payout.id,
        result: 'SUCCESS',
        details: JSON.stringify({ reason }),
      },
    });
  } catch {
    // Audit log failures should never block the cancellation itself.
  }

  return NextResponse.json({ payout: updated });
}
