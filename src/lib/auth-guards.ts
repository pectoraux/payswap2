import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Resolve the authenticated merchant for the current session.
 *
 * Looks for a MERCHANT or MERCHANT_STAFF role on the user,
 * uses its `merchantId`, and returns the merchant row.
 *
 * If the user is not authenticated → redirects to /login.
 * If the user has no merchant role → redirects to /unauthorized.
 */
export async function requireMerchant() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    redirect('/login');
  }

  const roleRow = await db.userRole.findFirst({
    where: {
      userId,
      role: { in: ['MERCHANT', 'MERCHANT_STAFF'] },
      merchantId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!roleRow?.merchantId) {
    redirect('/unauthorized');
  }

  const merchant = await db.merchant.findUnique({
    where: { id: roleRow.merchantId },
  });

  if (!merchant) {
    redirect('/unauthorized');
  }

  return { session, merchant, userId };
}

/**
 * Resolve the authenticated admin (ADMIN or SUPER_ADMIN).
 *
 * Redirects to /login when unauthenticated, /unauthorized when
 * the user lacks an admin role.
 */
export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect('/login');
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    redirect('/login');
  }

  const roles = ((session.user as { roles?: string[] }).roles) ?? [];
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');

  if (!isAdmin) {
    redirect('/unauthorized');
  }

  return { session, userId, roles };
}
