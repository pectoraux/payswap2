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

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const LINK_BASE_URL = 'https://payswap2.vercel.app/pay/';

/**
 * POST /api/payment-links/create
 *
 * Create a reusable PaymentLink for the authenticated merchant. The link URL
 * is derived from the payment link's own ID so it is unique and shareable.
 *
 * Body:
 *   { amount, currency?, description?, reference? }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const amount = Number(body.amount);
  const currency =
    typeof body.currency === 'string' && CURRENCIES.has(body.currency)
      ? body.currency
      : 'GHS';
  const description =
    typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;
  const reference =
    typeof body.reference === 'string' && body.reference.trim()
      ? body.reference.trim()
      : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  // Create the record first so we can build the URL from its ID. The `url`
  // column is unique + required, so we insert with a placeholder then update.
  const link = await db.paymentLink.create({
    data: {
      merchantId,
      amount,
      currency,
      description,
      reference,
      status: 'ACTIVE',
      url: `${LINK_BASE_URL}pending`,
    },
  });

  const url = `${LINK_BASE_URL}${link.id}`;
  const updated = await db.paymentLink.update({
    where: { id: link.id },
    data: { url },
  });

  return NextResponse.json({ paymentLink: updated }, { status: 201 });
}
