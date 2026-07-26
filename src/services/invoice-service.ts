/**
 * Invoice Service — single source of truth for invoice creation.
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';

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
    const items = params.items.map(item => ({
      ...item,
      total: Math.round(item.quantity * item.unitPrice * 100) / 100,
    }));
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const tax = Math.round(subtotal * (params.tax / 100) * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
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
