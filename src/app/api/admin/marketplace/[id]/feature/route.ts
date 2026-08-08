import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { pluginCatalog } from '@/marketplace';
import { writeAudit } from '@/lib/audit-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/marketplace/[id]/feature
 *
 * Feature or unfeature a published marketplace plugin.
 *
 * Body: { featured: boolean }
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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const featured = body.featured === true;

  try {
    const result = await pluginCatalog.setFeatured(id, featured);

    // P3-5 (H-9 fix): audit-log the admin state change.
    await writeAudit({
      userId: (session.user as any)?.id ?? null,
      action: 'MARKETPLACE_PLUGIN_FEATURE',
      resourceType: 'Extension',
      resourceId: id,
      result: 'SUCCESS',
      details: { featured: result, requested: featured },
    });

    return NextResponse.json({ ok: true, featured: result });
  } catch (err) {
    console.error('[api/admin/marketplace/[id]/feature POST] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
