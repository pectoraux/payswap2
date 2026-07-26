/**
 * POST /api/runtime/payments/create — the golden path. (M-RT-12.)
 *
 * The first end-to-end execution through the real runtime stack:
 *   Intent Engine → Financial Compiler (9 passes) → ExecutionPlan →
 *   Execution Pipeline (10 stages) → Settlement → Ledger → Events →
 *   Projections → Inspector
 *
 * No shortcuts. This is the vertical integration milestone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  runtime as payswapRuntime,
  type Environment,
  type RealCompilerContext,
  RouteScoringEngine,
} from '@/runtime';

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

  // ── Step 1: Build a TypedIntent ─────────────────────────────────────
  const intent = {
    id: `intent_pay_${Date.now().toString(36)}`,
    kind: 'payment' as const,
    actor: { id: (session.user as { id: string }).id, role: 'merchant' },
    environment: env,
    subject: {},
    desired: { from, to, amount, currency: to },
    constraints: {},
    evidence: [],
    correlationId: `pay_${Date.now().toString(36)}`,
    source: 'api' as const,
    createdAt: payswapRuntime.clock.now(),
  };

  // ── Step 2: Compile (pure — Financial Compiler, 9 passes) ──────────
  const routeGraph = payswapRuntime.routeCompiler.rebuild(
    payswapRuntime.capabilityGraph,
    payswapRuntime.clock.now(),
  );
  const scoringEngine = new RouteScoringEngine({
    routeGraph,
    capabilityGraph: payswapRuntime.capabilityGraph,
    reserveMarket: payswapRuntime.reserveMarket,
    liquidityMarketplace: payswapRuntime.liquidityMarketplace,
    clock: payswapRuntime.clock,
  });

  const ctx: RealCompilerContext = {
    clock: payswapRuntime.clock,
    environment: env,
    capabilityGraph: payswapRuntime.capabilityGraph,
    routeScoringEngine: scoringEngine,
    reserveMarket: payswapRuntime.reserveMarket,
    liquidityMarketplace: payswapRuntime.liquidityMarketplace,
  };

  const compileResult = await payswapRuntime.realCompiler.compile(intent, ctx);

  if (!compileResult.success || !compileResult.plan) {
    return NextResponse.json({
      success: false,
      error: compileResult.error,
      intent: { id: intent.id, from, to, amount },
      compileResult,
    }, { status: 422 });
  }

  // ── Step 3: Execute (side effects — Execution Pipeline, 10 stages) ──
  const executionResult = await payswapRuntime.executionPipeline.execute(
    compileResult.plan,
    intent,
    env,
  );

  // ── Step 4: Return the full execution trace ─────────────────────────
  return NextResponse.json({
    success: executionResult.status === 'completed',
    paymentId: executionResult.paymentId,
    status: executionResult.status,
    error: executionResult.error,
    trace: executionResult.trace,
    // Compiler detail:
    compiler: {
      passes: compileResult.plan.passes.map((p) => ({
        pass: p.pass,
        choice: p.decision.choice,
        reasoning: p.decision.reasoning,
        durationMs: p.durationMs,
      })),
      estimatedCostBps: compileResult.plan.estimatedCostBps,
      estimatedRisk: compileResult.plan.estimatedRisk,
      rationale: compileResult.plan.rationale,
      alternativesConsidered: compileResult.plan.alternativesConsidered.length,
    },
    // Pipeline detail:
    pipeline: {
      stages: executionResult.stages.map((s) => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs,
        detail: s.detail,
      })),
      domainEvents: executionResult.domainEvents,
    },
    // Plan detail:
    plan: {
      lpAllocations: compileResult.plan.lpAllocations,
      settlementLegs: compileResult.plan.settlementLegs,
      reserveAllocations: compileResult.plan.reserveAllocations,
      fxHops: compileResult.plan.fxHops,
      executionTiming: compileResult.plan.executionTiming,
    },
  }, { status: executionResult.status === 'completed' ? 200 : 500 });
}
