import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { settlementOrderService } from '@/lp/settlement-store';
import {
  requireSession,
  unauthorized,
  forbidden,
} from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

/**
 * POST /api/lp/settlement-orders/[id]/claim
 *
 * An LP claims a pending settlement order, offering their own liquidity to
 * settle it. The order transitions `pending → matched` and is now associated
 * with the LP. The LP gets credited the fee once the settlement is final.
 *
 * Auth: LP / ADMIN / SUPER_ADMIN.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!hasLpRole((session.user as any)?.roles)) return forbidden();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return unauthorized();
  const actorEmail = (session.user as any)?.email as string | undefined;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Order id is required' }, { status: 400 });
  }

  // Resolve the LP profile.
  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lpId = account?.lpProfile?.id ?? 'seed-lp-1';
  const lpName = account?.lpProfile?.name ?? 'LP';

  // Try to claim.
  const order = settlementOrderService.claim(id, lpId);
  if (!order) {
    const existing = settlementOrderService.get(id);
    if (!existing) {
      return NextResponse.json({ error: 'Settlement order not found' }, { status: 404 });
    }
    if (existing.status === 'expired' || existing.deadlineAt < Date.now()) {
      return NextResponse.json(
        { error: 'This settlement order has expired — claim window closed' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: `Order is not claimable (current status: ${existing.status})`,
        status: existing.status,
      },
      { status: 409 },
    );
  }

  // Audit the claim.
  try {
    await db.auditLog.create({
      data: {
        userId,
        action: 'LP_SETTLEMENT_ORDER_CLAIMED',
        resourceType: 'SettlementOrder',
        resourceId: order.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          orderId: order.id,
          corridor: order.corridor,
          amount: order.amount,
          sourceCurrency: order.sourceCurrency,
          destinationCurrency: order.destinationCurrency,
          feeBps: order.feeBps,
          lpId,
          lpName,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort
  }

  return NextResponse.json({
    order: {
      ...order,
      createdAt: new Date(order.createdAt).toISOString(),
      deadlineAt: new Date(order.deadlineAt).toISOString(),
      claimedAt: order.claimedAt ? new Date(order.claimedAt).toISOString() : null,
      settledAt: order.settledAt ? new Date(order.settledAt).toISOString() : null,
    },
    lp: { id: lpId, name: lpName },
    status: 'claimed',
  });
}
