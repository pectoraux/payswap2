/**
 * Refund Service — single source of truth for refund creation.
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';

export interface CreateRefundParams {
  merchantId: string;
  paymentId: string;
  amount: number;
  type: 'FULL' | 'PARTIAL';
  reason: string;
  environment: string;
  actorId?: string;
  timestamp?: Date;
  emitEvents?: boolean;
}

class RefundServiceClass {
  async create(params: CreateRefundParams) {
    const ts = params.timestamp || new Date();

    const refund = await db.refund.create({
      data: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        amount: params.amount,
        type: params.type,
        reason: params.reason,
        status: 'PROCESSED',
        requestedBy: params.actorId || 'system',
        processedAt: new Date(ts.getTime() + 3600000),
        createdAt: new Date(ts.getTime() + 3600000),
      },
    });

    if (params.emitEvents !== false) {
      await eventBus.emit(createEvent({
        type: 'refund.created',
        aggregateId: refund.id,
        aggregateType: 'Refund',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: { refundId: refund.id, paymentId: params.paymentId, amount: params.amount, type: params.type, reason: params.reason },
        actorId: params.actorId,
      }));

      await eventBus.emit(createEvent({
        type: 'refund.processed',
        aggregateId: refund.id,
        aggregateType: 'Refund',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: { refundId: refund.id, paymentId: params.paymentId, amount: params.amount, processedAt: ts.toISOString() },
        actorId: params.actorId,
      }));
    }

    return refund;
  }
}

export const refundService = new RefundServiceClass();
