import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [merchants, users, payments, waitlist] = await Promise.all([
    db.merchant.count(),
    db.user.count(),
    db.payment.count(),
    db.waitlistEntry.count({ where: { status: 'PENDING' } }),
  ]);
  const volumeResult = await db.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } });
  return NextResponse.json({ merchants, users, payments, waitlist, volume: volumeResult._sum.amount || 0 });
}
