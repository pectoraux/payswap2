import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { getEnvironment } from '@/lib/environment';
import { paymentService } from '@/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/create
 *
 * Creates a payment through the PaymentService — the single source of truth.
 * The service handles: customer record upsert, payment creation, fee
 * calculation, domain event emission, webhook delivery, and audit logging.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const amount = Number(body.amount);
  const currency = typeof body.currency === 'string' ? body.currency : 'GHS';
  const method = typeof body.method === 'string' ? body.method : null;
  const description = typeof body.description === 'string' ? body.description : 'Payment';
  const customerEmail = typeof body.customerEmail === 'string' && body.customerEmail.trim() ? body.customerEmail.trim() : undefined;
  const customerName = typeof body.customerName === 'string' && body.customerName.trim() ? body.customerName.trim() : undefined;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  if (!method) {
    return NextResponse.json({ error: 'Method is required' }, { status: 400 });
  }

  try {
    const payment = await paymentService.create({
      merchantId,
      amount,
      currency,
      method,
      description,
      customerName,
      customerEmail,
      environment: env,
      actorId: (session.user as any)?.id,
      success: true, // API-created payments succeed (simulator controls success)
    });

    return NextResponse.json({ payment });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Payment creation failed' }, { status: 500 });
  }
}
