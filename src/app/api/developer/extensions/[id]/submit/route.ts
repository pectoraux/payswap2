import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/developer/extensions/[id]/submit
 *
 * Submit an extension for review. Transitions draft/rejected → submitted.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  const { id } = await params;
  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json({ ok: false, error: 'Extension not found' }, { status: 404 });
  }
  if (extension.developerId !== userId) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  if (!['draft', 'rejected'].includes(extension.status)) {
    return NextResponse.json(
      { ok: false, error: `Cannot submit an extension in status '${extension.status}'` },
      { status: 400 },
    );
  }

  // Require at least one permission.
  let perms: string[] = [];
  try {
    const parsed = JSON.parse(extension.permissions);
    if (Array.isArray(parsed)) perms = parsed.filter((p) => typeof p === 'string');
  } catch {
    // ignore
  }
  if (perms.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Extension must declare at least one permission' },
      { status: 400 },
    );
  }

  try {
    const updated = await db.extension.update({
      where: { id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: null,
      },
    });
    return NextResponse.json({ ok: true, extension: updated });
  } catch (err) {
    console.error('[api/developer/extensions submit] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
