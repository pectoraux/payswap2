/**
 * GET /api/runtime/reserves/[id]/verify — replay verification. (M-RT-3.)
 *
 * Rebuilds the reserve state from its event stream and verifies all
 * invariants hold. This is part of the implementation, not just a test
 * (Principle 6: Deterministic Replay).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: reserveId } = await params;
  const url = new URL(_req.url);
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  const result = await payswapRuntime.reserveLedger.verifyReplay(reserveId, environment);

  return NextResponse.json({
    reserveId,
    environment,
    valid: result.valid,
    violations: result.violations,
    state: result.state ? {
      id: result.state.reserve.id,
      asset: result.state.reserve.asset,
      balances: result.state.balances,
      total: result.state.balances.available + result.state.balances.locked + result.state.balances.pending + result.state.balances.consumed + result.state.balances.released,
      version: result.state.version,
    } : null,
  });
}
