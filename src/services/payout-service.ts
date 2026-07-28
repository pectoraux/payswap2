/**
 * Payout Service — single source of truth for payout creation.
 *
 * INTEGRATE-1 (runtime-integration-agent): Payouts now flow through the
 * runtime kernel via `runtime.dispatcher.dispatch({ type: 'payout.create' })`.
 * The dispatcher compiles the command into events (payout.recorded +
 * payout.completed + ledger.entry.posted), verifies the constitution
 * invariants, and appends to the EventStore. The PayoutPrismaSync subscriber
 * (registered in src/services/projections/index.ts) upserts the Prisma Payout
 * row as a derived projection.
 */

import { eventBus, createEvent } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import { runtime } from '@/runtime';
import type { Environment } from '@/runtime';
import type { DispatchResult } from '@/runtime';

export interface CreatePayoutParams {
  merchantId: string;
  method: string; // BANK, MOBILE_MONEY, ONCHAIN
  amount: number;
  currency: string;
  environment: string;
  actorId?: string;
  timestamp?: Date;
  emitEvents?: boolean;
}

export interface PayoutResult {
  id: string;
  merchantId: string;
  method: string;
  sourceAmount: number;
  sourceAsset: string;
  sourceCurrency: string;
  destinationCurrency: string;
  destination: string | null;
  fxRate: number;
  feeBps: number;
  fee: number;
  netAmount: number;
  status: string;
  txHash: string | null;
  evidence: string | null;
  createdAt: Date;
  processedAt: Date | null;
  completedAt: Date | null;
  dispatch?: DispatchResult;
}

class PayoutServiceClass {
  async create(params: CreatePayoutParams): Promise<PayoutResult> {
    const ts = params.timestamp || new Date();
    const fee = Math.round(params.amount * 0.005 * 100) / 100;
    const net = Math.round((params.amount - fee) * 100) / 100;
    const destination = JSON.stringify({
      bankAccount: `GH${Math.floor(Math.random() * 1e12)}`,
      accountName: 'Merchant',
    });
    const txHash = `sim_tx_${uuidv4().slice(0, 8)}`;
    const evidence = JSON.stringify({
      source: 'open_banking',
      verificationLevel: 'institutional',
    });

    // ── 1. Dispatch through the runtime kernel ────────────────────────────
    const dispatch = await runtime.dispatcher.dispatch({
      type: 'payout.create',
      payload: {
        merchantId: params.merchantId,
        method: params.method,
        sourceAmount: params.amount,
        sourceAsset: `TWIN${params.currency}`,
        sourceCurrency: params.currency,
        destinationCurrency: params.currency,
        destination,
        fxRate: 1,
        feeBps: 50,
        fee,
        netAmount: net,
        txHash,
        evidence,
        environment: params.environment,
        actorId: params.actorId,
        timestamp: ts.getTime(),
        success: true,
      },
      metadata: {
        actor: { id: params.actorId ?? 'system:payout-service', role: 'merchant' },
        environment: (params.environment === 'live' ? 'live' : 'sandbox') as Environment,
        correlationId: `payout-create-${uuidv4()}`,
        source: 'api',
      },
    });

    if (!dispatch.success || !dispatch.entityId) {
      throw new Error(
        `Payout dispatch failed: ${dispatch.error ?? dispatch.message}`,
      );
    }

    const payoutId = dispatch.entityId;

    // ── 2. Emit application-level events (notification layer) ─────────────
    if (params.emitEvents !== false) {
      await eventBus.emit(createEvent({
        type: 'payout.created',
        aggregateId: payoutId,
        aggregateType: 'Payout',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: {
          payoutId,
          amount: params.amount,
          method: params.method,
          fee,
          net,
          txHash,
        },
        actorId: params.actorId,
      }));

      await eventBus.emit(createEvent({
        type: 'payout.completed',
        aggregateId: payoutId,
        aggregateType: 'Payout',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: {
          payoutId,
          amount: params.amount,
          net,
          txHash,
          completedAt: ts.toISOString(),
        },
        actorId: params.actorId,
      }));
    }

    return {
      id: payoutId,
      merchantId: params.merchantId,
      method: params.method,
      sourceAmount: params.amount,
      sourceAsset: `TWIN${params.currency}`,
      sourceCurrency: params.currency,
      destinationCurrency: params.currency,
      destination,
      fxRate: 1,
      feeBps: 50,
      fee,
      netAmount: net,
      status: 'COMPLETED',
      txHash,
      evidence,
      createdAt: ts,
      processedAt: ts,
      completedAt: ts,
      dispatch,
    };
  }
}

export const payoutService = new PayoutServiceClass();
