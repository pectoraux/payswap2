import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

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
 * Returns `{ ok: true, senderTransaction, recipientTransaction }`.
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

  // Run the ledger atomically.
  const result = await db.$transaction(async (tx) => {
    const senderWallet = await tx.wallet.findFirst({
      where: { accountId: ctx.account.id, currency },
    });
    if (!senderWallet) throw new Error('NO_SENDER_WALLET');

    const senderFresh = await tx.wallet.findUnique({ where: { id: senderWallet.id } });
    if (!senderFresh) throw new Error('NO_SENDER_WALLET');
    if (senderFresh.balance < amount) throw new Error('INSUFFICIENT_FUNDS');

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

    const senderUpdated = await tx.wallet.update({
      where: { id: senderWallet.id },
      data: { balance: { decrement: amount } },
    });
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

    return { senderWallet: senderUpdated, recipientWallet: recipientUpdated, senderTxn, recipientTxn };
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'UNKNOWN';
    return { error: msg };
  });

  if ('error' in result) {
    if (result.error === 'NO_SENDER_WALLET') {
      return NextResponse.json({ ok: false, error: `No ${currency} wallet found on your account` }, { status: 404 });
    }
    if (result.error === 'INSUFFICIENT_FUNDS') {
      return NextResponse.json({ ok: false, error: 'Insufficient funds' }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: 'Transfer failed' }, { status: 500 });
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

  return NextResponse.json({
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
  });
}
