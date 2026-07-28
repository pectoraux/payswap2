/**
 * Refund Service — single source of truth for refund creation.
 *
 * INTEGRATE-1 (runtime-integration-agent): Refunds now flow through the
 * runtime kernel via `runtime.dispatcher.dispatch({ type: 'refund.create' })`.
 * The dispatcher compiles the command into events (refund.requested +
 * refund.executed + ledger.entry.posted), verifies the constitution
 * invariants, and appends to the EventStore. The RefundPrismaSync subscriber
 * (registered in src/services/projections/index.ts) upserts the Prisma Refund
 * row as a derived projection.
 *
 * Application-level concerns (eventBus notification for webhooks/audit) happen
 * AFTER the dispatch succeeds — they are now a notification layer, not the
 * source of truth.
 */

import { eventBus, createEvent } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import { runtime } from '@/runtime';
import type { Environment } from '@/runtime';
import type { DispatchResult } from '@/runtime';

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

export interface RefundResult {
  id: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  type: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  processedAt: Date | null;
  createdAt: Date;
  dispatch?: DispatchResult;
}

class RefundServiceClass {
  async create(params: CreateRefundParams): Promise<RefundResult> {
    const ts = params.timestamp || new Date();

    // ── 1. Dispatch through the runtime kernel ────────────────────────────
    const dispatch = await runtime.dispatcher.dispatch({
      type: 'refund.create',
      payload: {
        merchantId: params.merchantId,
        paymentId: params.paymentId,
        amount: params.amount,
        type: params.type,
        reason: params.reason,
        requestedBy: params.actorId || 'system',
        environment: params.environment,
        actorId: params.actorId,
        timestamp: ts.getTime(),
      },
      metadata: {
        actor: { id: params.actorId ?? 'system:refund-service', role: 'merchant' },
        environment: (params.environment === 'live' ? 'live' : 'sandbox') as Environment,
        correlationId: `refund-create-${uuidv4()}`,
        source: 'api',
      },
    });

    if (!dispatch.success || !dispatch.entityId) {
      throw new Error(
        `Refund dispatch failed: ${dispatch.error ?? dispatch.message}`,
      );
    }

    const refundId = dispatch.entityId;
    const processedAt = new Date(ts.getTime() + 3600000);

    // ── 2. Emit application-level events (notification layer) ─────────────
    if (params.emitEvents !== false) {
      await eventBus.emit(createEvent({
        type: 'refund.created',
        aggregateId: refundId,
        aggregateType: 'Refund',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: {
          refundId,
          paymentId: params.paymentId,
          amount: params.amount,
          type: params.type,
          reason: params.reason,
        },
        actorId: params.actorId,
      }));

      await eventBus.emit(createEvent({
        type: 'refund.processed',
        aggregateId: refundId,
        aggregateType: 'Refund',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: {
          refundId,
          paymentId: params.paymentId,
          amount: params.amount,
          processedAt: ts.toISOString(),
        },
        actorId: params.actorId,
      }));
    }

    return {
      id: refundId,
      merchantId: params.merchantId,
      paymentId: params.paymentId,
      amount: params.amount,
      type: params.type,
      reason: params.reason,
      status: 'PROCESSED',
      requestedBy: params.actorId || 'system',
      processedAt,
      createdAt: ts,
      dispatch,
    };
  }
}

export const refundService = new RefundServiceClass();
