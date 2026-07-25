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
 * PATCH /api/merchant/settings
 *
 * Update the authenticated merchant's public profile fields. Only the
 * explicitly provided fields are touched; everything else is preserved.
 *
 * Body (all optional):
 *   { name?, email?, phone?, description?, website? }
 */
export async function PATCH(req: NextRequest) {
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

  // Build the patch object only from keys that are present and stringly-typed.
  const patch: Record<string, string> = {};
  if (typeof body.name === 'string' && body.name.trim()) {
    patch.name = body.name.trim().slice(0, 120);
  }
  if (typeof body.email === 'string' && body.email.trim()) {
    patch.email = body.email.trim().toLowerCase().slice(0, 160);
  }
  if (typeof body.phone === 'string') {
    patch.phone = body.phone.trim().slice(0, 40) || null;
  }
  if (typeof body.description === 'string') {
    patch.description = body.description.trim().slice(0, 1000) || null;
  }
  if (typeof body.website === 'string') {
    patch.website = body.website.trim().slice(0, 240) || null;
  }

  // If email is changing, make sure it doesn't collide with another merchant.
  if (patch.email) {
    const conflict = await db.merchant.findFirst({
      where: { email: patch.email, NOT: { id: merchantId } },
      select: { id: true },
    });
    if (conflict) {
      return NextResponse.json(
        { error: 'Email is already in use by another merchant' },
        { status: 409 },
      );
    }
  }

  const updated = await db.merchant.update({
    where: { id: merchantId },
    data: patch,
  });

  return NextResponse.json({ merchant: updated });
}
