import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import {
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Default temporary password assigned to waitlist-approved merchants so they
 * can sign in immediately and change it from their settings later.
 */
const TEMP_PASSWORD = 'Payswap123456';

/**
 * Map a country (ISO code or display name) to its default settlement
 * currency. Falls back to USD when the country is unknown.
 */
function currencyForCountry(country: string | null | undefined): string {
  if (!country) return 'USD';
  const c = country.trim().toUpperCase();
  const map: Record<string, string> = {
    GH: 'GHS',
    GHANA: 'GHS',
    KE: 'KES',
    KENYA: 'KES',
    NG: 'NGN',
    NIGERIA: 'NGN',
    ZA: 'ZAR',
    'SOUTH AFRICA': 'ZAR',
    US: 'USD',
    USA: 'USD',
    'UNITED STATES': 'USD',
    GB: 'GBP',
    UK: 'GBP',
    'UNITED KINGDOM': 'GBP',
    EU: 'EUR',
    EUROZONE: 'EUR',
  };
  return map[c] ?? 'USD';
}

/**
 * GET /api/admin/waitlist — list waitlist entries.
 *
 * Admin-only.
 */
export async function GET(req: NextRequest) {
  const adminSession = await requireAdminSession();
  if (!adminSession) return unauthorized();
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const entries = await db.waitlistEntry.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ entries, count: entries.length });
}

/**
 * PATCH /api/admin/waitlist — review a waitlist entry (approve / reject / etc).
 *
 * Requires ADMIN or SUPER_ADMIN role.
 *
 * When `action === 'APPROVED'`, the entry is converted into a real merchant:
 * a User, UserRole (MERCHANT), Account (MERCHANT/ACTIVE), Merchant
 * (PENDING/UNVERIFIED) and a default Wallet are created atomically, and the
 * WaitlistEntry is moved to the `CONVERTED` status. The new user receives a
 * temporary password that the admin must communicate to them.
 */
export async function PATCH(req: NextRequest) {
  const adminSession = await requireAdminSession();
  if (!adminSession) {
    // Distinguish 401 (no session) from 403 (session but not admin).
    // requireAdminSession returns null in both cases; return 403 to be safe
    // since a non-admin authenticated user is the more common failure mode.
    return forbidden();
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { id, action } = body as { id?: string; action?: string };
  if (!id || !action) {
    return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  }

  const reviewerId = (adminSession.user as any)?.id as string | undefined;

  // ────────────────────────────────────────────────────────────────────────
  // REJECTED / other non-approval actions: just mark the entry and return.
  // ────────────────────────────────────────────────────────────────────────
  if (action !== 'APPROVED') {
    const entry = await db.waitlistEntry.update({
      where: { id },
      data: {
        status: action,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
    return NextResponse.json({ entry });
  }

  // ────────────────────────────────────────────────────────────────────────
  // APPROVED — convert the waitlist entry into a real merchant workspace.
  // ────────────────────────────────────────────────────────────────────────
  const entry = await db.waitlistEntry.findUnique({ where: { id } });
  if (!entry) {
    return NextResponse.json({ error: 'Waitlist entry not found' }, { status: 404 });
  }

  // If this entry was already converted, treat the request as a no-op so the
  // admin UI stays idempotent.
  if (entry.status === 'CONVERTED') {
    const existingUser = await db.user.findUnique({
      where: { email: entry.email },
      include: { roles: true },
    });
    const existingMerchantRole = existingUser?.roles.find((r) => r.role === 'MERCHANT');
    const existingMerchant = existingMerchantRole?.merchantId
      ? await db.merchant.findUnique({ where: { id: existingMerchantRole.merchantId } })
      : null;
    return NextResponse.json({
      entry,
      alreadyConverted: true,
      user: existingUser,
      merchant: existingMerchant,
      credentials: { email: entry.email, password: TEMP_PASSWORD },
    });
  }

  const email = entry.email.toLowerCase();
  const merchantName = entry.company?.trim() || entry.name;
  const currency = currencyForCountry(entry.country);

  // Hash the temporary password once for the new user.
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 10);

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Create the User (or re-activate if an account already exists).
      const user = await tx.user.upsert({
        where: { email },
        update: {
          name: entry.name,
          passwordHash,
          status: 'ACTIVE',
          emailVerified: new Date(),
        },
        create: {
          email,
          name: entry.name,
          phone: entry.phone,
          passwordHash,
          status: 'ACTIVE',
          emailVerified: new Date(),
        },
      });

      // 2. Create the MERCHANT account.
      const account = await tx.account.create({
        data: {
          userId: user.id,
          type: 'MERCHANT',
          status: 'ACTIVE',
        },
      });

      // 3. Grant the MERCHANT role initially (no merchant link yet).
      const userRole = await tx.userRole.create({
        data: {
          userId: user.id,
          role: 'MERCHANT',
        },
      });

      // 4. Create the Merchant record (PENDING / UNVERIFIED until KYC).
      const merchant = await tx.merchant.create({
        data: {
          accountId: account.id,
          name: merchantName,
          legalName: entry.company ?? null,
          email,
          phone: entry.phone,
          country: entry.country,
          currency,
          businessType: entry.businessType ?? null,
          tier: 'UNVERIFIED',
          status: 'PENDING',
        },
      });

      // 5. Link the role to the newly created merchant.
      await tx.userRole.update({
        where: { id: userRole.id },
        data: { merchantId: merchant.id },
      });

      // 6. Provision a default settlement wallet in the merchant's currency.
      await tx.wallet.create({
        data: {
          accountId: account.id,
          name: `${currency} Wallet`,
          currency,
          balance: 0,
          isDefault: true,
        },
      });

      // 7. Mark the waitlist entry as converted.
      const updatedEntry = await tx.waitlistEntry.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
        },
      });

      return { user, merchant, entry: updatedEntry };
    });

    return NextResponse.json({
      entry: result.entry,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        status: result.user.status,
      },
      merchant: {
        id: result.merchant.id,
        name: result.merchant.name,
        email: result.merchant.email,
        country: result.merchant.country,
        currency: result.merchant.currency,
        status: result.merchant.status,
        tier: result.merchant.tier,
      },
      credentials: {
        email: result.user.email,
        password: TEMP_PASSWORD,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Conversion failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
