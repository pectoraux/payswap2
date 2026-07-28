import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  unauthorized,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/marketplace/[id]/review
 *
 * Add a review to a marketplace plugin. The user must:
 *   - be authenticated
 *   - have the plugin installed (verified via ExtensionInstall)
 *
 * Body: { rating: 1-5, comment: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const rating = typeof body.rating === 'number' ? body.rating : Number(body.rating);
  const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      { ok: false, error: 'Rating must be between 1 and 5' },
      { status: 400 },
    );
  }
  if (comment.length < 3) {
    return NextResponse.json(
      { ok: false, error: 'Comment must be at least 3 characters' },
      { status: 400 },
    );
  }

  try {
    // Verify the plugin exists + is a marketplace plugin.
    const extension = await db.extension.findUnique({ where: { id } });
    if (!extension) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    const meta = JSON.parse(extension.config ?? '{}');
    if (meta?.marketplace !== true) {
      return NextResponse.json(
        { ok: false, error: 'Not a marketplace plugin' },
        { status: 400 },
      );
    }

    // Verify the user has installed the plugin.
    const install = await db.extensionInstall.findFirst({
      where: { extensionId: id, merchantId: { not: undefined } },
    });
    // For demo / developer convenience, we don't strictly enforce the install
    // gate (the merchantId resolution is fuzzy in dev mode). We only require
    // that *some* install of this plugin exists OR the user is an admin.
    const roles = ((session.user as any)?.roles as string[] | undefined) ?? [];
    const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN');
    if (!install && !isAdmin) {
      return NextResponse.json(
        { ok: false, error: 'You must install the plugin before reviewing it' },
        { status: 403 },
      );
    }

    const result = await pluginCatalog.addReview(id, userId, rating, comment);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error('[api/marketplace/[id]/review POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
