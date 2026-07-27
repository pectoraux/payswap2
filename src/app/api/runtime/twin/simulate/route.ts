/**
 * POST /api/runtime/twin/simulate — simulate a recommendation. (M-RT-11.)
 * READ-ONLY. Pure, deterministic. No events, no mutations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment, type SimulatableRecommendation } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { recommendation, environment } = body as {
    recommendation: SimulatableRecommendation;
    environment?: Environment;
  };

  if (!recommendation?.id || !recommendation?.kind) {
    return NextResponse.json({ error: 'Missing recommendation.id and recommendation.kind' }, { status: 400 });
  }

  const result = await payswapRuntime.digitalTwin.simulate(
    recommendation,
    environment ?? 'sandbox',
  );

  return NextResponse.json({
    ...result,
    note: 'Pure simulation. No events emitted, no projections mutated. The Recommendation Lifecycle owns state transitions.',
  });
}
