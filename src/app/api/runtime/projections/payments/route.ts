/**
 * GET /api/runtime/projections/payments — health metrics for the payments
 * projection. (M-RT-19, Projection Health.)
 *
 * Returns ProjectionHealth JSON:
 *   {
 *     "projection": "payments",
 *     "version": 1,
 *     "eventsApplied": 271,
 *     "rows": 271,
 *     "lag": 0,
 *     "healthy": true,
 *     "lastReplayMs": 12,
 *     "checkpoint": 270,
 *     "canonicalRows": 271,
 *     "message": "Healthy"
 *   }
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await runtime.paymentBackfill.status();
    const health = await runtime.payments.health(status.prismaCount);
    return NextResponse.json({ ok: true, ...health });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
