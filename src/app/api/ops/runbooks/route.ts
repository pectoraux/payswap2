import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/runbooks — list runbooks.
 *
 * Query params:
 *   - category: 'incident' | 'treasury' | 'settlement' | 'maintenance' | 'migration' | 'security'
 *   - component + severity: optional — if both provided, returns findForIncident results
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? undefined;
  const component = url.searchParams.get('component') ?? undefined;
  const severity = url.searchParams.get('severity') ?? undefined;

  // If both component + severity are provided, use findForIncident to
  // return a relevance-sorted list of applicable runbooks.
  if (component && severity) {
    const runbooks = await opsEngine.runbooks.findForIncident(
      component,
      severity,
    );
    return NextResponse.json({ runbooks });
  }

  const runbooks = await opsEngine.runbooks.list({ category });
  return NextResponse.json({ runbooks });
}
