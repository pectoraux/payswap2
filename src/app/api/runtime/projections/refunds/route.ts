/**
 * GET /api/runtime/projections/refunds — health metrics for the refunds
 * projection. (M-RT-19, Projection Health.)
 *
 * Same format as /api/runtime/projections/payments.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await runtime.refundBackfill.status();
    const health = await runtime.refunds.health(status.prismaCount);
    return NextResponse.json({ ok: true, ...health });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
