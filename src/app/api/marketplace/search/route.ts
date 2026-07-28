import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog, type SearchFilters } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/search?q=...
 *
 * Full-text search across plugin name, description, capabilities, tags.
 * Faceted filters via query params:
 *   category        — single category
 *   pricing         — free | one-time | subscription | usage-based
 *   minRating       — number 1-5
 *   capabilityType  — SDK CapabilityType
 *   free            — "1" to restrict to free plugins
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const category = url.searchParams.get('category') ?? 'all';
  const pricing = url.searchParams.get('pricing') ?? 'all';
  const minRatingRaw = url.searchParams.get('minRating');
  const capabilityType = url.searchParams.get('capabilityType') ?? 'all';
  const free = url.searchParams.get('free') === '1';

  const minRating =
    minRatingRaw && !Number.isNaN(parseFloat(minRatingRaw))
      ? Math.min(Math.max(parseFloat(minRatingRaw), 0), 5)
      : undefined;

  const filters: SearchFilters = {
    category: category as SearchFilters['category'],
    pricing: pricing as SearchFilters['pricing'],
    minRating,
    capabilityType: capabilityType as SearchFilters['capabilityType'],
    free,
  };

  try {
    const plugins = await pluginCatalog.search(q, filters);
    return NextResponse.json({ ok: true, plugins, count: plugins.length, query: q });
  } catch (err) {
    console.error('[api/marketplace/search GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
