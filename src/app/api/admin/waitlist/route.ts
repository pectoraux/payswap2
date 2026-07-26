import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/waitlist — list waitlist entries */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;

  const entries = await db.waitlistEntry.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ entries, count: entries.length });
}

/** PATCH /api/admin/waitlist — approve/reject a waitlist entry */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, action } = body; // action: APPROVE | REJECT

  if (!id || !action) {
    return NextResponse.json({ error: 'id and action are required' }, { status: 400 });
  }

  const entry = await db.waitlistEntry.update({
    where: { id },
    data: {
      status: action,
      reviewedBy: (session.user as any).id,
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({ entry });
}
