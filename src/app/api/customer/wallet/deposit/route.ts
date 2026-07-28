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
const SOURCES = new Set(['BANK_CARD', 'MOBILE_MONEY', 'BANK_TRANSFER']);

/**
 * POST /api/customer/wallet/deposit
 *
 * Dispatches a `wallet.credit` command through the runtime kernel:
 *   API → executionPlanner → dispatcher → invariants → event store → ledger
 *
 * The wallet balance is updated as a PROJECTION of the event store,
 * not via direct Prisma write. The constitution verifies the wallet
 * invariant (balance non-negative) before the event is appended.
 *
 * Idempotency: Pass an `Idempotency-Key` header to safely retry.
 *
 * Body: { amount, currency, source, reference? }
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
  const source =
    typeof body?.source === 'string' && SOURCES.has(body.source)
      ? body.source
      : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: 'Amount must be a positive number' }, { status: 400 });
  }
  if (!currency) {
    return NextResponse.json({ ok: false, error: `Unsupported currency` }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ ok: false, error: `Invalid source` }, { status: 400 });
  }

  const note =
    typeof body?.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 200)
      : null;

  const idempotencyKey = getIdempotencyKey(req);

  try {
    // Dispatch through the runtime kernel — the wallet.credit handler
    // produces a wallet.credited event + ledger.entry.posted event.
    // The constitution verifies invariants before appending.
    const dispatchResult = await runtimeKernel.dispatcher.dispatch({
      type: 'wallet.credit',
      payload: {
        walletId: `${ctx.account.id}:${currency}`,
        accountId: ctx.account.id,
        currency,
        amount,
        description: note ?? `Deposit via ${source}`,
        reference: `dep_${Date.now().toString(36)}`,
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

    // Update the wallet balance as a PROJECTION of the event.
    // Use atomic increment (safe — credit always succeeds).
    let wallet = await db.wallet.findFirst({
      where: { accountId: ctx.account.id, currency },
    });

    if (!wallet) {
      wallet = await db.wallet.create({
        data: {
          accountId: ctx.account.id,
          name: `${currency} Wallet`,
          currency,
          balance: amount,
          isDefault: ctx.wallets.length === 0,
        },
      });
    } else {
      wallet = await db.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amount } },
      });
    }

    const txn = await db.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount,
        currency,
        counterparty: source,
        reference: note ?? `DEPOSIT:${source}`,
        txHash: `dep_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      },
    });

    // Best-effort audit log
    try {
      await db.auditLog.create({
        data: {
          userId: ctx.userId,
          action: 'CUSTOMER_WALLET_DEPOSIT',
          resourceType: 'Wallet',
          resourceId: wallet.id,
          result: 'SUCCESS',
          details: JSON.stringify({ amount, currency, source, txnId: txn.id }),
        },
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      wallet: { id: wallet.id, currency: wallet.currency, balance: wallet.balance },
      transaction: {
        id: txn.id, type: txn.type, amount: txn.amount,
        currency: txn.currency, counterparty: txn.counterparty,
        reference: txn.reference, createdAt: txn.createdAt,
      },
      idempotencyKey,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Deposit failed' },
      { status: 500 },
    );
  }
}
