import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const entries = await db.waitlistEntry.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ entries, count: entries.length });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, action } = await req.json();
  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  const entry = await db.waitlistEntry.update({ where: { id }, data: { status: action, reviewedBy: (session.user as any).id, reviewedAt: new Date() } });
  return NextResponse.json({ entry });
}
