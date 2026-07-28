import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  requireAdminSession,
  forbidden,
} from '@/lib/api-auth';
import { payoutService } from '@/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/simulate/payout — generate a synthetic test payout.
 *
 * NH-3 FIX: Now dispatches through payoutService → executionPlanner →
 * dispatcher → invariants → event store → ledger. Previously bypassed
 * the kernel with direct db.payout.create().
 *
 * Requires ADMIN or SUPER_ADMIN role.
 */
export async function POST() {
  const adminSession = await requireAdminSession();
  if (!adminSession) return forbidden();

  const merchant = await db.merchant.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!merchant) {
    return NextResponse.json(
      { error: 'No merchant available to attach test payout' },
      { status: 400 },
    );
  }

  const amount = Math.round((50 + Math.random() * 1950) * 100) / 100;
  const methods = ['bank', 'mobile_money'];
  const method = methods[Math.floor(Math.random() * methods.length)];

  try {
    const payout = await payoutService.create({
      merchantId: merchant.id,
      method,
      amount,
      currency: merchant.currency,
      environment: 'sandbox',
      actorId: (adminSession.user as any).id,
    });

    await db.auditLog.create({
      data: {
        userId: (adminSession.user as any).id,
        action: 'SIMULATE.PAYOUT',
        resourceType: 'Payout',
        resourceId: payout.id,
        result: 'SUCCESS',
        details: JSON.stringify({ amount, currency: merchant.currency }),
      },
    });

    return NextResponse.json({
      ok: true,
      payout,
      message: `Created test payout for ${amount} ${merchant.currency}`,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Simulation failed' },
      { status: 500 },
    );
  }
}
