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
 * POST /api/customers/create
 *
 * Create a CustomerRecord for the authenticated merchant. If a record with
 * the same email already exists for this merchant, it is updated instead of
 * duplicated.
 *
 * Body:
 *   { name, email, phone?, country? }
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone =
    typeof body.phone === 'string' && body.phone.trim()
      ? body.phone.trim()
      : null;
  const country =
    typeof body.country === 'string' && body.country.trim()
      ? body.country.trim()
      : null;

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'A valid email is required' },
      { status: 400 },
    );
  }

  // Upsert on (merchantId, email) so merchants can't accidentally create
  // duplicate customer records.
  const existing = await db.customerRecord.findFirst({
    where: { merchantId, email },
  });

  let customer;
  if (existing) {
    customer = await db.customerRecord.update({
      where: { id: existing.id },
      data: {
        name,
        phone: phone ?? existing.phone,
        country: country ?? existing.country,
      },
    });
  } else {
    customer = await db.customerRecord.create({
      data: {
        merchantId,
        name,
        email,
        phone,
        country,
      },
    });
  }

  return NextResponse.json({ customer }, { status: 201 });
}
