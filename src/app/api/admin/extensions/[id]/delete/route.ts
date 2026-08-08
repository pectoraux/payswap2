import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { setFeatured } from '@/lib/extension-featured';
import { writeAudit } from '@/lib/audit-log';

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

  // Capture metadata BEFORE the cascade delete (we need name/slug/developerId
  // for the audit log — once the row is gone they're unrecoverable).
  const snapshot = {
    name: extension.name,
    slug: extension.slug,
    developerId: extension.developerId,
    version: extension.version,
    status: extension.status,
  };

  // Cascade cleanup (Prisma onDelete: Cascade on installs + reviews handles
  // this automatically, but be defensive in case the relation changes).
  await db.extensionInstall.deleteMany({ where: { extensionId: id } });
  await db.extensionReview.deleteMany({ where: { extensionId: id } });
  await db.extension.delete({ where: { id } });
  await setFeatured(id, false);

  // P3-5 (H-9 fix): audit-log the admin hard-delete. The row is gone, but
  // the audit entry preserves who deleted what + when (the snapshot fields
  // are what a forensic investigator would need).
  await writeAudit({
    userId: (adminSession.user as any)?.id ?? null,
    action: 'EXTENSION_DELETE',
    resourceType: 'Extension',
    resourceId: id,
    result: 'SUCCESS',
    details: { snapshot },
  });

  return NextResponse.json({ ok: true, removed: true });
}
