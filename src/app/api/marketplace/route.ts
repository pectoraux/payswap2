import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace
 *
 * Public marketplace home endpoint (no auth required).
 *
 * Query params:
 *   section  — one of "featured" | "popular" | "newest" | "all" (default: "all")
 *              When omitted, returns all four sections in one response.
 *   limit    — per-section limit (default: 8, max: 24)
 *   category — restrict to a single category (optional)
 *
 * Response shape (when no section is specified):
 *   { ok, featured: [], popular: [], newest: [], categories: [...] }
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const section = url.searchParams.get('section') ?? 'all';
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitParam ?? '8', 10) || 8, 1), 24);
  const category = url.searchParams.get('category') ?? '';

  try {
    if (section === 'featured') {
      const featured = await pluginCatalog.getFeatured(limit);
      return NextResponse.json({ ok: true, featured });
    }
    if (section === 'popular') {
      const popular = await pluginCatalog.getPopular(limit);
      return NextResponse.json({ ok: true, popular });
    }
    if (section === 'newest') {
      const newest = await pluginCatalog.getNewest(limit);
      return NextResponse.json({ ok: true, newest });
    }
    if (section === 'category' && category) {
      const plugins = await pluginCatalog.getByCategory(category, limit);
      return NextResponse.json({ ok: true, plugins });
    }

    // Default: all sections in one response.
    const [featured, popular, newest] = await Promise.all([
      pluginCatalog.getFeatured(limit),
      pluginCatalog.getPopular(limit),
      pluginCatalog.getNewest(limit),
    ]);
    return NextResponse.json({
      ok: true,
      featured,
      popular,
      newest,
      categories: [
        'country',
        'settlement-rail',
        'identity-provider',
        'compliance-module',
        'wallet',
        'fraud-engine',
        'ai-director',
        'marketplace-algorithm',
        'analytics-pack',
      ],
    });
  } catch (err) {
    console.error('[api/marketplace GET] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
