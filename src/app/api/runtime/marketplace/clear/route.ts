/**
 * GET /api/runtime/marketplace/clear — clear (match) offers for a request. (M-RT-5.)
 * READ-ONLY. Returns which offers would clear if requested. Does NOT execute.
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
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const amount = parseFloat(url.searchParams.get('amount') ?? '0');
  const rail = url.searchParams.get('rail') ?? undefined;
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  if (!from || !to || !amount) {
    return NextResponse.json({ error: 'Missing required params: from, to, amount' }, { status: 400 });
  }

  const result = await payswapRuntime.liquidityMarketplace.clear(
    { from, to, amount, rail: rail as never, now: payswapRuntime.clock.now() },
    environment,
  );

  return NextResponse.json({
    ...result,
    note: 'Clearing is deterministic. Nothing is executed — this shows which offers WOULD clear if requested.',
  });
}
