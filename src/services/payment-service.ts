/**
 * Payment Service — the single source of truth for payment creation.
 *
 * Every payment creation (API route, world simulator, admin simulate)
 * MUST go through this service. This ensures:
 *   1. Business rules are enforced once
 *   2. Domain events are always emitted
 *   3. Webhooks, audit logs, and activity feed are always updated
 *   4. The protocol trace is always recorded
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';
import { v4 as uuidv4 } from 'uuid';

export interface CreatePaymentParams {
  merchantId: string;
  amount: number;
  currency: string;
  method: string;
  description: string;
  customerName?: string;
  customerEmail?: string;
  lpId?: string;
  lpFeeBps?: number;
  environment: string;
  actorId?: string;
  timestamp?: Date;
  // If true, payment succeeds; if false, it's created as FAILED
  success?: boolean;
  // Whether to emit events (default true). Set false for bulk operations.
  emitEvents?: boolean;
}

export interface PaymentResult {
  id: string;
  reference: string;
  status: string;
  amount: number;
  fee: number;
  netAmount: number;
}

class PaymentServiceClass {
  async create(params: CreatePaymentParams): Promise<PaymentResult> {
    const ts = params.timestamp || new Date();
    const success = params.success ?? Math.random() < 0.95;
    const lpFeeBps = params.lpFeeBps ?? 80;
    const fee = Math.round(params.amount * (lpFeeBps / 10000) * 100) / 100;
    const netAmount = success ? Math.round((params.amount - fee) * 100) / 100 : 0;
    const reference = params.description?.startsWith('SIM-')
      ? `SIM-${uuidv4().slice(0, 8)}`
      : `PAY-${uuidv4().slice(0, 8)}`;

    // 1. Find or create customer record
    let customerId: string | null = null;
    if (params.customerEmail && params.customerName) {
      let customer = await db.customerRecord.findFirst({
        where: {
          merchantId: params.merchantId,
          email: params.customerEmail,
          environment: params.environment,
        },
      });
      if (!customer) {
        customer = await db.customerRecord.create({
          data: {
            merchantId: params.merchantId,
            name: params.customerName,
            email: params.customerEmail,
            phone: `+23324${Math.floor(1000000 + Math.random() * 8999999)}`,
            country: 'Ghana',
            environment: params.environment,
          },
        });
      }
      customerId = customer.id;
    }

    // 2. Create payment
    const payment = await db.payment.create({
      data: {
        merchantId: params.merchantId,
        customerId: null, // Payment.customerId references Customer table, not CustomerRecord
        amount: params.amount,
        currency: params.currency,
        sourceCurrency: params.currency,
        destinationCurrency: params.currency,
        status: success ? 'COMPLETED' : 'FAILED',
        method: params.method,
        corridor: `${params.currency}-${params.currency}`,
        lpId: params.lpId || 'lp_simulated',
        fee,
        netAmount,
        fxRate: 1,
        reference,
        description: params.description,
        settledAt: success ? ts : null,
        environment: params.environment,
        createdAt: ts,
        updatedAt: ts,
      },
    });

    // 3. Emit domain events
    if (params.emitEvents !== false) {
      const basePayload = {
        paymentId: payment.id,
        reference,
        amount: params.amount,
        currency: params.currency,
        method: params.method,
        merchantId: params.merchantId,
        customerName: params.customerName,
        customerEmail: params.customerEmail,
        lpId: params.lpId,
        fee,
        netAmount,
      };

      await eventBus.emit(createEvent({
        type: 'payment.created',
        aggregateId: payment.id,
        aggregateType: 'Payment',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: basePayload,
        actorId: params.actorId,
      }));

      if (success) {
        await eventBus.emit(createEvent({
          type: 'payment.completed',
          aggregateId: payment.id,
          aggregateType: 'Payment',
          merchantId: params.merchantId,
          environment: params.environment,
          payload: { ...basePayload, settledAt: ts.toISOString() },
          actorId: params.actorId,
        }));
      } else {
        await eventBus.emit(createEvent({
          type: 'payment.failed',
          aggregateId: payment.id,
          aggregateType: 'Payment',
          merchantId: params.merchantId,
          environment: params.environment,
          payload: { ...basePayload, reason: 'Simulated failure' },
          actorId: params.actorId,
        }));
      }
    }

    return {
      id: payment.id,
      reference,
      status: payment.status,
      amount: params.amount,
      fee,
      netAmount,
    };
  }
}

export const paymentService = new PaymentServiceClass();
