/**
 * GET /api/runtime/projections — list health metrics for ALL migrated
 * projections. (M-RT-19, Projection Health.)
 *
 * The ops dashboard view. Returns one ProjectionHealth per registered
 * projection (payments, refunds, + future capabilities).
 *
 * No auth — this is a read-only health endpoint. Useful for monitoring,
 * dashboards, and alerting.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const all = await runtime.health.all();
    const healthyCount = all.filter((h) => h.healthy).length;
    return NextResponse.json({
      ok: true,
      total: all.length,
      healthy: healthyCount,
      unhealthy: all.length - healthyCount,
      projections: all,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
