import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  requireSession,
  requireMerchantId,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/create
 *
 * Create a Payment record for the authenticated merchant. When a customer
 * email is supplied, a CustomerRecord is upserted (matched on
 * merchantId + email) so the merchant can build up a customer book as they
 * take payments.
 *
 * Body:
 *   { amount, currency, method, description, customerEmail?, customerName? }
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
  const description =
    typeof body.description === 'string' ? body.description : null;
  const customerEmail =
    typeof body.customerEmail === 'string' && body.customerEmail.trim()
      ? body.customerEmail.trim()
      : null;
  const customerName =
    typeof body.customerName === 'string' && body.customerName.trim()
      ? body.customerName.trim()
      : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  if (!method) {
    return NextResponse.json({ error: 'Method is required' }, { status: 400 });
  }

  // Upsert a CustomerRecord if an email was supplied.
  let customerRecordId: string | null = null;
  if (customerEmail) {
    const existing = await db.customerRecord.findFirst({
      where: { merchantId, email: customerEmail, environment: env },
    });
    if (existing) {
      customerRecordId = existing.id;
      // Bump totals so the customer book stays in sync with payments.
      await db.customerRecord.update({
        where: { id: existing.id },
        data: {
          totalSpent: existing.totalSpent + amount,
          transactionCount: existing.transactionCount + 1,
          name: customerName || existing.name,
        },
      });
    } else {
      const created = await db.customerRecord.create({
        data: {
          merchantId,
          name: customerName || customerEmail.split('@')[0],
          email: customerEmail,
          totalSpent: amount,
          transactionCount: 1,
          environment: env,
        },
      });
      customerRecordId = created.id;
    }
  }

  const reference = `PAY-${randomUUID().slice(0, 8).toUpperCase()}`;

  const payment = await db.payment.create({
    data: {
      merchantId,
      amount,
      currency,
      method,
      description,
      reference,
      status: 'PENDING',
      netAmount: amount,
      metadata: customerRecordId
        ? JSON.stringify({ customerRecordId })
        : null,
      environment: env,
    },
  });

  return NextResponse.json({ payment }, { status: 201 });
}
