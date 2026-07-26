import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payment-links/[id]/pay
 *
 * Public hosted-checkout endpoint that finalises a payment made through a
 * reusable PaymentLink. The flow:
 *
 *   1. Look up the PaymentLink by ID. 404 if missing / inactive.
 *   2. Create a new Payment row with status PENDING (so the audit trail shows
 *      the intent), then immediately mark it COMPLETED + settled.
 *   3. Bump the link's `paymentCount` and `totalCollected` counters.
 *
 * The route is intentionally public — a customer paying a hosted payment link
 * does not have a PaySwap session.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const link = await db.paymentLink.findUnique({
    where: { id },
    include: { merchant: true },
  });

  if (!link || !link.merchant || link.status !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'Payment link not found or inactive' },
      { status: 404 },
    );
  }

  // Honour the link's own expiry if it has one.
  if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'This payment link has expired' },
      { status: 410 },
    );
  }

  const reference = `PL-${randomUUID().slice(0, 8).toUpperCase()}`;

  const payment = await db.$transaction(async (tx) => {
    // 1. Create the Payment in PENDING first so the audit trail captures the
    //    intent (this also mirrors how /api/payments/create behaves).
    const created = await tx.payment.create({
      data: {
        merchantId: link.merchantId,
        amount: link.amount,
        currency: link.currency,
        method: 'HOSTED_LINK',
        description: link.description ?? 'Payment via payment link',
        reference,
        status: 'PENDING',
        netAmount: link.amount,
        environment: link.environment,
        metadata: JSON.stringify({ paymentLinkId: link.id }),
      },
      include: { merchant: true },
    });

    // 2. Immediately settle — the simulated hosted checkout succeeds synchronously.
    const settled = await tx.payment.update({
      where: { id: created.id },
      data: { status: 'COMPLETED', settledAt: new Date() },
      include: { merchant: true },
    });

    // 3. Bump the link counters so the merchant dashboard reflects usage.
    await tx.paymentLink.update({
      where: { id: link.id },
      data: {
        paymentCount: { increment: 1 },
        totalCollected: { increment: link.amount },
      },
    });

    return settled;
  });

  return NextResponse.json({ payment, merchant: payment.merchant }, { status: 201 });
}
