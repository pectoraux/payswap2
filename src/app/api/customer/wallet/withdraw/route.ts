import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { runtime as runtimeKernel } from '@/runtime';
import type { Environment } from '@/runtime';
import { getIdempotencyKey } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const DESTINATIONS = new Set(['BANK_ACCOUNT', 'MOBILE_MONEY']);

/**
 * POST /api/customer/wallet/withdraw
 *
 * Dispatches a `wallet.debit` command through the runtime kernel.
 * Uses atomic conditional update to prevent TOCTOU race (H-8 fix):
 * the decrement only succeeds if balance >= amount at update time.
 *
 * Body: { amount, currency, destination, destinationLabel?, reference? }
 */
export async function POST(req: NextRequest) {
  const ctx = await resolveCustomer();
  if (!ctx) return unauthorized();

  const env = await getEnvironment();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const amount = Number(body?.amount);
  const currency =
    typeof body?.currency === 'string' && CURRENCIES.has(body.currency)
      ? body.currency
      : null;
  const destination =
    typeof body?.destination === 'string' && DESTINATIONS.has(body.destination)
      ? body.destination
      : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: 'Amount must be a positive number' }, { status: 400 });
  }
  if (!currency) {
    return NextResponse.json({ ok: false, error: 'Unsupported currency' }, { status: 400 });
  }
  if (!destination) {
    return NextResponse.json({ ok: false, error: 'Invalid destination' }, { status: 400 });
  }

  const destinationLabel =
    typeof body?.destinationLabel === 'string' && body.destinationLabel.trim()
      ? body.destinationLabel.trim().slice(0, 200)
      : null;
  const note =
    typeof body?.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 200)
      : null;

  const idempotencyKey = getIdempotencyKey(req);

  try {
    // Dispatch through the runtime kernel
    const dispatchResult = await runtimeKernel.dispatcher.dispatch({
      type: 'wallet.debit',
      payload: {
        walletId: `${ctx.account.id}:${currency}`,
        accountId: ctx.account.id,
        currency,
        amount,
        description: note ?? `Withdrawal to ${destination}`,
        reference: `wd_${Date.now().toString(36)}`,
      },
      metadata: {
        actor: { id: ctx.userId, role: 'CUSTOMER' },
        environment: (env === 'live' ? 'live' : 'sandbox') as Environment,
        correlationId: idempotencyKey,
        source: 'api',
      },
    });

    if (!dispatchResult.success) {
      return NextResponse.json(
        { ok: false, error: dispatchResult.error ?? dispatchResult.message },
        { status: 500 },
      );
    }

    // H-8 FIX: Atomic conditional update — prevents TOCTOU race.
    // The decrement only succeeds if balance >= amount at update time.
    // This is atomic at the SQL level — no race possible.
    const wallet = await db.wallet.findFirst({
      where: { accountId: ctx.account.id, currency },
    });

    if (!wallet) {
      return NextResponse.json({ ok: false, error: 'NO_WALLET' }, { status: 404 });
    }

    // Atomic conditional decrement: only decrements if balance >= amount
    const updated = await db.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });

    if (updated.count === 0) {
      // Balance was insufficient at update time (race condition prevented)
      return NextResponse.json(
        { ok: false, error: 'INSUFFICIENT_FUNDS' },
        { status: 400 },
      );
    }

    const freshWallet = await db.wallet.findUnique({ where: { id: wallet.id } });
    const counterparty = destinationLabel
      ? `${destination}:${destinationLabel}`
      : destination;

    const txn = await db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: -Math.abs(amount),
        currency,
        counterparty,
        reference: note ?? `WITHDRAW:${destination}`,
        txHash: `wd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      },
    });

    try {
      await db.auditLog.create({
        data: {
          userId: ctx.userId,
          action: 'CUSTOMER_WALLET_WITHDRAW',
          resourceType: 'Wallet',
          resourceId: wallet.id,
          result: 'SUCCESS',
          details: JSON.stringify({ amount, currency, destination, txnId: txn.id }),
        },
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      wallet: { id: freshWallet!.id, currency: freshWallet!.currency, balance: freshWallet!.balance },
      transaction: {
        id: txn.id, type: txn.type, amount: txn.amount,
        currency: txn.currency, counterparty: txn.counterparty,
        reference: txn.reference, createdAt: txn.createdAt,
      },
      idempotencyKey,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Withdrawal failed' },
      { status: 500 },
    );
  }
}
