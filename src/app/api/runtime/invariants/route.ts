/**
 * GET /api/runtime/invariants — invariant health report.
 * (M-RT-20, Economic Integrity Hardening.)
 *
 * Returns the health of all registered invariants:
 *   {
 *     total: 9,
 *     healthy: 9,
 *     unhealthy: 0,
 *     invariants: [
 *       { id, description, healthy, lastRun, violationCount, recentViolations },
 *       ...
 *     ]
 *   }
 *
 * POST /api/runtime/invariants — run a verification against the current
 * snapshot. Returns the VerificationDecision (allow + results + violations).
 *
 * The invariant engine is the GATE between the ExecutionPlan and the
 * EventStore. Every event append goes through verify() first.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = runtime.invariants.report();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const events = body?.events ?? [];
    const snapshot = body?.snapshot ?? {
      events: [],
      payments: new Map(),
      refunds: new Map(),
      reserves: new Map(),
      ledgerEntries: [],
      executionPlans: new Map(),
    };

    const decision = runtime.invariants.verify(events, snapshot);
    return NextResponse.json({
      ok: true,
      allow: decision.allow,
      results: decision.results,
      violations: decision.violations,
      durationMs: decision.durationMs,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
