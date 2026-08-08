import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { setFeatured } from '@/lib/extension-featured';
import { writeAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extensions/[id]/archive
 *
 * Admin-only. Permanently archives an extension. Also removes it from the
 * featured set.
 *
 * Body (optional): { notes?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const { id } = await params;
  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json(
      { ok: false, error: 'Extension not found' },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const notes =
    typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;

  const updated = await db.extension.update({
    where: { id },
    data: {
      status: 'archived',
      reviewNotes: notes ?? extension.reviewNotes,
    },
  });

  await setFeatured(id, false);

  // P3-5 (H-9 fix): audit-log the admin state change.
  await writeAudit({
    userId: (adminSession.user as any)?.id ?? null,
    action: 'EXTENSION_ARCHIVE',
    resourceType: 'Extension',
    resourceId: id,
    result: 'SUCCESS',
    details: {
      fromStatus: extension.status,
      toStatus: updated.status,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ ok: true, extension: updated });
}
