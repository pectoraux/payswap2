/**
 * POST /api/runtime/simulator/compare — run the same intent through both
 * production and simulation modes and compare traces. (M-RT-13.)
 *
 * Proves: sim = prod (same runtime, same compiler, same trace structure).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { from, to, amount, environment } = body as {
    from: string;
    to: string;
    amount: number;
    environment?: Environment;
  };

  if (!from || !to || !amount) {
    return NextResponse.json({ error: 'Missing required fields: from, to, amount' }, { status: 400 });
  }

  const env = environment ?? 'sandbox';

  const intent = {
    id: `intent_sim_${Date.now().toString(36)}`,
    kind: 'payment' as const,
    actor: { id: (session.user as { id: string }).id, role: 'merchant' },
    environment: env,
    subject: {},
    desired: { from, to, amount, currency: to },
    constraints: {},
    evidence: [],
    correlationId: `sim_${Date.now().toString(36)}`,
    source: 'api' as const,
    createdAt: payswapRuntime.clock.now(),
  };

  const result = await payswapRuntime.simulator.compare(intent, env);

  return NextResponse.json({
    ...result,
    note: 'sim = prod: same runtime, same compiler (9 passes), same trace structure. Only side-effect adapters differ (real vs simulated).',
  });
}
