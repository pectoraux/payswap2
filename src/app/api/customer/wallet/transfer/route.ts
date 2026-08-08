import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';
import { runtime as runtimeKernel } from '@/runtime';
import type { Environment } from '@/runtime';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);

/**
 * POST /api/customer/wallet/transfer
 *
 * Body:
 *   { recipientType: 'CUSTOMER' | 'MERCHANT', recipientId: string,
 *     amount: number, currency: string, note?: string }
 *
 * - Validates sufficient funds on sender's wallet of that currency.
 * - Decrements sender wallet, increments recipient wallet (creating one
 *   if needed for the recipient account / currency).
 * - Records a DEBIT on sender and a CREDIT on recipient.
 * - For MERCHANT recipients the merchant's settlement wallet is used.
 *
 * Idempotency (H-2 fix — P1-4): Pass an `Idempotency-Key` header to
 * safely retry. A retry with the same key returns the cached response
 * with `cached: true` and does NOT move money twice.
 *
 * Returns `{ ok: true, senderTransaction, recipientTransaction, cached }`.
 */
export async function POST(req: NextRequest) {
  const ctx = await resolveCustomer();
  if (!ctx) return unauthorized();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const recipientType =
    typeof body?.recipientType === 'string' &&
    ['CUSTOMER', 'MERCHANT'].includes(body.recipientType)
      ? (body.recipientType as 'CUSTOMER' | 'MERCHANT')
      : null;
  const recipientId =
    typeof body?.recipientId === 'string' && body.recipientId.trim().length > 0
      ? body.recipientId.trim()
      : null;
  const amount = Number(body?.amount);
  const currency =
    typeof body?.currency === 'string' && CURRENCIES.has(body.currency)
      ? body.currency
      : null;
  const note =
    typeof body?.note === 'string' && body.note.trim().length > 0
      ? body.note.trim().slice(0, 280)
      : null;

  if (!recipientType || !recipientId) {
    return NextResponse.json({ ok: false, error: 'recipientType and recipientId are required' }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: 'Amount must be a positive number' }, { status: 400 });
  }
  if (!currency) {
    return NextResponse.json({ ok: false, error: `Unsupported currency (allowed: ${[...CURRENCIES].join(', ')})` }, { status: 400 });
  }

  // Resolve recipient account + label.
  let recipientAccountId: string | null = null;
  let recipientLabel: string | null = null;
  let senderLabel = ctx.customer.name || ctx.customer.email;

  if (recipientType === 'CUSTOMER') {
    // Self-transfer blocked.
    if (recipientId === ctx.customer.id) {
      return NextResponse.json({ ok: false, error: 'Cannot transfer to your own wallet' }, { status: 400 });
    }
    const recipient = await db.customer.findUnique({
      where: { id: recipientId },
      include: { account: true },
    });
    if (!recipient?.account) {
      return NextResponse.json({ ok: false, error: 'Recipient customer not found' }, { status: 404 });
    }
    recipientAccountId = recipient.account.id;
    recipientLabel = recipient.name || recipient.email;
  } else {
    // MERCHANT — find the merchant row, then its account.
    const merchant = await db.merchant.findUnique({
      where: { id: recipientId },
      include: { account: true },
    });
    if (!merchant?.account) {
      return NextResponse.json({ ok: false, error: 'Recipient merchant not found' }, { status: 404 });
    }
    recipientAccountId = merchant.account.id;
    recipientLabel = merchant.name;
  }

  // NC-1 FIX: Check balance BEFORE dispatching to avoid orphaned events.
  const senderWalletCheck = await db.wallet.findFirst({
    where: { accountId: ctx.account.id, currency },
  });
  if (!senderWalletCheck) {
    return NextResponse.json({ ok: false, error: 'NO_SENDER_WALLET' }, { status: 404 });
  }
  if (Number(senderWalletCheck.balance) < amount) {
    return NextResponse.json({ ok: false, error: 'INSUFFICIENT_FUNDS' }, { status: 400 });
  }

  // H-2 fix: Use the client-supplied Idempotency-Key for dedup.
  const idempotencyKey = getIdempotencyKey(req);
  const env = await getEnvironment();

  // ── P1-3 FIX: Collapse the dual-write pattern to a SINGLE writer ──────
  // Previously this route dispatched wallet.debit + wallet.credit through
  // the runtime kernel, THEN separately ran a Prisma $transaction to update
  // balances — two uncoordinated writes with no shared transaction and no
  // compensation logic. A failure between them left the event log and the
  // spendable balance permanently diverged.
  //
  // Now: the Prisma $transaction is the SINGLE authoritative writer. The
  // runtime dispatch happens AFTER the transaction commits, as a best-effort
  // log (for event-sourced projections + audit). If the dispatch fails, the
  // transfer still succeeded — the events are a projection, not a gate.
  // No compensating transaction is needed because debit+credit are atomic.
  const runTransfer = async (): Promise<{ status: number; body: any }> => {
    // ── SINGLE WRITER: atomic debit + credit in one transaction ────────
    const result = await db.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findFirst({
        where: { accountId: ctx.account.id, currency },
      });
      if (!senderWallet) throw new Error('NO_SENDER_WALLET');

      // Find or create recipient wallet for that currency.
      let recipientWallet = await tx.wallet.findFirst({
        where: { accountId: recipientAccountId!, currency },
      });
      if (!recipientWallet) {
        recipientWallet = await tx.wallet.create({
          data: {
            accountId: recipientAccountId!,
            name: `${currency} Wallet`,
            currency,
            balance: 0,
            isDefault: false,
          },
        });
      }

      // Atomic conditional decrement — only decrements if balance >= amount
      // at update time. No TOCTOU race possible.
      const debitResult = await tx.wallet.updateMany({
        where: { id: senderWallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });

      if (debitResult.count === 0) {
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Credit recipient (safe — increment always succeeds)
      const recipientUpdated = await tx.wallet.update({
        where: { id: recipientWallet.id },
        data: { balance: { increment: amount } },
      });

      const senderTxn = await tx.walletTransaction.create({
        data: {
          walletId: senderWallet.id,
          type: 'DEBIT',
          amount: -Math.abs(amount),
          currency,
          counterparty: recipientLabel,
          reference: note ?? `TRANSFER→${recipientLabel}`,
          txHash: `xf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      const recipientTxn = await tx.walletTransaction.create({
        data: {
          walletId: recipientWallet.id,
          type: 'CREDIT',
          amount,
          currency,
          counterparty: senderLabel,
          reference: note ?? `TRANSFER←${senderLabel}`,
          txHash: senderTxn.txHash,
        },
      });

      return { senderWallet: senderWallet, recipientWallet: recipientUpdated, senderTxn, recipientTxn };
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : 'UNKNOWN';
      return { error: msg };
    });

    if ('error' in result) {
      if (result.error === 'NO_SENDER_WALLET') {
        return {
          status: 404,
          body: { ok: false, error: `No ${currency} wallet found on your account` },
        };
      }
      if (result.error === 'INSUFFICIENT_FUNDS') {
        return { status: 422, body: { ok: false, error: 'Insufficient funds' } };
      }
      return { status: 500, body: { ok: false, error: 'Transfer failed' } };
    }

    // ── POST-COMMIT LOG: fire runtime events as a best-effort projection ──
    // The transaction above is the source of truth. These events feed the
    // event-sourced ledger + constitution audit trail. If they fail, the
    // transfer still succeeded — no compensation needed (the money moved
    // atomically). We log failures for ops visibility but do NOT block.
    try {
      await runtimeKernel.dispatcher.dispatch({
        type: 'wallet.debit',
        payload: {
          walletId: `${ctx.account.id}:${currency}`,
          accountId: ctx.account.id,
          currency,
          amount,
          description: note ?? `Transfer to ${recipientLabel}`,
          reference: result.senderTxn.txHash,
        },
        metadata: {
          actor: { id: ctx.userId, role: 'CUSTOMER' },
          environment: (env === 'live' ? 'live' : 'sandbox') as Environment,
          correlationId: idempotencyKey ?? result.senderTxn.txHash,
          source: 'api',
        },
      });
      await runtimeKernel.dispatcher.dispatch({
        type: 'wallet.credit',
        payload: {
          walletId: `${recipientAccountId}:${currency}`,
          accountId: recipientAccountId!,
          currency,
          amount,
          description: `Transfer from ${ctx.customer.name}`,
          reference: result.senderTxn.txHash,
        },
        metadata: {
          actor: { id: ctx.userId, role: 'CUSTOMER' },
          environment: (env === 'live' ? 'live' : 'sandbox') as Environment,
          correlationId: idempotencyKey ?? result.senderTxn.txHash,
          source: 'api',
        },
      });
    } catch (dispatchErr) {
      // Best-effort log — the transfer succeeded, the event projection failed.
      console.error('[wallet/transfer] Post-commit event dispatch failed (transfer succeeded):', dispatchErr);
    }

    try {
      await db.auditLog.create({
        data: {
          userId: ctx.userId,
          action: 'CUSTOMER_WALLET_TRANSFER',
          resourceType: 'Wallet',
          resourceId: result.senderWallet.id,
          result: 'SUCCESS',
          details: JSON.stringify({
            amount, currency, recipientType, recipientId,
            recipientLabel, environment: env,
            senderTxnId: result.senderTxn.id,
            recipientTxnId: result.recipientTxn.id,
          }),
        },
      });
    } catch {
      // ignore — audit log is best-effort
    }

    return {
      status: 200,
      body: {
        ok: true,
        recipient: { type: recipientType, id: recipientId, label: recipientLabel },
        senderTransaction: {
          id: result.senderTxn.id,
          type: result.senderTxn.type,
          amount: result.senderTxn.amount,
          currency: result.senderTxn.currency,
          counterparty: result.senderTxn.counterparty,
          reference: result.senderTxn.reference,
          createdAt: result.senderTxn.createdAt,
        },
        idempotencyKey,
      },
    };
  };

  try {
    if (idempotencyKey) {
      const result = await withIdempotency(
        idempotencyKey,
        '/api/customer/wallet/transfer',
        runTransfer,
      );
      return NextResponse.json(
        { ...result.body, cached: result.cached },
        { status: result.status },
      );
    }
    // No idempotency key — process as unique (backwards compat).
    const result = await runTransfer();
    return NextResponse.json(
      { ...result.body, cached: false },
      { status: result.status },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Transfer failed' },
      { status: 500 },
    );
  }
}
