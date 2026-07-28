import { NextRequest, NextResponse } from 'next/server';
import {
  requireSession,
  requireAdminSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/marketplace
 *
 * Admin-only. Returns ALL marketplace plugins (any status) for the review
 * dashboard. Query params:
 *   status — single status filter
 *   q      — search name + slug
 *   section — "pending" (default) | "all" | "published"
 */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const url = new URL(req.url);
  const status = url.searchParams.get('status')?.toLowerCase().trim();
  const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const section = url.searchParams.get('section') ?? 'pending';

  try {
    let plugins;
    if (section === 'all') {
      plugins = await pluginCatalog.listAllForAdmin();
    } else if (section === 'published') {
      const all = await pluginCatalog.listAllForAdmin();
      plugins = all.filter((p) => p.status === 'published');
    } else {
      // pending: anything in the submission/review pipeline.
      plugins = await pluginCatalog.listPendingReview();
    }

    // In-memory filters.
    if (status && status !== 'all') {
      plugins = plugins.filter((p) => p.status === status);
    }
    if (q) {
      plugins = plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q),
      );
    }

    return NextResponse.json({ ok: true, plugins, count: plugins.length });
  } catch (err) {
    console.error('[api/admin/marketplace GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
