/**
 * GET /api/runtime/council — Economic Council report. (M-ECO-37.)
 * POST /api/runtime/council — Convene the council (collect proposals, debate, decide).
 */

import { NextResponse } from 'next/server';
import { runtime } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const report = runtime.council.getReport();
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const decisions = runtime.council.convene();
    return NextResponse.json({
      ok: true,
      totalDecisions: decisions.length,
      accepted: decisions.filter((d) => d.status === 'approved').length,
      rejected: decisions.filter((d) => d.status === 'rejected').length,
      requiresGovernance: decisions.filter((d) => d.status === 'requires_governance').length,
      decisions,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
