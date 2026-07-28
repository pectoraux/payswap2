import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/[slug]
 *
 * Public plugin detail (no auth required). Returns the full PublicPlugin
 * shape (capabilities, permissions, pricing, screenshots, dependencies,
 * changelog, verification, etc.).
 *
 * Returns 404 when the slug doesn't exist OR the plugin isn't published.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const plugin = await pluginCatalog.getPlugin(slug);
    if (!plugin) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, plugin });
  } catch (err) {
    console.error('[api/marketplace/[slug] GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
