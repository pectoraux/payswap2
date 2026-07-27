/**
 * /api/runtime/reserves — the Reserve Ledger API. (M-RT-3.)
 *
 * GET    /reserves                — list all reserves (with current balances)
 * GET    /reserves/:id            — get one reserve's state
 * POST   /reserves                — create a reserve
 * POST   /reserves/:id/transition — execute a transition (lock/unlock/consume/release/replenish)
 * GET    /reserves/:id/verify     — replay verification (check invariants hold)
 *
 * The ledger is event-derived. All state changes flow through Domain Events.
 * Invariants are enforced before every append.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment, type BackingPolicy, type ReserveTransition } from '@/runtime';

export const dynamic = 'force-dynamic';

/** GET /api/runtime/reserves — list all reserves. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const environment = (url.searchParams.get('environment') ?? 'sandbox') as Environment;

  const reserves = await payswapRuntime.reserveLedger.listReserves(environment);

  return NextResponse.json({
    reserves: reserves.map((s) => ({
      id: s.reserve.id,
      asset: s.reserve.asset,
      owner: s.reserve.owner,
      jurisdiction: s.reserve.jurisdiction,
      backingPolicy: s.reserve.backingPolicy,
      balances: s.balances,
      total: s.balances.available + s.balances.locked + s.balances.pending + s.balances.consumed + s.balances.released,
      version: s.version,
    })),
    count: reserves.length,
  });
}

/** POST /api/runtime/reserves — create a reserve. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await req.json();
  const { reserveId, asset, owner, jurisdiction, backingPolicy, environment } = body as {
    reserveId: string;
    asset: string;
    owner: string;
    jurisdiction: string;
    backingPolicy?: BackingPolicy;
    environment?: Environment;
  };

  if (!reserveId || !asset || !owner || !jurisdiction) {
    return NextResponse.json({ error: 'Missing required fields: reserveId, asset, owner, jurisdiction' }, { status: 400 });
  }

  try {
    const correlationId = `reserve_create_${Date.now().toString(36)}`;
    const state = await payswapRuntime.reserveLedger.create({
      reserveId,
      asset,
      owner,
      jurisdiction,
      backingPolicy: backingPolicy ?? 'fiat_full',
      environment: environment ?? 'sandbox',
      actorId: (session.user as { id: string }).id,
      correlationId,
    });

    return NextResponse.json({
      reserve: {
        id: state.reserve.id,
        asset: state.reserve.asset,
        owner: state.reserve.owner,
        jurisdiction: state.reserve.jurisdiction,
        backingPolicy: state.reserve.backingPolicy,
        balances: state.balances,
        version: state.version,
      },
      correlationId,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
