/** POST /api/runtime/scheduler/process — process due jobs. Triggers execution of pending jobs. */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, RouteScoringEngine, type RealCompilerContext } from '@/runtime';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await payswapRuntime.schedulingEngine.processDue(async (operation, body) => {
    // Dispatch through the same runtime path as API requests.
    const { from, to, amount } = body as { from?: string; to?: string; amount?: number };

    if (operation === 'execute-payment' && from && to && amount) {
      const routeGraph = payswapRuntime.routeCompiler.rebuild(payswapRuntime.capabilityGraph, payswapRuntime.clock.now());
      const scoringEngine = new RouteScoringEngine({
        routeGraph, capabilityGraph: payswapRuntime.capabilityGraph,
        reserveMarket: payswapRuntime.reserveMarket, liquidityMarketplace: payswapRuntime.liquidityMarketplace,
        clock: payswapRuntime.clock,
      });
      const ctx: RealCompilerContext = {
        clock: payswapRuntime.clock, environment: 'sandbox' as const,
        capabilityGraph: payswapRuntime.capabilityGraph, routeScoringEngine: scoringEngine,
        reserveMarket: payswapRuntime.reserveMarket, liquidityMarketplace: payswapRuntime.liquidityMarketplace,
      };
      const intent = {
        id: `intent_sched_${Date.now().toString(36)}`, kind: 'payment' as const,
        actor: { id: 'scheduler', role: 'system' }, environment: 'sandbox' as const,
        subject: {}, desired: { from, to, amount, currency: to }, constraints: {}, evidence: [],
        correlationId: `sched_${Date.now().toString(36)}`, source: 'api' as const, createdAt: payswapRuntime.clock.now(),
      };
      const compileResult = await payswapRuntime.realCompiler.compile(intent, ctx);
      if (!compileResult.success || !compileResult.plan) return { success: false, error: compileResult.error };
      const execResult = await payswapRuntime.executionPipeline.execute(compileResult.plan, intent, 'sandbox');
      return { success: execResult.status === 'completed', data: execResult };
    }

    if (operation === 'discover-opportunities') {
      const result = await payswapRuntime.opportunityDiscoveryV2.discover('sandbox');
      return { success: true, data: result };
    }

    return { success: false, error: `Unknown operation: ${operation}` };
  });

  return NextResponse.json(result);
}
