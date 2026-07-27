/**
 * /api/runtime/composer — compose a multi-hop + split execution plan.
 * (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * POST /api/runtime/composer
 *   Body: {
 *     from: "USD",
 *     to: "KES",
 *     amount: 5000,
 *     maxHops?: 4,           // default 4
 *     allowSplit?: true,     // default true
 *     offers: [              // LP offers (the liquidity graph edges)
 *       { lpId: "LP1", from: "USD", to: "KES", capacity: 10000, fxBps: 100, feeBps: 50, ... },
 *       { lpId: "LP2", from: "USD", to: "EUR", capacity: 8000, fxBps: 80, feeBps: 40, ... },
 *       { lpId: "LP4", from: "EUR", to: "KES", capacity: 6000, fxBps: 60, feeBps: 30, ... },
 *     ],
 *     bridges?: [...]        // reserve-backed bridges (optional)
 *   }
 *
 *   Returns: ComposedExecutionPlan (candidates, plan, legs, cost, alternatives)
 *
 * The composer is PURE — same inputs → same plan. No state, no events, no
 * execution. It only RECOMMENDS a plan.
 */

import { NextResponse } from 'next/server';
import { runtime, buildGraph, type CompositionRequest, type LPOfferInput, type ReserveBridgeInput } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { from, to, amount, offers = [], bridges = [], ...rest } = body;

    if (!from || !to || typeof amount !== 'number') {
      return NextResponse.json(
        { ok: false, error: 'Required: from (string), to (string), amount (number)' },
        { status: 400 },
      );
    }

    const request: CompositionRequest = {
      from,
      to,
      amount,
      maxHops: rest.maxHops ?? 4,
      allowSplit: rest.allowSplit ?? true,
    };

    const graph = buildGraph({
      offers: offers as LPOfferInput[],
      bridges: bridges as ReserveBridgeInput[],
    });

    const plan = runtime.composer.compose(request, graph);

    return NextResponse.json({
      ok: true,
      plan,
      summary: {
        isMultiHop: plan.isMultiHop,
        isSplit: plan.isSplit,
        maxHops: plan.maxHops,
        candidates: plan.candidates.length,
        alternatives: plan.alternatives.length,
        legs: plan.legs.length,
        totalCostBps: plan.cost.totalBps.toFixed(2),
        rationale: plan.plan.rationale,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

/** GET: return a sample composition (demonstrates the API). */
export async function GET() {
  try {
    // Sample: USD → KES with 3 LPs (direct + 2-hop via EUR).
    const offers: LPOfferInput[] = [
      { lpId: 'LP1', from: 'USD', to: 'KES', capacity: 10_000, fxBps: 120, feeBps: 50, reserveOppCostBps: 10, latencyMs: 5_000, riskScore: 0.05, failureProb: 0.02 },
      { lpId: 'LP2', from: 'USD', to: 'EUR', capacity: 8_000, fxBps: 40, feeBps: 20, reserveOppCostBps: 5, latencyMs: 2_000, riskScore: 0.02, failureProb: 0.01 },
      { lpId: 'LP4', from: 'EUR', to: 'KES', capacity: 6_000, fxBps: 50, feeBps: 25, reserveOppCostBps: 5, latencyMs: 3_000, riskScore: 0.03, failureProb: 0.01 },
    ];

    const request: CompositionRequest = {
      from: 'USD',
      to: 'KES',
      amount: 5_000,
    };

    const graph = buildGraph({ offers, bridges: [] });
    const plan = runtime.composer.compose(request, graph);

    return NextResponse.json({
      ok: true,
      summary: {
        isMultiHop: plan.isMultiHop,
        isSplit: plan.isSplit,
        maxHops: plan.maxHops,
        candidates: plan.candidates.length,
        legs: plan.legs.length,
        totalCostBps: plan.cost.totalBps.toFixed(2),
        rationale: plan.plan.rationale,
      },
      plan,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
