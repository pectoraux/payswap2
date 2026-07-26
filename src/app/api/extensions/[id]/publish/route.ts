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
 * POST /api/extensions/[id]/publish
 *
 * Admin-only. Approves / rejects / suspends an extension in review.
 *
 * Body (all optional):
 *   { action?: 'approve' | 'reject' | 'review' | 'suspend' | 'reinstate',
 *     notes?: string }
 *
 * Defaults to `approve` (which marks the extension as `published`).
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

  const reviewerId = (adminSession.user as any)?.id as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = typeof body.action === 'string' ? body.action : 'approve';
  const notes =
    typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null;

  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
  }

  const now = new Date();
  let nextStatus: string;
  let publishedAt: Date | null = extension.publishedAt;

  switch (action) {
    case 'approve':
      if (!['submitted', 'review', 'approved'].includes(extension.status)) {
        return NextResponse.json(
          { error: `Cannot approve an extension in status '${extension.status}'` },
          { status: 400 },
        );
      }
      nextStatus = 'published';
      publishedAt = now;
      break;
    case 'reject':
      if (!['submitted', 'review'].includes(extension.status)) {
        return NextResponse.json(
          { error: `Cannot reject an extension in status '${extension.status}'` },
          { status: 400 },
        );
      }
      nextStatus = 'rejected';
      break;
    case 'review':
      if (!['submitted'].includes(extension.status)) {
        return NextResponse.json(
          { error: `Cannot move an extension in status '${extension.status}' to review` },
          { status: 400 },
        );
      }
      nextStatus = 'review';
      break;
    case 'suspend':
      if (extension.status !== 'published') {
        return NextResponse.json(
          { error: 'Only published extensions can be suspended' },
          { status: 400 },
        );
      }
      nextStatus = 'suspended';
      break;
    case 'reinstate':
      if (extension.status !== 'suspended') {
        return NextResponse.json(
          { error: 'Only suspended extensions can be reinstated' },
          { status: 400 },
        );
      }
      nextStatus = 'published';
      break;
    default:
      return NextResponse.json(
        { error: 'Invalid action. Allowed: approve, reject, review, suspend, reinstate' },
        { status: 400 },
      );
  }

  const updated = await db.extension.update({
    where: { id },
    data: {
      status: nextStatus,
      reviewedAt: now,
      reviewedBy: reviewerId ?? null,
      reviewNotes:
        action === 'reject' || action === 'suspend' ? notes : extension.reviewNotes,
      publishedAt,
    },
  });

  return NextResponse.json({ extension: updated });
}
