/**
 * GET /api/runtime/routes/rank — rank routes for a request. (M-RT-6.)
 * READ-ONLY. Pure deterministic scoring. Does NOT execute anything.
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
  const maxCostBps = url.searchParams.get('maxCostBps') ? parseFloat(url.searchParams.get('maxCostBps')!) : undefined;
  const maxLatencyMs = url.searchParams.get('maxLatencyMs') ? parseFloat(url.searchParams.get('maxLatencyMs')!) : undefined;
  const maxRisk = url.searchParams.get('maxRisk') ? parseFloat(url.searchParams.get('maxRisk')!) : undefined;
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  if (!from || !to || !amount) {
    return NextResponse.json({ error: 'Missing required params: from, to, amount' }, { status: 400 });
  }

  // Rebuild the Route Graph from the current Capability Graph.
  const routeGraph = payswapRuntime.routeCompiler.rebuild(
    payswapRuntime.capabilityGraph,
    payswapRuntime.clock.now(),
  );

  // Create a fresh scoring engine with the rebuilt route graph.
  const { RouteScoringEngine } = await import('@/runtime');
  const engine = new RouteScoringEngine({
    routeGraph,
    capabilityGraph: payswapRuntime.capabilityGraph,
    reserveMarket: payswapRuntime.reserveMarket,
    liquidityMarketplace: payswapRuntime.liquidityMarketplace,
    clock: payswapRuntime.clock,
  });

  const result = await engine.rank(
    { from, to, amount, maxCostBps, maxLatencyMs, maxRisk, now: payswapRuntime.clock.now() },
    environment,
  );

  return NextResponse.json({
    ...result,
    note: 'Pure deterministic scoring. Nothing is executed. Decomposed score components are visible for Inspector explanations.',
  });
}
