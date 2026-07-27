/**
 * GET /api/runtime/reserves/[id]/market — market snapshot for ONE reserve. (M-RT-4.)
 * READ-ONLY.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: reserveId } = await params;
  const url = new URL(req.url);
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  const snapshot = await payswapRuntime.reserveMarket.getMarketSnapshot(reserveId, environment);

  if (!snapshot) {
    return NextResponse.json({ error: `Reserve ${reserveId} not found` }, { status: 404 });
  }

  return NextResponse.json(snapshot);
}
