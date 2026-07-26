/**
 * Payout Service — single source of truth for payout creation.
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';
import { v4 as uuidv4 } from 'uuid';

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

class PayoutServiceClass {
  async create(params: CreatePayoutParams) {
    const ts = params.timestamp || new Date();
    const fee = Math.round(params.amount * 0.005 * 100) / 100;
    const net = Math.round((params.amount - fee) * 100) / 100;

    const payout = await db.payout.create({
      data: {
        merchantId: params.merchantId,
        method: params.method,
        sourceAmount: params.amount,
        sourceAsset: `TWIN${params.currency}`,
        sourceCurrency: params.currency,
        destinationCurrency: params.currency,
        destination: JSON.stringify({ bankAccount: `GH${Math.floor(Math.random() * 1e12)}`, accountName: 'Merchant' }),
        fxRate: 1, feeBps: 50, fee, netAmount: net,
        status: 'COMPLETED',
        txHash: `sim_tx_${uuidv4().slice(0, 8)}`,
        evidence: JSON.stringify({ source: 'open_banking', verificationLevel: 'institutional' }),
        createdAt: ts, processedAt: ts, completedAt: ts,
        environment: params.environment,
      },
    });

    if (params.emitEvents !== false) {
      await eventBus.emit(createEvent({
        type: 'payout.created',
        aggregateId: payout.id,
        aggregateType: 'Payout',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: { payoutId: payout.id, amount: params.amount, method: params.method, fee, net, txHash: payout.txHash },
        actorId: params.actorId,
      }));

      await eventBus.emit(createEvent({
        type: 'payout.completed',
        aggregateId: payout.id,
        aggregateType: 'Payout',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: { payoutId: payout.id, amount: params.amount, net, txHash: payout.txHash, completedAt: ts.toISOString() },
        actorId: params.actorId,
      }));
    }

    return payout;
  }
}

export const payoutService = new PayoutServiceClass();
