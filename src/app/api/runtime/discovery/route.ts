/**
 * GET /api/runtime/discovery — discover network opportunities. (M-RT-9.)
 * READ-ONLY. Pure, deterministic. Produces immutable Recommendation objects.
 * No mutations, no randomness.
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

  const result = await payswapRuntime.opportunityDiscoveryV2.discover(environment);

  return NextResponse.json({
    ...result,
    note: 'Pure deterministic analysis. No mutations. Recommendations are immutable protocol objects with evidence + expectedValue + graphDiff.',
  });
}
