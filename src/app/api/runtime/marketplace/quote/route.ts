/**
 * GET /api/runtime/marketplace/quote — get quotes for a request. (M-RT-5.)
 * READ-ONLY. Does not execute anything.
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

  const quotes = await payswapRuntime.liquidityMarketplace.quote(
    { from, to, amount, rail: rail as never, now: payswapRuntime.clock.now() },
    environment,
  );

  return NextResponse.json({
    quotes,
    validCount: quotes.filter((q) => q.status === 'valid').length,
    note: 'Quotes are derived from the order book. Nothing is executed.',
  });
}
