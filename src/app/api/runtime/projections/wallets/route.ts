/**
 * GET /api/runtime/projections/wallets — health metrics for the wallets
 * projection. (M-RT-23, Wallet Capability Migration.)
 *
 * Same format as /api/runtime/projections/payments and /refunds.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await runtime.walletBackfill.status();
    const health = await runtime.wallets.health(status.prismaCount);
    return NextResponse.json({ ok: true, ...health });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
