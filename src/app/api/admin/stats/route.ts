import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stats — platform-wide aggregate stats.
 *
 * Requires ADMIN or SUPER_ADMIN role.
 */
export async function GET() {
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const [merchants, users, payments, waitlist] = await Promise.all([
    db.merchant.count(),
    db.user.count(),
    db.payment.count(),
    db.waitlistEntry.count({ where: { status: 'PENDING' } }),
  ]);
  const volumeResult = await db.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } });
  return NextResponse.json({ merchants, users, payments, waitlist, volume: volumeResult._sum.amount || 0 });
}
