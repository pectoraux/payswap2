import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { writeAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/marketplace/[id]/approve
 *
 * Approve a submitted marketplace plugin. Transitions to "approved" status
 * (or "published" if `publish` is true in the body).
 *
 * Body: { publish?: boolean, notes?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();
  const adminId = (session.user as any)?.id as string;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    if (!['submitted', 'static_analysis', 'security_scan', 'review', 'approved', 'rejected'].includes(row.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot approve a plugin in status "${row.status}"`,
        },
        { status: 400 },
      );
    }

    const publish = body.publish === true;
    const nextStatus = publish ? 'published' : 'approved';
    const data: any = {
      status: nextStatus,
      reviewedAt: new Date(),
      reviewedBy: adminId,
      reviewNotes: typeof body.notes === 'string' ? body.notes : row.reviewNotes,
    };
    if (publish) {
      data.publishedAt = new Date();
    }
    const updated = await db.extension.update({ where: { id }, data });

    // P3-5 (H-9 fix): audit-log the admin state change.
    await writeAudit({
      userId: adminId,
      action: 'MARKETPLACE_PLUGIN_APPROVE',
      resourceType: 'Extension',
      resourceId: id,
      result: 'SUCCESS',
      details: {
        fromStatus: row.status,
        toStatus: updated.status,
        publish,
        notes: typeof body.notes === 'string' ? body.notes : null,
      },
    });

    return NextResponse.json({ ok: true, plugin: updated });
  } catch (err) {
    console.error('[api/admin/marketplace/[id]/approve POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
