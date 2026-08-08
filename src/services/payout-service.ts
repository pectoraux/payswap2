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

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import { runtime } from '@/runtime';
import { executionPlanner } from '@/runtime/planner';
import type { Environment } from '@/runtime';
import type { DispatchResult } from '@/runtime';
// P2-2 (C-5): BigInt Money for fee/net arithmetic — see payment-service.ts.
import { Money, asCurrency } from '@/money';

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
    // P2-2 (C-5): BigInt Money replaces Math.round(amount * 0.005 * 100)/100.
    // The 0.5% flat fee is 50 bps; mulBps does the integer division on
    // BigInt minor units (exact). Result is converted back to `number` at
    // the return boundary for backwards compatibility with the API
    // contract (PayoutResult.fee / netAmount are typed `number`).
    const currency = asCurrency(params.currency);
    const gross = Money.fromMajor(params.amount, currency);
    const feeMoney = Money.mulBps(gross, 50); // 0.5% = 50 bps
    const netMoney = gross.subtract(feeMoney);
    const fee = feeMoney.toNumber();
    const net = netMoney.toNumber();
    const destination = JSON.stringify({
      bankAccount: `GH${Math.floor(Math.random() * 1e12)}`,
      accountName: 'Merchant',
    });
    const txHash = `sim_tx_${uuidv4().slice(0, 8)}`;
    const evidence = JSON.stringify({
      source: 'open_banking',
      verificationLevel: 'institutional',
    });

    // C-3 fix (regrade 2026-08-08): crossBorder was hardcoded `false`
    // here, so a payout could never reach the SAFE/STRATEGIC execution
    // profile's policy/council/settlement review on that basis regardless
    // of the actual transaction. This payout flow doesn't carry an
    // explicit destination country, but it does settle in a specific
    // `params.currency` against the merchant's registered settlement
    // currency (`Merchant.currency`) — a payout in a currency other than
    // the merchant's home currency is a real cross-currency/cross-border
    // signal, not a proxy that can't fire.
    const merchantRow = await db.merchant.findUnique({
      where: { id: params.merchantId },
      select: { currency: true },
    });
    const crossBorder = !!(merchantRow?.currency && merchantRow.currency !== params.currency);

    // ── 1. Execute through the Execution Planner ───────────────────────────
    const plannerResult = await executionPlanner.execute({
      command: {
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
      },
      transactionType: 'payout',
      amount: params.amount,
      currency: params.currency,
      crossBorder,
      metadata: {
        actor: { id: params.actorId ?? 'system:payout-service', role: 'merchant' },
        environment: (params.environment === 'live' ? 'live' : 'sandbox') as Environment,
        correlationId: `payout-create-${uuidv4()}`,
        source: 'api',
      },
    });
    const dispatch = plannerResult.dispatchResult;

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
