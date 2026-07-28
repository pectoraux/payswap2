import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog, isValidMarketplaceCategory } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/category/[category]
 *
 * List all published plugins in a category. Query params:
 *   sort  — popular (default) | newest | rating | name
 *   limit — default 100, max 200
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ category: string }> },
) {
  const { category } = await params;
  if (!isValidMarketplaceCategory(category)) {
    return NextResponse.json(
      { ok: false, error: `Invalid category: ${category}` },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(Math.max(parseInt(limitParam ?? '100', 10) || 100, 1), 200);

  try {
    let plugins = await pluginCatalog.getByCategory(category, limit);

    // In-memory sort (the catalog default is popularity).
    const sort = url.searchParams.get('sort') ?? 'popular';
    if (sort === 'newest') {
      plugins = plugins.sort(
        (a, b) =>
          new Date(b.publishedAt ?? b.createdAt).getTime() -
          new Date(a.publishedAt ?? a.createdAt).getTime(),
      );
    } else if (sort === 'rating') {
      plugins = plugins.sort((a, b) => b.rating - a.rating);
    } else if (sort === 'name') {
      plugins = plugins.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      plugins = plugins.sort((a, b) => b.installCount - a.installCount);
    }

    return NextResponse.json({ ok: true, plugins, count: plugins.length });
  } catch (err) {
    console.error('[api/marketplace/category/[category] GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
