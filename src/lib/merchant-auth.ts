/**
 * Merchant-scoped API auth helpers (C-6 / P1-2 fix).
 *
 * The blanket middleware (`src/middleware.ts`) now requires a valid
 * NextAuth JWT for every `/api/*` route that is not in `PUBLIC_ROUTES`.
 * That closes the broad "357/430 routes have zero session checks" gap.
 *
 * But a valid session is not enough for routes that take a `merchantId`
 * parameter: a logged-in merchant must not be able to read another
 * merchant's API keys, invoices, or trigger payouts on their behalf
 * (the cross-merchant IDOR the auditor flagged as C-6).
 *
 * These helpers layer ownership verification on top of the session check:
 *
 *   const { session, error } = await requireSession();
 *   if (error) return error;
 *   const forbidden = await requireMerchantOwnership(merchantId, session);
 *   if (forbidden) return forbidden;
 *
 * `requireMerchantOwnership` returns `null` when the caller is the
 * merchant's owner OR an admin (ADMIN / SUPER_ADMIN). Otherwise it
 * returns a 403 NextResponse.
 */
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

/** Returns the session or a 401 NextResponse. */
export async function requireSession(): Promise<{ session: any; error?: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { session };
}

/** Verify the authenticated user owns the target merchantId. Returns null if OK, or a 403 NextResponse. */
export async function requireMerchantOwnership(merchantId: string, session: any): Promise<NextResponse | null> {
  const roles = (session.user as any)?.roles ?? [];
  const userMerchantId = (session.user as any)?.merchantId;
  // Admins can access any merchant.
  if (roles.includes('ADMIN') || roles.includes('SUPER_ADMIN')) return null;
  // The user's own merchantId must match.
  if (userMerchantId && userMerchantId === merchantId) return null;
  return NextResponse.json({ error: 'forbidden: merchant ownership required' }, { status: 403 });
}
