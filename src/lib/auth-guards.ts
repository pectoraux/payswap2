import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Get the authenticated session.
 */
export async function getAuthSession() {
  return await getServerSession(authOptions);
}

/**
 * Get the merchant ID for the current user.
 */
export async function getMerchantId(): Promise<string | null> {
  const session = await getAuthSession();
  if (!session) return null;
  const userId = (session.user as any)?.id;
  if (!userId) return null;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  return userRole?.merchantId ?? null;
}

/**
 * Require a merchant session. Returns the merchant ID + merchant record.
 */
export async function requireMerchant(): Promise<{ session: any; merchantId: string; merchant: any }> {
  const session = await getAuthSession();
  if (!session) throw new Error('UNAUTHORIZED');
  const userId = (session.user as any)?.id;
  const userRole = await db.userRole.findFirst({
    where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } },
  });
  if (!userRole?.merchantId) throw new Error('NO_MERCHANT');
  const merchant = await db.merchant.findUnique({ where: { id: userRole.merchantId } });
  if (!merchant) throw new Error('MERCHANT_NOT_FOUND');
  return { session, merchantId: userRole.merchantId, merchant };
}

/**
 * Require an admin session.
 */
export async function requireAdmin(): Promise<{ session: any }> {
  const session = await getAuthSession();
  if (!session) throw new Error('UNAUTHORIZED');
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r))) {
    throw new Error('FORBIDDEN');
  }
  return { session };
}
