import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/developer/publish/[id]/submit
 *
 * Submit a draft/rejected marketplace plugin for review. Transitions the
 * plugin to "submitted" status so it appears in the admin review queue.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  try {
    const row = await db.extension.findUnique({ where: { id } });
    if (!row || row.developerId !== userId) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    if (!['draft', 'rejected'].includes(row.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot submit a plugin in status "${row.status}"`,
        },
        { status: 400 },
      );
    }

    const updated = await db.extension.update({
      where: { id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        reviewNotes: null,
      },
    });
    return NextResponse.json({ ok: true, plugin: updated });
  } catch (err) {
    console.error('[api/developer/publish/[id]/submit POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
