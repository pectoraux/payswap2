import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TREASURY_ROLES = new Set(['TREASURY', 'ADMIN', 'SUPER_ADMIN']);

/**
 * POST /api/treasury/rebalance
 *
 * Trigger a corridor rebalance — moving reserve liquidity from an
 * over-reserved corridor to an under-reserved one. Body:
 *   { fromCorridor: string, toCorridor: string, amount: number, reason?: string }
 *
 * Auth: TREASURY, ADMIN or SUPER_ADMIN.
 *
 * This endpoint records the operator-initiated rebalance request as a
 * TREASURY.REBALANCE AuditLog entry. The actual liquidity-network call is
 * performed by the treasury balancing engine (see protocol/treasury-v2);
 * this route is the audited entry-point from the treasury console.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const roles = (session.user as any)?.roles as string[] | undefined;
  if (!roles || !roles.some((r) => TREASURY_ROLES.has(r))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  const actorEmail = (session.user as any)?.email as string | undefined;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const fromCorridor =
    typeof body?.fromCorridor === 'string' ? body.fromCorridor.trim() : '';
  const toCorridor =
    typeof body?.toCorridor === 'string' ? body.toCorridor.trim() : '';
  if (!fromCorridor || !toCorridor) {
    return NextResponse.json(
      { error: 'fromCorridor and toCorridor are required' },
      { status: 400 },
    );
  }
  if (fromCorridor === toCorridor) {
    return NextResponse.json(
      { error: 'fromCorridor and toCorridor must differ' },
      { status: 400 },
    );
  }

  const amount =
    typeof body?.amount === 'string'
      ? parseFloat(body.amount)
      : (body?.amount as number);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: 'amount must be a positive number' },
      { status: 400 },
    );
  }
  if (amount > 1e15) {
    return NextResponse.json(
      { error: 'amount exceeds maximum allowed' },
      { status: 400 },
    );
  }

  const reason =
    typeof body?.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : null;

  const log = await db.auditLog.create({
    data: {
      userId: userId ?? null,
      action: 'TREASURY.REBALANCE',
      resourceType: 'corridor',
      resourceId: `${fromCorridor}→${toCorridor}`,
      result: 'SUCCESS',
      details: JSON.stringify({
        fromCorridor,
        toCorridor,
        amount,
        reason,
        actorEmail: actorEmail ?? null,
      }),
    },
  });

  return NextResponse.json({
    rebalanced: true,
    fromCorridor,
    toCorridor,
    amount,
    auditLogId: log.id,
    createdAt: log.createdAt,
  });
}
