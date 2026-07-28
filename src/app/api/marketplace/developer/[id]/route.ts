import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/developer/[id]
 *
 * Public developer profile + their published plugins (no auth required).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { profile, plugins } = await pluginCatalog.getDeveloper(id);
    if (!profile) {
      return NextResponse.json(
        { ok: false, error: 'Developer not found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, profile, plugins });
  } catch (err) {
    console.error('[api/marketplace/developer/[id] GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
