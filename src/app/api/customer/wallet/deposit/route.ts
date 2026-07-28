import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURRENCIES = new Set(['GHS', 'KES', 'NGN', 'USD', 'EUR', 'ZAR']);
const SOURCES = new Set(['BANK_CARD', 'MOBILE_MONEY', 'BANK_TRANSFER']);

/**
 * POST /api/customer/wallet/deposit
 *
 * Body: { amount: number, currency: string, source: 'BANK_CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER', reference?: string }
 *
 * Increases the customer's wallet balance (creating a wallet for the
 * currency if none exists) and records a CREDIT WalletTransaction.
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
    return NextResponse.json({ ok: false, error: `Unsupported currency (allowed: ${[...CURRENCIES].join(', ')})` }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ ok: false, error: `Invalid source (allowed: ${[...SOURCES].join(', ')})` }, { status: 400 });
  }

  const note =
    typeof body?.reference === 'string' && body.reference.trim().length > 0
      ? body.reference.trim().slice(0, 200)
      : null;

  // Use a transaction so balance + ledger entry stay atomic.
  const result = await db.$transaction(async (tx) => {
    // Find or create a wallet for this currency on the customer account.
    let wallet = await tx.wallet.findFirst({
      where: { accountId: ctx.account.id, currency },
    });

    if (!wallet) {
      wallet = await tx.wallet.create({
        data: {
          accountId: ctx.account.id,
          name: `${currency} Wallet`,
          currency,
          balance: 0,
          isDefault: ctx.wallets.length === 0,
        },
      });
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: amount } },
    });

    const txn = await tx.walletTransaction.create({
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

    return { wallet: updated, txn };
  });

  // Best-effort audit log — non-blocking, do not fail the deposit if it errors.
  try {
    await db.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'CUSTOMER_WALLET_DEPOSIT',
        resourceType: 'Wallet',
        resourceId: result.wallet.id,
        result: 'SUCCESS',
        details: JSON.stringify({ amount, currency, source, environment: env, txnId: result.txn.id }),
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
