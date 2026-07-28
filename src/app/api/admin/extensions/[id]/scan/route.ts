import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extensions/[id]/scan
 *
 * Admin-only. Routes the extension into the security-scan lifecycle state.
 * (In a real platform this would trigger an async SAST/dependency job; here
 * we just flip the status so admins can drive the lifecycle manually.)
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

  if (
    !['submitted', 'static_analysis', 'review'].includes(extension.status)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot send an extension in status '${extension.status}' to security scan`,
      },
      { status: 400 },
    );
  }

  const updated = await db.extension.update({
    where: { id },
    data: { status: 'security_scan' },
  });

  return NextResponse.json({ ok: true, extension: updated });
}
