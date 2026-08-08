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
 * POST /api/admin/extensions/[id]/static-analysis
 *
 * Admin-only. Routes the extension into the static-analysis lifecycle state.
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

  if (!['submitted', 'security_scan', 'review'].includes(extension.status)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot send an extension in status '${extension.status}' to static analysis`,
      },
      { status: 400 },
    );
  }

  const updated = await db.extension.update({
    where: { id },
    data: { status: 'static_analysis' },
  });

  // P3-5 (H-9 fix): audit-log the admin state change.
  await writeAudit({
    userId: (adminSession.user as any)?.id ?? null,
    action: 'EXTENSION_STATIC_ANALYSIS',
    resourceType: 'Extension',
    resourceId: id,
    result: 'SUCCESS',
    details: { fromStatus: extension.status, toStatus: updated.status },
  });

  return NextResponse.json({ ok: true, extension: updated });
}
