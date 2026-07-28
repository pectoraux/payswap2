import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_ACCOUNT_TYPES = new Set([
  'MERCHANT',
  'LP',
  'DEVELOPER',
  'CUSTOMER',
  'OTHER',
]);

const ALLOWED_VOLUMES = new Set(['<10K', '10K-100K', '100K-1M', '>1M']);

// RFC 5322 simplified — good enough for client + server validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/waitlist — join the waitlist.
 *
 * Public endpoint — does NOT create a User account. The applicant is placed
 * on a waitlist that an admin can later APPROVE (which creates the account
 * and emails them an invite) or REJECT.
 *
 * Body:
 *   name            string  required
 *   email           string  required (validated, lowercased)
 *   company         string  optional
 *   country         string  required (ISO-2 or display name)
 *   accountType     enum    required (MERCHANT|LP|DEVELOPER|CUSTOMER|OTHER)
 *   useCase         string  optional (free-text)
 *   monthlyVolume   enum    optional (<10K|10K-100K|100K-1M|>1M)
 *   referralSource  string  optional
 *
 * Returns 409 if the email is already on the waitlist.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
  const email = emailRaw.toLowerCase();
  const company =
    typeof body.company === 'string' && body.company.trim()
      ? body.company.trim().slice(0, 200)
      : null;
  const country =
    typeof body.country === 'string' && body.country.trim()
      ? body.country.trim()
      : '';
  const accountTypeRaw =
    typeof body.accountType === 'string' ? body.accountType.toUpperCase().trim() : '';
  const accountType = ALLOWED_ACCOUNT_TYPES.has(accountTypeRaw)
    ? accountTypeRaw
    : null;
  const useCase =
    typeof body.useCase === 'string' && body.useCase.trim()
      ? body.useCase.trim().slice(0, 2000)
      : null;
  const monthlyVolumeRaw =
    typeof body.monthlyVolume === 'string'
      ? body.monthlyVolume.trim()
      : '';
  const monthlyVolume = ALLOWED_VOLUMES.has(monthlyVolumeRaw)
    ? monthlyVolumeRaw
    : null;
  const referralSource =
    typeof body.referralSource === 'string' && body.referralSource.trim()
      ? body.referralSource.trim().slice(0, 200)
      : null;

  // ── Validation ──
  if (!name) {
    return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'A valid email is required' },
      { status: 400 },
    );
  }
  if (!country) {
    return NextResponse.json({ error: 'Country is required' }, { status: 400 });
  }
  if (!accountType) {
    return NextResponse.json(
      {
        error:
          'Account type is required (Merchant, LP, Developer, Customer, or Other)',
      },
      { status: 400 },
    );
  }

  // ── Duplicate check ──
  const existing = await db.waitlistEntry.findUnique({
    where: { email },
    select: { id: true, status: true },
  });
  if (existing) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You're already on the waitlist. We'll email you when your account is ready.",
        status: existing.status,
      },
      { status: 409 },
    );
  }

  try {
    const entry = await db.waitlistEntry.create({
      data: {
        email,
        name,
        company,
        country,
        accountType,
        useCase,
        monthlyVolume,
        referralSource,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        id: entry.id,
        status: entry.status,
        message:
          "You're on the waitlist! We'll review your application and email you when your account is ready.",
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to join waitlist. Please try again.' },
      { status: 500 },
    );
  }
}
