import { NextRequest, NextResponse } from 'next/server';
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

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const TYPES = new Set(['PHYSICAL', 'DIGITAL', 'SERVICE']);

/**
 * POST /api/products/create
 *
 * Create a Product (catalog item) for the authenticated merchant.
 *
 * Body:
 *   { name, description?, price, currency?, type? }
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description =
    typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null;
  const price = Number(body.price);
  const currency =
    typeof body.currency === 'string' && CURRENCIES.has(body.currency)
      ? body.currency
      : 'GHS';
  const type =
    typeof body.type === 'string' && TYPES.has(body.type)
      ? body.type
      : 'PHYSICAL';

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
  }

  const product = await db.product.create({
    data: {
      merchantId,
      name,
      description,
      price,
      currency,
      type,
      status: 'ACTIVE',
      environment: env,
    },
  });

  return NextResponse.json({ product }, { status: 201 });
}
