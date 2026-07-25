import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession, unauthorized } from '@/lib/api-auth';
import { getEnvironment } from '@/lib/environment';
import { runWorldSimulation, type CustomSimParams, type ActorFilter } from '@/lib/world-simulator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/simulate/world/custom — Run the Digital Twin world simulation
 * with custom probability parameters and actor selection.
 *
 * Body:
 *   {
 *     duration: '1h' | '1d' | '1w' | '1m',
 *     customParams: {
 *       successRate, refundRate, webhookFailureRate,
 *       complianceAlertRate, highValueRate, payoutFrequency
 *     },
 *     actorFilter?: { merchantIds?: string[], lpIds?: string[] }
 *   }
 *
 * Requires ADMIN or SUPER_ADMIN role.
 */
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return unauthorized();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { duration, customParams, actorFilter } = body ?? {};

  if (!duration || !['1h', '1d', '1w', '1m'].includes(duration)) {
    return NextResponse.json(
      { error: 'Invalid duration. Must be: 1h, 1d, 1w, or 1m' },
      { status: 400 },
    );
  }

  // Validate custom params (each is 0-1 probability, clamped)
  const clamp01 = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(1, n));
  };

  const validCustom: CustomSimParams = {};
  if (customParams && typeof customParams === 'object') {
    const sr = clamp01(customParams.successRate);
    const rr = clamp01(customParams.refundRate);
    const wfr = clamp01(customParams.webhookFailureRate);
    const car = clamp01(customParams.complianceAlertRate);
    const hvr = clamp01(customParams.highValueRate);
    const pf = clamp01(customParams.payoutFrequency);
    if (sr !== undefined) validCustom.successRate = sr;
    if (rr !== undefined) validCustom.refundRate = rr;
    if (wfr !== undefined) validCustom.webhookFailureRate = wfr;
    if (car !== undefined) validCustom.complianceAlertRate = car;
    if (hvr !== undefined) validCustom.highValueRate = hvr;
    if (pf !== undefined) validCustom.payoutFrequency = pf;
  }

  // Validate actor filter
  let validFilter: ActorFilter | undefined;
  if (actorFilter && typeof actorFilter === 'object') {
    validFilter = {};
    if (Array.isArray(actorFilter.merchantIds)) {
      validFilter.merchantIds = actorFilter.merchantIds.filter((id: any) => typeof id === 'string');
    }
    if (Array.isArray(actorFilter.lpIds)) {
      validFilter.lpIds = actorFilter.lpIds.filter((id: any) => typeof id === 'string');
    }
  }

  const env = await getEnvironment();

  try {
    const result = await runWorldSimulation({
      duration,
      scenario: 'custom',
      environment: env,
      customParams: validCustom,
      actorFilter: validFilter,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Custom simulation failed',
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
