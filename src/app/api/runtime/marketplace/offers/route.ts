/**
 * /api/runtime/marketplace/offers — offer management. (M-RT-5.)
 *
 * GET  — list all active offers (the order book)
 * POST — publish an offer (emits offer.published)
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

  const book = await payswapRuntime.liquidityMarketplace.getOrderBook(environment);

  return NextResponse.json({
    offers: book.offers,
    count: book.offers.length,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { lpId, capabilityId, from, to, rail, maxAmount, minAmount, pricingCurve, latencyMs, riskScore, expiresAt, environment } = body as {
    lpId: string;
    capabilityId: string;
    from: string;
    to: string;
    rail: 'mobile_money' | 'bank' | 'card' | 'stablecoin' | 'blockchain';
    maxAmount: number;
    minAmount: number;
    pricingCurve: { utilizationRange: [number, number]; feeBps: number }[];
    latencyMs: number;
    riskScore: number;
    expiresAt?: number;
    environment?: Environment;
  };

  if (!lpId || !from || !to || !maxAmount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const correlationId = `offer_${Date.now().toString(36)}`;

  try {
    const offer = await payswapRuntime.liquidityMarketplace.publish(
      {
        lpId, capabilityId, from, to, rail, maxAmount, minAmount,
        pricingCurve, latencyMs: latencyMs ?? 5000, riskScore: riskScore ?? 0.2,
        expiresAt: expiresAt ?? 0,
      },
      environment ?? 'sandbox',
      (session.user as { id: string }).id,
      correlationId,
    );

    return NextResponse.json({ offer, correlationId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 422 });
  }
}
