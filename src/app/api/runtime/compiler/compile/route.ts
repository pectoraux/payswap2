/**
 * POST /api/runtime/compiler/compile — compile a TypedIntent into an ExecutionPlan.
 * (M-RT-7.)
 *
 * The compiler is PURE: it reads all lower-layer projections but mutates none.
 * It produces an ExecutionPlan + a routing result, both inspectable.
 * No side effects, no events, no execution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment, type RealCompilerContext, RouteScoringEngine } from '@/runtime';

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

  // Build a TypedIntent (minimal — M-RT-12 wires the real Intent Engine).
  const intent = {
    id: `intent_compile_${Date.now().toString(36)}`,
    kind: 'payment' as const,
    actor: { id: (session.user as { id: string }).id, role: 'merchant' },
    environment: env,
    subject: {},
    desired: { from, to, amount, currency: to },
    constraints: {},
    evidence: [],
    correlationId: `compile_${Date.now().toString(36)}`,
    source: 'api' as const,
    createdAt: payswapRuntime.clock.now(),
  };

  // Rebuild the Route Graph from the current Capability Graph.
  const routeGraph = payswapRuntime.routeCompiler.rebuild(
    payswapRuntime.capabilityGraph,
    payswapRuntime.clock.now(),
  );

  // Create a fresh RouteScoringEngine with the rebuilt route graph.
  const scoringEngine = new RouteScoringEngine({
    routeGraph,
    capabilityGraph: payswapRuntime.capabilityGraph,
    reserveMarket: payswapRuntime.reserveMarket,
    liquidityMarketplace: payswapRuntime.liquidityMarketplace,
    clock: payswapRuntime.clock,
  });

  // Build the compiler context with all lower-layer projections.
  const ctx: RealCompilerContext = {
    clock: payswapRuntime.clock,
    environment: env,
    capabilityGraph: payswapRuntime.capabilityGraph,
    routeScoringEngine: scoringEngine,
    reserveMarket: payswapRuntime.reserveMarket,
    liquidityMarketplace: payswapRuntime.liquidityMarketplace,
  };

  // Compile!
  const result = await payswapRuntime.realCompiler.compile(intent, ctx);

  return NextResponse.json({
    ...result,
    note: 'The compiler is PURE — it reads projections but mutates nothing. No events, no execution.',
  });
}
