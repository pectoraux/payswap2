import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/[id]/pay
 *
 * Public hosted-checkout endpoint used by the `/pay/[paymentId]` page. When a
 * customer clicks "Pay Now" the page posts here and we mark the payment as
 * COMPLETED, settle it, and bump the merchant's CustomerRecord totals so the
 * merchant's customer book stays in sync with reality.
 *
 * The route is intentionally public — a customer paying a hosted checkout
 * link does not have a PaySwap session.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const payment = await db.payment.findUnique({
    where: { id },
    include: { merchant: true },
  });

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  // Idempotency: re-paying a completed payment is a no-op that just returns
  // the current state so the checkout UI can render the success screen again.
  if (payment.status === 'COMPLETED') {
    return NextResponse.json({
      payment,
      merchant: payment.merchant,
      alreadyCompleted: true,
    });
  }

  // Resolve the CustomerRecord to increment. The create-payment flow stashes
  // the customerRecordId in `metadata` as `{ customerRecordId: string }`.
  let customerRecordId: string | null = null;
  if (payment.metadata) {
    try {
      const parsed = JSON.parse(payment.metadata) as { customerRecordId?: string };
      if (parsed.customerRecordId) customerRecordId = parsed.customerRecordId;
    } catch {
      // ignore malformed metadata
    }
  }

  const updated = await db.$transaction(async (tx) => {
    const settled = await tx.payment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        settledAt: new Date(),
      },
      include: { merchant: true },
    });

    if (customerRecordId) {
      // Bump the customer book. We re-read inside the transaction so the
      // totals are consistent if two payments land near-simultaneously.
      const cr = await tx.customerRecord.findUnique({
        where: { id: customerRecordId },
      });
      if (cr) {
        await tx.customerRecord.update({
          where: { id: customerRecordId },
          data: {
            totalSpent: cr.totalSpent + settled.amount,
            transactionCount: cr.transactionCount + 1,
          },
        });
      }
    }

    return settled;
  });

  return NextResponse.json({ payment: updated, merchant: updated.merchant });
}
