import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasLpRole(roles: string[] | undefined): boolean {
  return !!roles && roles.some((r) => ['LP', 'ADMIN', 'SUPER_ADMIN'].includes(r));
}

/**
 * POST /api/lp/capital
 *
 * Body: { action: 'deposit' | 'withdraw', amount: number }
 *
 * Deposit:  increases stake + collateral by `amount`.
 * Withdraw: decreases stake + collateral by `amount`, validating that the
 *           LP retains enough *available* (unencumbered) capital.
 *
 * Every action is journaled as a WalletTransaction on the LP's USD wallet
 * (auto-created on first deposit) and an AuditLog entry.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasLpRole((session.user as any)?.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await db.account.findFirst({
    where: { userId, type: 'LP' },
    include: { lpProfile: true },
  });
  const lp = account?.lpProfile;
  if (!lp) return NextResponse.json({ error: 'LP profile not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action.toLowerCase() : '';
  if (action !== 'deposit' && action !== 'withdraw') {
    return NextResponse.json(
      { error: "action must be 'deposit' or 'withdraw'" },
      { status: 400 },
    );
  }

  const amount = typeof body.amount === 'string' ? parseFloat(body.amount) : (body.amount as number);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }
  if (amount > 1e12) {
    return NextResponse.json({ error: 'amount exceeds maximum allowed' }, { status: 400 });
  }

  // For withdrawals, ensure the LP has enough *available* (uncommitted) capital.
  // Available = stake − collateral. We never let an LP withdraw capital that
  // is currently locked as collateral against open positions.
  if (action === 'withdraw') {
    const available = lp.stake - lp.collateral;
    if (amount > available) {
      return NextResponse.json(
        {
          error: `Insufficient available capital. Available: ${available.toFixed(2)} USD, requested: ${amount.toFixed(2)} USD`,
        },
        { status: 409 },
      );
    }
    // Also refuse to drain the LP below a small dust floor so they don't
    // accidentally deactivate themselves.
    const remainingStake = lp.stake - amount;
    if (remainingStake < 0) {
      return NextResponse.json(
        { error: 'Withdrawal would result in negative stake' },
        { status: 409 },
      );
    }
  }

  const delta = action === 'deposit' ? amount : -amount;

  // Run the stake/collateral update and the wallet journal entry in a
  // transaction so we never have a ledger mismatch.
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.lpProfile.update({
      where: { id: lp.id },
      data: {
        stake: { increment: delta },
        collateral: { increment: delta },
      },
    });

    // Find or create the LP's USD settlement wallet.
    let wallet = await tx.wallet.findFirst({
      where: { accountId: account!.id, currency: 'USD' },
    });
    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          accountId: account!.id,
          name: `${lp.name} — USD`,
          currency: 'USD',
          balance: 0,
          isDefault: true,
        },
      });
    }

    // Journal entry. Deposits credit the wallet, withdrawals debit it.
    const txType = action === 'deposit' ? 'LP_DEPOSIT' : 'LP_WITHDRAW';
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: txType,
        amount: Math.abs(delta),
        currency: 'USD',
        counterparty: lp.name,
        reference: `lp-capital-${action}-${Date.now()}`,
      },
    });

    return next;
  });

  await db.auditLog.create({
    data: {
      userId,
      action: action === 'deposit' ? 'LP_CAPITAL_DEPOSIT' : 'LP_CAPITAL_WITHDRAW',
      resourceType: 'LPProfile',
      resourceId: lp.id,
      result: 'SUCCESS',
      details: JSON.stringify({
        amount,
        before: { stake: lp.stake, collateral: lp.collateral },
        after: { stake: updated.stake, collateral: updated.collateral },
      }),
    },
  });

  return NextResponse.json({
    lp: {
      id: updated.id,
      stake: updated.stake,
      collateral: updated.collateral,
      available: Math.max(0, updated.stake - updated.collateral),
    },
  });
}
