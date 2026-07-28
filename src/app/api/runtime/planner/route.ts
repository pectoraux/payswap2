/**
 * GET /api/runtime/planner — execution planner telemetry
 *
 * Returns:
 *   - Recent execution traces (last 20)
 *   - Stats by profile, status, duration
 *   - Profile definitions
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { executionPlanner, PROFILES } from '@/runtime/planner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  return NextResponse.json({
    ok: true,
    stats: executionPlanner.getStats(),
    recentTraces: executionPlanner.getRecentTraces(20),
    profiles: Object.values(PROFILES).map(p => ({
      profile: p.profile,
      description: p.description,
      stages: p.stages,
      invokeCouncil: p.invokeCouncil,
      invokeTwin: p.invokeTwin,
      invokeSettlement: p.invokeSettlement,
      invokeCoordinator: p.invokeCoordinator,
      timeoutMs: p.timeoutMs,
    })),
  });
}
