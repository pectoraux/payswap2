/**
 * Invoice Service — single source of truth for invoice creation.
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';
// P2-2 (C-5): BigInt Money for line-total / tax / grand-total arithmetic.
// The Math.round(x * 100)/100 pattern is replaced with Money.multiply +
// Money.add (exact integer minor units). Converted back to `number` for
// the Prisma write boundary (Invoice.subtotal/tax/total are Decimal
// columns coerced to `number` by the global $extends hook — see db.ts).
import { Money, asCurrency } from '@/money';

export interface CreateInvoiceParams {
  merchantId: string;
  customerEmail?: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  tax: number;
  currency: string;
  environment: string;
  actorId?: string;
  timestamp?: Date;
  emitEvents?: boolean;
}

class InvoiceServiceClass {
  async create(params: CreateInvoiceParams) {
    const ts = params.timestamp || new Date();
    // P2-2 (C-5): Money-based line/tax/total arithmetic. Each line total
    // = unitPrice * quantity (Money.multiply scales minor units by an
    // integer factor — exact). Subtotal = Σ line totals (Money.add).
    // Tax = subtotal * (tax% / 100). Grand total = subtotal + tax.
    const currency = asCurrency(params.currency);
    const lineMoneys = params.items.map(item =>
      Money.fromMajor(item.unitPrice, currency).multiply(item.quantity));
    const items = params.items.map((item, i) => ({
      ...item,
      total: lineMoneys[i].toNumber(),
    }));
    const subtotalMoney = lineMoneys.length > 0
      ? lineMoneys.reduce((acc, m) => acc.add(m))
      : Money.zero(currency);
    const subtotal = subtotalMoney.toNumber();
    const taxMoney = subtotalMoney.multiply(params.tax / 100);
    const tax = taxMoney.toNumber();
    const total = subtotalMoney.add(taxMoney).toNumber();
    const invCount = await db.invoice.count({ where: { merchantId: params.merchantId } });
    const number = `INV-${String(invCount + 1).padStart(5, '0')}`;

    const invoice = await db.invoice.create({
      data: {
        merchantId: params.merchantId,
        number,
        items: JSON.stringify(items),
        subtotal, tax, total,
        currency: params.currency,
        status: Math.random() < 0.5 ? 'PAID' : 'SENT',
        dueDate: new Date(ts.getTime() + 7 * 86400000),
        sentAt: ts,
        paidAt: Math.random() < 0.5 ? ts : null,
        createdAt: ts,
        updatedAt: ts,
      },
    });

    if (params.emitEvents !== false) {
      await eventBus.emit(createEvent({
        type: 'invoice.created',
        aggregateId: invoice.id,
        aggregateType: 'Invoice',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: { invoiceId: invoice.id, number, total, currency: params.currency, customerEmail: params.customerEmail },
        actorId: params.actorId,
      }));

      if (invoice.status === 'PAID') {
        await eventBus.emit(createEvent({
          type: 'invoice.paid',
          aggregateId: invoice.id,
          aggregateType: 'Invoice',
          merchantId: params.merchantId,
          environment: params.environment,
          payload: { invoiceId: invoice.id, number, total, paidAt: ts.toISOString() },
          actorId: params.actorId,
        }));
      }
    }

    return invoice;
  }
}

export const invoiceService = new InvoiceServiceClass();
