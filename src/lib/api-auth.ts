import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { resolveDeveloperMerchantId } from '@/lib/developer-context';

/**
 * Shared API authentication helpers.
 *
 * These helpers wrap NextAuth's `getServerSession` with the PaySwap-specific
 * merchant / admin resolution logic so that every API route can enforce a
 * consistent auth posture without duplicating boilerplate.
 *
 * Usage pattern (return early on null / forbidden):
 *
 *   const session = await requireSession();
 *   if (!session) return unauthorized();
 *
 *   const merchantId = await requireMerchantId();
 *   if (!merchantId) return forbidden();
 *
 *   const adminSession = await requireAdminSession();
 *   if (!adminSession) return forbidden();
 */

/** Get the authenticated session, or null when unauthenticated. */
export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  return session;
}

/**
 * Get the merchant ID associated with the current user.
 *
 * Resolution order:
 *   1. A MERCHANT or MERCHANT_STAFF UserRole with a merchantId on it.
 *   2. Any of DEVELOPER, ADMIN, SUPER_ADMIN, or MERCHANT-without-merchantId
 *      → fall back to the developer sandbox merchant
 *      (`resolveDeveloperMerchantId`), so developers / admins using the API
 *      explorer / dev console can exercise merchant-scoped endpoints
 *      (create payment, list payouts, install extensions, …) without first
 *      being granted an explicit MERCHANT role with a merchantId.
 *
 * Returns null if the user is unauthenticated, has no user id, or holds
 * none of the roles above AND the merchant table is empty.
 */
export async function requireMerchantId(): Promise<string | null> {
  const session = await requireSession();
  if (!session) return null;
  const userId = (session.user as any)?.id;
  if (!userId) return null;

  // 1. Explicit merchant / merchant-staff role with a merchantId set.
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  if (userRole?.merchantId) return userRole.merchantId;

  // 2. Developer / admin / super-admin / merchant-without-merchantId →
  //    resolve via the developer sandbox merchant (which falls back to the
  //    first merchant in the system). This is what unblocks the API explorer
  //    for the demo `developer@payswap.demo` user.
  const fallbackRole = await db.userRole.findFirst({
    where: {
      userId,
      role: { in: ['DEVELOPER', 'ADMIN', 'SUPER_ADMIN', 'MERCHANT', 'MERCHANT_STAFF'] },
    },
    select: { userId: true },
  });
  if (fallbackRole) {
    return resolveDeveloperMerchantId(userId);
  }

  return null;
}

/**
 * Resolve the authenticated customer for an API call.
 *
 * Returns `{ session, userId, account, customer, wallets }` or `null`
 * when the caller is unauthenticated / not linked to a Customer row.
 *
 * Unlike `requireCustomer()` in auth-guards.ts (which is for server
 * components and uses `redirect()`), this is meant for API routes —
 * callers should respond with `unauthorized()` when null.
 */
export async function resolveCustomer() {
  const session = await requireSession();
  if (!session) return null;
  const userId = (session.user as { id?: string }).id;
  if (!userId) return null;

  const account = await db.account.findFirst({
    where: { userId, type: 'CUSTOMER' },
    include: { customer: true, wallets: true },
  });
  if (!account?.customer) return null;

  return {
    session,
    userId,
    account,
    customer: account.customer,
    wallets: account.wallets,
  };
}

/**
 * Require an admin session. Returns the session when the caller holds the
 * ADMIN or SUPER_ADMIN role, otherwise null.
 */
export async function requireAdminSession() {
  const session = await requireSession();
  if (!session) return null;
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r))) return null;
  return session;
}

/** True when the caller is an admin (ADMIN or SUPER_ADMIN). */
export async function isAdmin(): Promise<boolean> {
  const adminSession = await requireAdminSession();
  return adminSession !== null;
}

/** Standard 401 response. */
export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** Standard 403 response. */
export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
