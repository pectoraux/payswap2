/**
 * /api/runtime/recommendations — list all recommendation lifecycle states.
 * GET: read-only. (M-RT-10.)
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

  const states = await payswapRuntime.recLifecycle.listAll(environment);

  return NextResponse.json({
    recommendations: states.map((s) => ({
      recommendationId: s.recommendationId,
      currentState: s.currentState,
      detectedAt: s.detectedAt,
      lastTransitionAt: s.lastTransitionAt,
      historyCount: s.history.length,
      score: s.score,
      measurement: s.measurement,
    })),
    count: states.length,
    byState: states.reduce((acc, s) => {
      acc[s.currentState] = (acc[s.currentState] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  });
}
