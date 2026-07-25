import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const entries = await db.waitlistEntry.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ entries, count: entries.length });
}

/**
 * PATCH /api/admin/waitlist — review a waitlist entry (approve / reject / etc).
 *
 * Requires ADMIN or SUPER_ADMIN role.
 */
export async function PATCH(req: NextRequest) {
  const adminSession = await requireAdminSession();
  if (!adminSession) {
    // Distinguish 401 (no session) from 403 (session but not admin).
    // requireAdminSession returns null in both cases; return 403 to be safe
    // since a non-admin authenticated user is the more common failure mode.
    return forbidden();
  }
  const { id, action } = await req.json();
  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 });
  const entry = await db.waitlistEntry.update({ where: { id }, data: { status: action, reviewedBy: (adminSession.user as any).id, reviewedAt: new Date() } });
  return NextResponse.json({ entry });
}
