/**
 * POST /api/runtime/gateway/dispatch — single ingress for runtime operations.
 * (M-RT-15.) Auth, validation, idempotency, rate limiting, correlation IDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type GatewayRequest, type Environment, RouteScoringEngine, type RealCompilerContext } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { operation, body: opBody, environment, idempotencyKey } = body as {
    operation: string;
    body: Record<string, unknown>;
    environment?: Environment;
    idempotencyKey?: string;
  };

  if (!operation) {
    return NextResponse.json({ error: 'Missing operation' }, { status: 400 });
  }

  const gatewayRequest: GatewayRequest = {
    operation: operation as GatewayRequest['operation'],
    body: opBody ?? {},
    actor: {
      id: (session.user as { id: string }).id,
      role: (session.user as { roles?: string[] }).roles?.[0] ?? 'merchant',
    },
    environment: environment ?? 'sandbox',
    idempotencyKey,
    correlationId: req.headers.get('x-correlation-id') ?? undefined,
  };

  // Dispatch handler — routes to the correct runtime operation.
  const response = await payswapRuntime.apiGateway.process(gatewayRequest, async (req, correlationId) => {
    const env = req.environment;
    const { from, to, amount } = req.body as { from?: string; to?: string; amount?: number };

    switch (req.operation) {
      case 'compile': {
        const routeGraph = payswapRuntime.routeCompiler.rebuild(payswapRuntime.capabilityGraph, payswapRuntime.clock.now());
        const scoringEngine = new RouteScoringEngine({
          routeGraph, capabilityGraph: payswapRuntime.capabilityGraph,
          reserveMarket: payswapRuntime.reserveMarket, liquidityMarketplace: payswapRuntime.liquidityMarketplace,
          clock: payswapRuntime.clock,
        });
        const ctx: RealCompilerContext = {
          clock: payswapRuntime.clock, environment: env,
          capabilityGraph: payswapRuntime.capabilityGraph, routeScoringEngine: scoringEngine,
          reserveMarket: payswapRuntime.reserveMarket, liquidityMarketplace: payswapRuntime.liquidityMarketplace,
        };
        const intent = {
          id: `intent_gw_${Date.now().toString(36)}`, kind: 'payment' as const,
          actor: req.actor, environment: env, subject: {},
          desired: { from, to, amount, currency: to }, constraints: {}, evidence: [],
          correlationId, source: 'api' as const, createdAt: payswapRuntime.clock.now(),
        };
        const result = await payswapRuntime.realCompiler.compile(intent, ctx);
        return result;
      }
      case 'execute-payment': {
        // Full golden path: compile + execute
        const routeGraph = payswapRuntime.routeCompiler.rebuild(payswapRuntime.capabilityGraph, payswapRuntime.clock.now());
        const scoringEngine = new RouteScoringEngine({
          routeGraph, capabilityGraph: payswapRuntime.capabilityGraph,
          reserveMarket: payswapRuntime.reserveMarket, liquidityMarketplace: payswapRuntime.liquidityMarketplace,
          clock: payswapRuntime.clock,
        });
        const ctx: RealCompilerContext = {
          clock: payswapRuntime.clock, environment: env,
          capabilityGraph: payswapRuntime.capabilityGraph, routeScoringEngine: scoringEngine,
          reserveMarket: payswapRuntime.reserveMarket, liquidityMarketplace: payswapRuntime.liquidityMarketplace,
        };
        const intent = {
          id: `intent_gw_${Date.now().toString(36)}`, kind: 'payment' as const,
          actor: req.actor, environment: env, subject: {},
          desired: { from, to, amount, currency: to }, constraints: {}, evidence: [],
          correlationId, source: 'api' as const, createdAt: payswapRuntime.clock.now(),
        };
        const compileResult = await payswapRuntime.realCompiler.compile(intent, ctx);
        if (!compileResult.success || !compileResult.plan) throw new Error(compileResult.error ?? 'Compile failed');
        const execResult = await payswapRuntime.executionPipeline.execute(compileResult.plan, intent, env);
        return execResult;
      }
      case 'discover-opportunities': {
        return await payswapRuntime.opportunityDiscoveryV2.discover(env);
      }
      case 'get-inspector': {
        return await payswapRuntime.inspector.getNetworkOverview(env);
      }
      default:
        throw new Error(`Unknown operation: ${req.operation}`);
    }
  });

  return NextResponse.json(response);
}
