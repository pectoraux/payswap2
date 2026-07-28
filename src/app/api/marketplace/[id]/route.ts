import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/[id]
 *
 * Public plugin detail (no auth required). Accepts either the plugin ID
 * or the slug (the catalog tries both). Returns the full PublicPlugin
 * shape (capabilities, permissions, pricing, screenshots, dependencies,
 * changelog, verification, etc.).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Try slug first (public-facing), then fall back to ID lookup.
    const plugin = await pluginCatalog.getPlugin(id);
    if (!plugin) {
      return NextResponse.json(
        { ok: false, error: 'Plugin not found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, plugin });
  } catch (err) {
    console.error('[api/marketplace/[id] GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
