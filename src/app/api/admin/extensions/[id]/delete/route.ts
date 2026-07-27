import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { setFeatured } from '@/lib/extension-featured';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extensions/[id]/delete
 *
 * Admin-only. Hard-deletes an extension and all of its installs + reviews.
 * Reserved for abusive / spam submissions. Body (optional): { notes?: string }
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

  // Cascade cleanup (Prisma onDelete: Cascade on installs + reviews handles
  // this automatically, but be defensive in case the relation changes).
  await db.extensionInstall.deleteMany({ where: { extensionId: id } });
  await db.extensionReview.deleteMany({ where: { extensionId: id } });
  await db.extension.delete({ where: { id } });
  await setFeatured(id, false);

  return NextResponse.json({ ok: true, removed: true });
}
