/**
 * GET /api/runtime/reserves/market — market snapshot for ALL reserves. (M-RT-4.)
 *
 * READ-ONLY. The market owns no state — everything is derived from the Reserve
 * Ledger on every call. No POST / PUT / DELETE — nothing in the market is
 * authoritative.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  const snapshot = await payswapRuntime.reserveMarket.getMarketSnapshotAll(environment);

  return NextResponse.json({
    ...snapshot,
    note: 'This is a derived read model. The market owns no state — everything is computed from the Reserve Ledger on every call.',
  });
}
