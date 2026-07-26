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
 * GET /api/merchant/settings
 *
 * Returns the authenticated merchant's editable profile + parsed `settings`
 * JSON blob (used by the Checkout Builder, Extensions marketplace, etc).
 */
export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();

  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      description: true,
      website: true,
      settings: true,
    },
  });

  if (!merchant) {
    return NextResponse.json(
      { error: 'Merchant not found' },
      { status: 404 },
    );
  }

  // Best-effort parse of the settings JSON. Bad data → null rather than 500.
  let settings: unknown = null;
  if (merchant.settings) {
    try {
      settings = JSON.parse(merchant.settings);
    } catch {
      settings = null;
    }
  }

  return NextResponse.json({
    merchant: {
      ...merchant,
      settings,
    },
  });
}

/**
 * PATCH /api/merchant/settings
 *
 * Update the authenticated merchant's public profile fields. Only the
 * explicitly provided fields are touched; everything else is preserved.
 *
 * Body (all optional):
 *   { name?, email?, phone?, description?, website?, settings? }
 *
 * `settings` may be either:
 *   - An object (recommended) — we JSON-stringify it before persisting.
 *   - A pre-serialised JSON string — persisted as-is after a parse check.
 *
 * The `settings` column is a free-form JSON blob used by features like the
 * Checkout Builder, Extensions marketplace, and other merchant preferences.
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
  const patch: Record<string, string | null> = {};
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

  // Free-form settings JSON. Accept either an object or a pre-serialised
  // string so callers can use whichever is convenient.
  if (body.settings !== undefined) {
    let settingsJson: string | null = null;
    if (body.settings === null) {
      settingsJson = null;
    } else if (typeof body.settings === 'string') {
      // Validate that it parses — refuse to store garbage.
      try {
        JSON.parse(body.settings);
        settingsJson = body.settings;
      } catch {
        return NextResponse.json(
          { error: 'settings must be valid JSON' },
          { status: 400 },
        );
      }
    } else if (typeof body.settings === 'object') {
      try {
        settingsJson = JSON.stringify(body.settings);
      } catch {
        return NextResponse.json(
          { error: 'settings could not be serialised' },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json(
        { error: 'settings must be an object or JSON string' },
        { status: 400 },
      );
    }
    patch.settings = settingsJson;
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
