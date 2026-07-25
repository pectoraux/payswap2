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

const REFUND_TYPES = new Set(['FULL', 'PARTIAL']);

/**
 * POST /api/refunds/create
 *
 * Create a Refund against an existing payment owned by the authenticated
 * merchant. The payment must exist, belong to the merchant, and the refund
 * amount must not exceed the payment amount.
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
  const type = REFUND_TYPES.has(rawType) ? rawType : '';
  if (!type) {
    return NextResponse.json(
      { error: 'Type must be "full" or "partial"' },
      { status: 400 },
    );
  }

  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : null;

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

  const refund = await db.refund.create({
    data: {
      merchantId,
      paymentId,
      amount,
      type,
      reason,
      status: 'PENDING',
      requestedBy: userId || 'unknown',
    },
  });

  return NextResponse.json({ refund }, { status: 201 });
}
