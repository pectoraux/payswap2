import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { refundService } from '@/services';
import { getIdempotencyKey } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFUND_TYPES = new Set(['FULL', 'PARTIAL']);

/**
 * POST /api/refunds/create
 *
 * Create a Refund against an existing payment through the runtime kernel.
 *
 * This route goes through:
 *   API → refundService → executionPlanner → dispatcher → invariants →
 *   event store → ledger → projections
 *
 * The refund is recorded in the event store (refund.requested +
 * refund.executed + ledger.entry.posted events), the constitution
 * invariants are verified (including refund-limit: refund amount <=
 * payment amount), and the ledger is updated with balanced reversal
 * entries.
 *
 * Idempotency: Pass an `Idempotency-Key` header to safely retry.
 *
 * Body:
 *   { paymentId, amount, type: 'full' | 'partial', reason? }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const userId = (session.user as any)?.id as string | undefined;
  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const paymentId =
    typeof body.paymentId === 'string' && body.paymentId.trim()
      ? body.paymentId.trim()
      : '';

  if (!paymentId) {
    return NextResponse.json(
      { error: 'Payment ID is required' },
      { status: 400 },
    );
  }

  const rawType =
    typeof body.type === 'string' ? body.type.toUpperCase() : '';
  const type = REFUND_TYPES.has(rawType) ? (rawType as 'FULL' | 'PARTIAL') : '';
  if (!type) {
    return NextResponse.json(
      { error: 'Type must be "full" or "partial"' },
      { status: 400 },
    );
  }

  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : '';

  // Look up the payment and verify ownership.
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }
  if (payment.merchantId !== merchantId) {
    return NextResponse.json(
      { error: 'Payment does not belong to this merchant' },
      { status: 403 },
    );
  }

  // Resolve the refund amount based on the type.
  let amount: number;
  if (type === 'FULL') {
    amount = payment.amount;
  } else {
    const parsed = Number(body.amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: 'A valid refund amount is required for partial refunds' },
        { status: 400 },
      );
    }
    if (parsed > payment.amount) {
      return NextResponse.json(
        {
          error: `Refund amount exceeds payment amount of ${payment.amount}`,
        },
        { status: 400 },
      );
    }
    amount = parsed;
  }

  // Get idempotency key from header (H-2 fix)
  const idempotencyKey = getIdempotencyKey(req);

  try {
    const refund = await refundService.create({
      merchantId,
      paymentId,
      amount,
      type,
      reason,
      environment: env,
      actorId: userId,
    });

    return NextResponse.json({ refund, idempotencyKey }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Refund creation failed' },
      { status: 500 },
    );
  }
}
