import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { db } from '@/lib/db';
import { toggleFeatured } from '@/lib/extension-featured';
import { writeAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/extensions/[id]/feature
 *
 * Admin-only. Toggles the featured flag on an extension. Body (optional):
 *   { featured?: boolean }  — explicit set; omit to toggle.
 *
 * Returns the new featured state.
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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let featured: boolean;
  if (typeof body.featured === 'boolean') {
    // Set explicitly. We still call toggleFeatured when needed to keep state
    // consistent — but it's simpler to import setFeatured directly.
    const { setFeatured } = await import('@/lib/extension-featured');
    featured = await setFeatured(id, body.featured);
  } else {
    featured = await toggleFeatured(id);
  }

  // P3-5 (H-9 fix): audit-log the admin state change.
  await writeAudit({
    userId: (adminSession.user as any)?.id ?? null,
    action: 'EXTENSION_FEATURE_TOGGLE',
    resourceType: 'Extension',
    resourceId: id,
    result: 'SUCCESS',
    details: { featured, explicit: typeof body.featured === 'boolean' },
  });

  return NextResponse.json({ ok: true, extensionId: id, featured });
}
