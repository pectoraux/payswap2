import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession, unauthorized, forbidden } from '@/lib/api-auth';
import { getEnvironment } from '@/lib/environment';
import { runWorldSimulation } from '@/lib/world-simulator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/simulate/world — Run the Digital Twin world simulation.
 *
 * Creates real DB records (payments, payouts, refunds, invoices, webhooks,
 * ledger entries, audit logs, compliance alerts) that flow through the same
 * tables every dashboard reads from.
 *
 * Requires ADMIN or SUPER_ADMIN role.
 */
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return unauthorized();

  const body = await req.json();
  const { duration, scenario } = body;

  if (!duration || !['1h', '1d', '1w', '1m'].includes(duration)) {
    return NextResponse.json({ error: 'Invalid duration. Must be: 1h, 1d, 1w, or 1m' }, { status: 400 });
  }

  if (!scenario || !['normal', 'holiday', 'outage', 'growth', 'stress'].includes(scenario)) {
    return NextResponse.json({ error: 'Invalid scenario. Must be: normal, holiday, outage, growth, or stress' }, { status: 400 });
  }

  const env = await getEnvironment();

  try {
    const result = await runWorldSimulation({ duration, scenario, environment: env });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({
      error: 'Simulation failed',
      message: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }
}
