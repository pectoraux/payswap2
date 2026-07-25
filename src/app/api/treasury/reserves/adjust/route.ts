import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TREASURY_ROLES = new Set(['TREASURY', 'ADMIN', 'SUPER_ADMIN']);

const RESERVE_MERCHANT_NAME = 'PaySwap Reserve';
const RESERVE_MERCHANT_LEGAL = 'PaySwap Treasury Reserve';
const RESERVE_MERCHANT_EMAIL = 'reserve@payswap.internal';
const RESERVE_SYSTEM_USER_EMAIL = 'system-reserve@payswap.internal';

/**
 * Locate (or idempotently create) the system reserve wallet for a given
 * currency. The reserve wallet lives on a dedicated system Account of type
 * 'MERCHANT' attached to a deterministic system user — so every treasury
 * operator adjusts the same shared reserve regardless of who is calling.
 */
async function findOrCreateReserveWallet(currency: string) {
  // 1. Find the system reserve merchant (if it already exists).
  const existingMerchant = await db.merchant.findFirst({
    where: { name: RESERVE_MERCHANT_NAME, legalName: RESERVE_MERCHANT_LEGAL },
    include: { account: { include: { wallets: { where: { currency } } } } },
  });
  if (existingMerchant) {
    const account = existingMerchant.account;
    const wallet =
      account.wallets[0] ??
      (await db.wallet.create({
        data: {
          accountId: account.id,
          name: `PaySwap Reserve — ${currency}`,
          currency,
          balance: 0,
          isDefault: account.wallets.length === 0,
        },
      }));
    return { merchant: existingMerchant, account, wallet };
  }

  // 2. Otherwise find or create the deterministic system user.
  let systemUser = await db.user.findUnique({
    where: { email: RESERVE_SYSTEM_USER_EMAIL },
  });
  if (!systemUser) {
    systemUser = await db.user.create({
      data: {
        email: RESERVE_SYSTEM_USER_EMAIL,
        name: 'PaySwap Reserve System',
        status: 'ACTIVE',
        emailVerified: new Date(),
      },
    });
  }

  // 3. Create the Account + Merchant + Wallet.
  const account = await db.account.create({
    data: {
      userId: systemUser.id,
      type: 'MERCHANT',
      status: 'ACTIVE',
      merchant: {
        create: {
          name: RESERVE_MERCHANT_NAME,
          legalName: RESERVE_MERCHANT_LEGAL,
          email: RESERVE_MERCHANT_EMAIL,
          country: 'Global',
          currency,
          tier: 'PLATFORM',
          bond: 0,
          status: 'ACTIVE',
          kycLevel: 3,
        },
      },
    },
    include: { merchant: true },
  });

  const wallet = await db.wallet.create({
    data: {
      accountId: account.id,
      name: `PaySwap Reserve — ${currency}`,
      currency,
      balance: 0,
      isDefault: true,
    },
  });

  return { merchant: account.merchant!, account, wallet };
}

/**
 * POST /api/treasury/reserves/adjust
 *
 * Adjust the system reserve balance for a single currency. Body:
 *   { currency: string, amount: number, action: 'add' | 'remove', reason: string }
 *
 * Auth: TREASURY, ADMIN or SUPER_ADMIN. Every call:
 *   - Finds or creates the system reserve wallet (Account type='MERCHANT',
 *     name='PaySwap Reserve').
 *   - Records a WalletTransaction of type 'CREDIT' (add) or 'DEBIT' (remove).
 *   - Updates the wallet balance atomically inside a transaction.
 *   - Writes a TREASURY.RESERVE_ADJUST AuditLog entry.
 *
 * Returns the updated wallet balance + the WalletTransaction id.
 */
export async function POST(req: NextRequest) {
  // --- Auth ---------------------------------------------------------------
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

  // --- Parse body ---------------------------------------------------------
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const currency =
    typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  if (!currency || currency.length > 16) {
    return NextResponse.json(
      { error: 'currency must be a non-empty string (max 16 chars)' },
      { status: 400 },
    );
  }

  const action =
    typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
  if (action !== 'add' && action !== 'remove') {
    return NextResponse.json(
      { error: "action must be 'add' or 'remove'" },
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
  if (!reason) {
    return NextResponse.json(
      { error: 'reason is required for every reserve adjustment' },
      { status: 400 },
    );
  }

  // --- Resolve reserve wallet --------------------------------------------
  const { merchant, wallet } = await findOrCreateReserveWallet(currency);

  // For 'remove', ensure the wallet has enough balance.
  if (action === 'remove' && amount > wallet.balance) {
    return NextResponse.json(
      {
        error: `Insufficient reserve balance. Current: ${wallet.balance.toFixed(2)} ${currency}, requested: ${amount.toFixed(2)} ${currency}`,
      },
      { status: 409 },
    );
  }

  // --- Apply adjustment atomically ---------------------------------------
  const txType = action === 'add' ? 'CREDIT' : 'DEBIT';
  const delta = action === 'add' ? amount : -amount;

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: delta } },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: txType,
        amount,
        currency,
        counterparty: 'PaySwap Reserve',
        reference: `reserve-${action}-${Date.now()}`,
        txHash: null,
      },
    });

    return { updated, transaction };
  });

  // --- Audit log (best-effort, outside the wallet tx) --------------------
  try {
    await db.auditLog.create({
      data: {
        userId: userId ?? null,
        action: 'TREASURY.RESERVE_ADJUST',
        resourceType: 'Wallet',
        resourceId: wallet.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          currency,
          action,
          amount,
          reason,
          merchantId: merchant.id,
          walletId: wallet.id,
          before: wallet.balance,
          after: result.updated.balance,
          actorEmail: actorEmail ?? null,
        }),
      },
    });
  } catch {
    // best-effort — the wallet adjustment is already committed.
  }

  return NextResponse.json({
    wallet: {
      id: result.updated.id,
      currency: result.updated.currency,
      balance: result.updated.balance,
    },
    transaction: {
      id: result.transaction.id,
      type: result.transaction.type,
      amount: result.transaction.amount,
    },
  });
}
