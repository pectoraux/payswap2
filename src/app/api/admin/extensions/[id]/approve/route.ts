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
 * POST /api/admin/extensions/[id]/approve
 *
 * Admin-only. Approves a submission, moving it through approved → published.
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
    !['submitted', 'static_analysis', 'security_scan', 'review', 'approved'].includes(
      extension.status,
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot approve an extension in status '${extension.status}'`,
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const updated = await db.extension.update({
    where: { id },
    data: {
      status: 'published',
      reviewedAt: now,
      reviewedBy: reviewerId ?? null,
      reviewNotes: notes ?? extension.reviewNotes,
      publishedAt: extension.publishedAt ?? now,
    },
  });

  return NextResponse.json({ ok: true, extension: updated });
}
