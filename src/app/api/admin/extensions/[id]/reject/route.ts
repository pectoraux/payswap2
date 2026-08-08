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
 * POST /api/admin/extensions/[id]/reject
 *
 * Admin-only. Rejects a submission. Body (optional): { notes?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const reviewerId = (adminSession.user as any)?.id as string | undefined;
  const { id } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const notes =
    typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;

  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json(
      { ok: false, error: 'Extension not found' },
      { status: 404 },
    );
  }

  if (
    !['submitted', 'static_analysis', 'security_scan', 'review', 'approved', 'published', 'suspended'].includes(
      extension.status,
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot reject an extension in status '${extension.status}'`,
      },
      { status: 400 },
    );
  }

  const updated = await db.extension.update({
    where: { id },
    data: {
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: reviewerId ?? null,
      reviewNotes: notes ?? extension.reviewNotes,
    },
  });

  // P3-5 (H-9 fix): audit-log the admin state change.
  await writeAudit({
    userId: reviewerId ?? null,
    action: 'EXTENSION_REJECT',
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
