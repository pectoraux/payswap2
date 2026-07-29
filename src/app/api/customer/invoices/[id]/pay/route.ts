import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomer, unauthorized } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { getEnvironment } from '@/lib/environment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/customer/invoices/[id]/pay
 *
 * Pays an outstanding invoice from the customer's wallet:
 *   1. Validates the invoice belongs to the caller (customerId) and is
 *      in a payable state (SENT or OVERDUE).
 *   2. Validates sufficient wallet balance in the invoice's currency.
 *   3. Atomically:
 *        - decrement wallet balance
 *        - mark invoice PAID + paidAt + paymentId
 *        - create a Payment record (method=QR, status=COMPLETED)
 *        - create a DEBIT WalletTransaction linked to the wallet
 *   4. Best-effort audit log.
 *
 * Returns `{ ok: true, invoice, payment, transaction }`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveCustomer();
  if (!ctx) return unauthorized();

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Invoice id is required' }, { status: 400 });
  }

  const env = await getEnvironment();

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { merchant: true },
  });

  if (!invoice) {
    return NextResponse.json({ ok: false, error: 'Invoice not found' }, { status: 404 });
  }
  if (invoice.customerId !== ctx.customer.id) {
    return NextResponse.json({ ok: false, error: 'Invoice does not belong to you' }, { status: 403 });
  }
  if (invoice.status === 'PAID') {
    return NextResponse.json({ ok: false, error: 'Invoice already paid' }, { status: 422 });
  }
  if (invoice.status === 'VOID' || invoice.status === 'DRAFT') {
    return NextResponse.json({ ok: false, error: `Invoice cannot be paid in ${invoice.status} state` }, { status: 422 });
  }

  const amount = Number(invoice.total);
  const currency = invoice.currency;

  const result = await db.$transaction(async (tx) => {
    const wallet = await tx.wallet.findFirst({
      where: { accountId: ctx.account.id, currency },
    });
    if (!wallet) throw new Error('NO_WALLET');

    // H-8 FIX: Atomic conditional decrement — prevents TOCTOU race.
    // Only decrements if balance >= amount at update time.
    const debitResult = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debitResult.count === 0) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    const updatedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });

    const payment = await tx.payment.create({
      data: {
        merchantId: invoice.merchantId,
        customerId: ctx.customer.id,
        amount,
        currency,
        sourceCurrency: currency,
        destinationCurrency: currency,
        status: 'COMPLETED',
        method: 'QR',
        fee: 0,
        netAmount: amount,
        fxRate: 1,
        reference: `INV-${invoice.number}`,
        description: `Payment for invoice ${invoice.number}`,
        metadata: JSON.stringify({ invoiceId: invoice.id, paidVia: 'customer_wallet' }),
        environment: env,
        settledAt: new Date(),
      },
    });

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paymentId: payment.id,
      },
    });

    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: -Math.abs(amount),
        currency,
        counterparty: invoice.merchant?.name ?? invoice.merchantId,
        reference: `INVOICE:${invoice.number}`,
        txHash: `invpay_${payment.id.slice(0, 12)}`,
      },
    });

    return { wallet: updatedWallet, payment, invoice: updatedInvoice, txn };
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'UNKNOWN';
    return { error: msg };
  });

  if ('error' in result) {
    if (result.error === 'NO_WALLET') {
      return NextResponse.json({ ok: false, error: `No ${currency} wallet found` }, { status: 404 });
    }
    if (result.error === 'INSUFFICIENT_FUNDS') {
      return NextResponse.json({ ok: false, error: 'Insufficient wallet funds for this invoice' }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: 'Invoice payment failed' }, { status: 500 });
  }

  try {
    await db.auditLog.create({
      data: {
        userId: ctx.userId,
        action: 'CUSTOMER_INVOICE_PAID',
        resourceType: 'Invoice',
        resourceId: invoice.id,
        result: 'SUCCESS',
        details: JSON.stringify({
          amount, currency, merchantId: invoice.merchantId,
          paymentId: result.payment.id, txnId: result.txn.id, environment: env,
        }),
      },
    });
  } catch {
    // ignore — audit log is best-effort
  }

  return NextResponse.json({
    ok: true,
    invoice: {
      id: result.invoice.id,
      number: result.invoice.number,
      status: result.invoice.status,
      paidAt: result.invoice.paidAt,
    },
    payment: {
      id: result.payment.id,
      status: result.payment.status,
      amount: result.payment.amount,
      currency: result.payment.currency,
      reference: result.payment.reference,
    },
    transaction: {
      id: result.txn.id,
      type: result.txn.type,
      amount: result.txn.amount,
      currency: result.txn.currency,
      counterparty: result.txn.counterparty,
      createdAt: result.txn.createdAt,
    },
    walletBalance: result.wallet?.balance ?? 0,
  });
}
