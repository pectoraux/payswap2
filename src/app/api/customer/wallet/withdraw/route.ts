import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { runtime as runtimeKernel } from '@/runtime';
import type { Environment } from '@/runtime';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { guardLiveMoney, constitutionBlockBody } from '@/lib/constitution-guard';
import { ledgerEngine } from '@/protocol/ledger';
import { debit, credit } from '@/protocol/ledger/entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const DESTINATIONS = new Set(['BANK_ACCOUNT', 'MOBILE_MONEY']);

/**
 * POST /api/customer/wallet/withdraw
 *
 * P1-3 FIX (C-2, regrade 2026-08-08): this route previously dispatched
 * `wallet.debit` through the runtime kernel first, then separately ran a
 * Prisma `updateMany` on the real balance — two uncoupled writers. The
 * doc comment used to claim "the projection subscriber updates Prisma
 * from events" as the safety net for a mismatch; no such subscriber
 * exists (`src/runtime/engines/wallets/projection.ts` is a pure in-memory
 * read model with zero `db.wallet` writes), so a race between the two
 * writes had no real reconciliation.
 *
 * Collapsed to the same single-writer pattern already used on transfer:
 * the Prisma `$transaction` is the SOLE authoritative writer, with the
 * balance-sufficiency check done as an atomic conditional `updateMany`
 * (`balance >= amount`) INSIDE that transaction — no TOCTOU race. The
 * runtime dispatch happens AFTER commit, as a best-effort log for the
 * event-sourced ledger + audit trail.
 *
 * Idempotency (H-2 fix — P1-4): Pass an `Idempotency-Key` header to
 * safely retry. A retry with the same key returns the cached response
 * with `cached: true` and does NOT debit the wallet twice.
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

  // H-2 fix: Use the client-supplied Idempotency-Key for dedup.
  // If no header was sent, `key` is null — process as unique (backwards
  // compat) and skip the wrapper.
  const idempotencyKey = getIdempotencyKey(req);

  // NC-1 FIX: Check balance BEFORE dispatching.
  // If the wallet doesn't have enough funds, we return an error WITHOUT
  // producing any events in the event store.
  const wallet = await db.wallet.findFirst({
    where: { accountId: ctx.account.id, currency },
  });

  if (!wallet) {
    return NextResponse.json({ ok: false, error: 'NO_WALLET' }, { status: 404 });
  }

  if (Number(wallet.balance) < amount) {
    return NextResponse.json(
      { ok: false, error: 'INSUFFICIENT_FUNDS' },
      { status: 400 },
    );
  }

  // P2-4 (C-7 fix): Run the CRITICAL subset of the Constitution BEFORE
  // the withdrawal executes. Sanctions + KYC apply on money-OUT too.
  // Runs only 8 of 45 rules (< 1ms).
  const verdict = guardLiveMoney({
    actor: { id: ctx.userId, role: 'CUSTOMER' },
    amount,
    currency,
    transactionType: 'wallet_withdraw',
  });
  if (!verdict.passed) {
    return NextResponse.json(constitutionBlockBody(verdict), { status: 403 });
  }

  // The side-effect (dispatch + wallet update + transaction + audit log)
  // is wrapped in withIdempotency so a retry with the same key returns the
  // cached response without debiting the wallet twice.
  const runWithdraw = async (): Promise<{ status: number; body: any }> => {
    // ── SINGLE WRITER: atomic conditional debit in one transaction ────────
    // H-8: atomic conditional updateMany (balance >= amount) at the SQL
    // level — no TOCTOU race between the pre-check above and this write.
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });

      if (updated.count === 0) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      const freshWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
      const counterparty = destinationLabel
        ? `${destination}:${destinationLabel}`
        : destination;

      const txn = await tx.walletTransaction.create({
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

      return { freshWallet: freshWallet!, txn };
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      return { error: msg };
    });

    if ('error' in result) {
      if (result.error === 'INSUFFICIENT_FUNDS') {
        return { status: 422, body: { ok: false, error: 'Insufficient funds' } };
      }
      return { status: 500, body: { ok: false, error: 'Withdrawal failed' } };
    }

    const { freshWallet, txn } = result;

    // ── POST-COMMIT LOG: fire the runtime event as a best-effort projection ──
    // The transaction above is the source of truth. This event feeds the
    // event-sourced audit trail. If it fails, the withdrawal still
    // succeeded — no compensation needed (the money already moved
    // atomically inside the transaction above).
    try {
      const dispatchResult = await runtimeKernel.dispatcher.dispatch({
        type: 'wallet.debit',
        payload: {
          walletId: `${ctx.account.id}:${currency}`,
          accountId: ctx.account.id,
          currency,
          amount,
          description: note ?? `Withdrawal to ${destination}`,
          reference: txn.txHash,
        },
        metadata: {
          actor: { id: ctx.userId, role: 'CUSTOMER' },
          environment: (env === 'live' ? 'live' : 'sandbox') as Environment,
          correlationId: idempotencyKey ?? txn.txHash,
          source: 'api',
        },
      });
      if (!dispatchResult.success) {
        console.error('[wallet/withdraw] Post-commit event dispatch failed (withdrawal succeeded):', dispatchResult.error ?? dispatchResult.message);
      }
    } catch (dispatchErr) {
      console.error('[wallet/withdraw] Post-commit event dispatch threw (withdrawal succeeded):', dispatchErr);
    }

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

    // ── P2-1 (C-4 fix): post a balanced journal entry to the protocol ledger.
    // DR user:wallet:<id>     (liability decreases — we no longer owe the user)
    // CR cash:bank:<currency> (asset decreases — money left the protocol)
    // Mirror of the deposit entry. Balance sheet shrinks symmetrically:
    // A↓ == L↓.
    // Best-effort — if the ledger write fails, the withdrawal still succeeded.
    try {
      await ledgerEngine.postAndPersist({
        txId: txn.txHash,
        description: `Withdraw ${amount} ${currency} to ${destination}`,
        legs: [
          debit(`user:wallet:${wallet.id}`, amount, currency, `Withdrawal to ${destination}`),
          credit(`cash:bank:${currency}`, amount, currency, `Withdrawal to ${destination}`),
        ],
      });
    } catch (ledgerErr) {
      console.error('[wallet/withdraw] Ledger post failed (withdrawal succeeded):', ledgerErr);
    }

    return {
      status: 200,
      body: {
        ok: true,
        wallet: { id: freshWallet!.id, currency: freshWallet!.currency, balance: freshWallet!.balance },
        transaction: {
          id: txn.id, type: txn.type, amount: txn.amount,
          currency: txn.currency, counterparty: txn.counterparty,
          reference: txn.reference, createdAt: txn.createdAt,
        },
        idempotencyKey,
      },
    };
  };

  try {
    if (idempotencyKey) {
      const result = await withIdempotency(
        idempotencyKey,
        '/api/customer/wallet/withdraw',
        runWithdraw,
      );
      return NextResponse.json(
        { ...result.body, cached: result.cached },
        { status: result.status },
      );
    }
    // No idempotency key — process as unique (backwards compat).
    const result = await runWithdraw();
    return NextResponse.json(
      { ...result.body, cached: false },
      { status: result.status },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Withdrawal failed' },
      { status: 500 },
    );
  }
}
