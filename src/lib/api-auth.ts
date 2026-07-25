import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

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
 * Returns null if the user is unauthenticated or is not a merchant /
 * merchant staff member.
 */
export async function requireMerchantId(): Promise<string | null> {
  const session = await requireSession();
  if (!session) return null;
  const userId = (session.user as any)?.id;
  if (!userId) return null;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  return userRole?.merchantId ?? null;
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
