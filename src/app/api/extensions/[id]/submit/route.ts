import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/extensions/[id]/submit
 *
 * Submit an extension for review. Only the developer who owns the extension
 * may submit it, and only when it is currently in draft or rejected state.
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
    return NextResponse.json({ error: 'No user id in session' }, { status: 400 });
  }

  const extension = await db.extension.findUnique({ where: { id } });
  if (!extension) {
    return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
  }
  if (extension.developerId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!['draft', 'rejected'].includes(extension.status)) {
    return NextResponse.json(
      { error: `Cannot submit an extension in status '${extension.status}'` },
      { status: 400 },
    );
  }

  // Require at least one permission — extensions without any scope are
  // useless and a common source of bad submissions.
  let perms: string[] = [];
  try {
    const parsed = JSON.parse(extension.permissions);
    if (Array.isArray(parsed)) perms = parsed.filter((p) => typeof p === 'string');
  } catch {
    // ignore
  }
  if (perms.length === 0) {
    return NextResponse.json(
      { error: 'Extension must declare at least one permission' },
      { status: 400 },
    );
  }

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

  return NextResponse.json({ extension: updated });
}
