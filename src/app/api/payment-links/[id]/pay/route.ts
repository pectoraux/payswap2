import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { paymentService } from '@/services';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payment-links/[id]/pay
 *
 * NH-1 FIX: Now dispatches through paymentService → executionPlanner →
 * dispatcher → invariants → event store → ledger. Previously bypassed
 * the kernel with direct db.payment.create().
 *
 * Flow:
 *   1. Look up the PaymentLink by ID. 404 if missing / inactive.
 *   2. Dispatch payment.create through the runtime kernel (produces
 *      payment.recorded + payment.completed + ledger.entry.posted events).
 *   3. Bump the link counters.
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
  const env = await getEnvironment();

  // NH-1 FIX: Dispatch through paymentService (goes through the Execution
  // Planner → dispatcher → invariants → event store → ledger).
  const payment = await paymentService.create({
    merchantId: link.merchantId,
    amount: link.amount,
    currency: link.currency,
    method: 'PAYMENT_LINK',
    description: link.description ?? 'Payment via payment link',
    environment: env,
    success: true,
  });

  // Bump the link counters so the merchant dashboard reflects usage.
  await db.paymentLink.update({
    where: { id: link.id },
    data: {
      paymentCount: { increment: 1 },
      totalCollected: { increment: link.amount },
    },
  });

  // Fetch with merchant relation for the response
  const paymentWithMerchant = await db.payment.findUnique({
    where: { id: payment.id },
    include: { merchant: true },
  });

  return NextResponse.json({ payment: paymentWithMerchant, merchant: paymentWithMerchant?.merchant }, { status: 201 });
}
