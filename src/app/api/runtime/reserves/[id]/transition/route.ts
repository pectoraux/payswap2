/**
 * POST /api/runtime/reserves/[id]/transition — execute a reserve transition.
 * (M-RT-3.)
 *
 * Body: { transition, amount, reason, operationId?, source?, environment? }
 *
 * Transitions: lock, unlock, consume, release, replenish
 * Invariants are enforced before the event is appended.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { runtime as payswapRuntime, type Environment, type ReserveTransition, ReserveInvariantViolation, ReserveNotFoundError } from '@/runtime';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const { id: reserveId } = await params;
  const body = await req.json();
  const { transition, amount, reason, operationId, source, environment } = body as {
    transition: ReserveTransition;
    amount: number;
    reason: string;
    operationId?: string;
    source?: string;
    environment?: Environment;
  };

  if (!transition || amount === undefined || !reason) {
    return NextResponse.json({ error: 'Missing required fields: transition, amount, reason' }, { status: 400 });
  }

  const correlationId = `reserve_${transition}_${Date.now().toString(36)}`;

  try {
    const state = await payswapRuntime.reserveLedger.transition({
      reserveId,
      transition,
      amount,
      reason,
      operationId,
      source,
      environment: environment ?? 'sandbox',
      actorId: (session.user as { id: string }).id,
      correlationId,
    });

    return NextResponse.json({
      reserve: {
        id: state.reserve.id,
        balances: state.balances,
        total: state.balances.available + state.balances.locked + state.balances.pending + state.balances.consumed + state.balances.released,
        version: state.version,
      },
      transition,
      amount,
      correlationId,
    });
  } catch (err) {
    if (err instanceof ReserveInvariantViolation) {
      return NextResponse.json({
        error: 'Invariant violation',
        reserveId: err.reserveId,
        transition: err.transition,
        violations: err.violations,
      }, { status: 422 });
    }
    if (err instanceof ReserveNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 400 });
  }
}
