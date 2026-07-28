import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * @deprecated(HARDEN-FIX) — Consolidated into `/api/lp/ai-assistant` (GET).
 *
 * This endpoint is preserved as a permanent 308 redirect so any external
 * callers (bookmarks, scripts, API docs) are transparently routed to the
 * canonical LP AI surface. The query string (`?refresh=1` etc.) is preserved.
 *
 * Behavior:
 *   - GET /api/ai/lp-recommendations?refresh=1
 *   - → 308 redirect to /api/lp/ai-assistant?refresh=1
 *
 * The response shape from the new endpoint is identical:
 *   `{ recommendations: LpRecommendation[], cached: boolean }`.
 *
 * Safe to delete entirely once all frontend references are migrated; for
 * now we keep it as a safety net.
 */
export async function GET(req: NextRequest) {
  const search = req.nextUrl.search;
  const target = `/api/lp/ai-assistant${search}`;
  return NextResponse.redirect(target, { status: 308 });
}
