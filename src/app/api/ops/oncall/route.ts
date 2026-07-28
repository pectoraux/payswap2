import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/ops/api-auth';
import { opsEngine } from '@/ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/oncall — current on-call roster + upcoming schedule.
 *
 * Query params:
 *   - from: number (ms epoch) — schedule range start (defaults to now - 7d)
 *   - to: number (ms epoch) — schedule range end (defaults to now + 14d)
 */
export async function GET(req: NextRequest) {
  const auth = await requireOpsAuth();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const now = Date.now();
  const from = Number(url.searchParams.get('from') ?? now - 7 * 24 * 60 * 60 * 1000);
  const to = Number(url.searchParams.get('to') ?? now + 14 * 24 * 60 * 60 * 1000);

  const [roster, schedule] = await Promise.all([
    opsEngine.onCall.getActiveRoster(),
    opsEngine.onCall.getSchedule(from, to),
  ]);
  return NextResponse.json({ roster, schedule, now });
}
