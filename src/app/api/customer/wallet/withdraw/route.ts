import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const DESTINATIONS = new Set(['BANK_ACCOUNT', 'MOBILE_MONEY']);

/**
 * POST /api/customer/wallet/withdraw
 *
 * Body: { amount: number, currency: string, destination: 'BANK_ACCOUNT' | 'MOBILE_MONEY', destinationLabel?: string, reference?: string }
 *
 * Decreases the customer's wallet balance (validates sufficient funds),
 * records a DEBIT WalletTransaction.
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
    return NextResponse.json({ ok: false, error: `Unsupported currency (allowed: ${[...CURRENCIES].join(', ')})` }, { status: 400 });
  }
  if (!destination) {
    return NextResponse.json({ ok: false, error: `Invalid destination (allowed: ${[...DESTINATIONS].join(', ')})` }, { status: 400 });
  }

  const destinationLabel =
    typeof body?.destinationLabel === 'string' && body.destinationLabel.trim().length > 0
      ? body.destinationLabel.trim().slice(0, 200)
      : null;
  const note =
    typeof body?.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 200)
      : null;

  const result = await db.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: { accountId: ctx.account.id, currency },
    });

    if (!wallet) {
      throw new Error('NO_WALLET');
    }
    // Re-read inside the txn so we see the latest balance.
    const fresh = await tx.wallet.findUnique({ where: { id: wallet.id } });
    if (!fresh) throw new Error('NO_WALLET');
    if (fresh.balance < amount) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amount } },
    });

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

    return { wallet: updated, txn };
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'UNKNOWN';
    return { error: msg };
  });

  if ('error' in result) {
    if (result.error === 'NO_WALLET') {
      return NextResponse.json({ ok: false, error: `No ${currency} wallet found` }, { status: 404 });
    }
    if (result.error === 'INSUFFICIENT_FUNDS') {
      return NextResponse.json({ ok: false, error: 'Insufficient funds' }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: 'Withdrawal failed' }, { status: 500 });
  }

  try {
    await db.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'CUSTOMER_WALLET_WITHDRAW',
        resourceType: 'Wallet',
        resourceId: result.wallet.id,
        result: 'SUCCESS',
        details: JSON.stringify({ amount, currency, destination, environment: env, txnId: result.txn.id }),
      },
    });
  } catch {
    // ignore — audit log is best-effort
  }

  return NextResponse.json({
    ok: true,
    wallet: { id: result.wallet.id, currency: result.wallet.currency, balance: result.wallet.balance },
    transaction: {
      id: result.txn.id,
      type: result.txn.type,
      amount: result.txn.amount,
      currency: result.txn.currency,
      counterparty: result.txn.counterparty,
      reference: result.txn.reference,
      createdAt: result.txn.createdAt,
    },
  });
}
