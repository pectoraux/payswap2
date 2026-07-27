/**
 * /api/runtime/migrations — list + manage capability migration states.
 * (M-RT-19 feedback: formalize migration state.)
 *
 * GET /api/runtime/migrations
 *   Returns migration records for ALL registered capabilities:
 *   [{ capability, version, startedAt, completedAt, checkpoint,
 *      eventsImported, canonicalRows, verified, status, error }]
 *
 * POST /api/runtime/migrations
 *   Body: { capability?: string, action: "trigger" | "verify" }
 *   - action: "trigger" — trigger backfill for one capability (or all if not specified)
 *   - action: "verify"  — run verification (idempotent backfill + health check)
 *
 * Operators can answer:
 *   - Has Payments been migrated? (status === 'complete')
 *   - Is Refunds partially migrated? (status === 'in-progress')
 *   - Can Wallets resume after interruption? (checkpoint + eventsImported)
 *   without inspecting projections.
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const records = runtime.migrations.allRecords();
    return NextResponse.json({
      ok: true,
      total: records.length,
      complete: records.filter((r) => r.status === 'complete').length,
      inProgress: records.filter((r) => r.status === 'in-progress').length,
      pending: records.filter((r) => r.status === 'pending').length,
      failed: records.filter((r) => r.status === 'failed').length,
      migrations: records,
    });
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
    const action = body?.action;
    const capability = body?.capability;

    if (action === 'trigger') {
      if (capability) {
        runtime.migrations.triggerBackfill(capability);
        return NextResponse.json({ ok: true, message: `Triggered backfill for ${capability}` });
      } else {
        runtime.migrations.triggerAll();
        return NextResponse.json({ ok: true, message: 'Triggered backfill for all capabilities' });
      }
    }

    if (action === 'verify') {
      if (!capability) {
        return NextResponse.json(
          { ok: false, error: 'verify action requires a capability' },
          { status: 400 },
        );
      }
      const result = await runtime.migrations.verify(capability);
      if (!result) {
        return NextResponse.json(
          { ok: false, error: `Unknown capability: ${capability}` },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json(
      { ok: false, error: 'Unknown action. Use "trigger" or "verify".' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    );
  }
}
