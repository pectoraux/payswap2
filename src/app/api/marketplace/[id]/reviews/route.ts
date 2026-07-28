import { NextRequest, NextResponse } from 'next/server';
import { pluginCatalog } from '@/marketplace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/marketplace/[id]/reviews
 *
 * List all reviews for a marketplace plugin (newest first). Public — no auth
 * required.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const reviews = await pluginCatalog.getReviews(id);
    return NextResponse.json({ ok: true, reviews, count: reviews.length });
  } catch (err) {
    console.error('[api/marketplace/[id]/reviews GET] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
