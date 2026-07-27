/**
 * DELETE /api/runtime/marketplace/offers/[id] — withdraw an offer. (M-RT-5.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: offerId } = await params;
  const url = new URL(req.url);
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  const correlationId = `offer_del_${Date.now().toString(36)}`;
  await payswapRuntime.liquidityMarketplace.withdraw(
    offerId,
    environment,
    (session.user as { id: string }).id,
    correlationId,
  );

  return NextResponse.json({ withdrawn: offerId });
}
