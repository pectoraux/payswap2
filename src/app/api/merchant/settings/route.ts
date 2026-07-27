import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/merchant/settings — update the authenticated merchant's profile fields. */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { name, email, phone, description, website } = body as {
    name?: string;
    email?: string;
    phone?: string;
    description?: string;
    website?: string;
  };

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
  }

  const roleRow = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] }, merchantId: { not: null } },
  });

  if (!roleRow?.merchantId) {
    return NextResponse.json({ error: 'No merchant account found' }, { status: 404 });
  }

  // Email uniqueness check
  if (email) {
    const existing = await db.merchant.findFirst({
      where: { email: email.toLowerCase(), NOT: { id: roleRow.merchantId } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }
  }

  const updated = await db.merchant.update({
    where: { id: roleRow.merchantId },
    data: {
      name,
      email: email.toLowerCase(),
      phone: phone || null,
      description: description || null,
      website: website || null,
    },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json({ ok: true, merchant: updated });
}
