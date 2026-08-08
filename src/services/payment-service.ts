/**
 * Payment Service — the single source of truth for payment creation.
 *
 * INTEGRATE-1 (runtime-integration-agent): Every payment now flows through the
 * runtime kernel via `runtime.dispatcher.dispatch({ type: 'payment.create' })`.
 * The dispatcher compiles the command into events (payment.recorded +
 * payment.completed + ledger.entry.posted), verifies the constitution
 * invariants, appends them to the EventStore, and the PaymentProjection
 * upserts the Prisma `Payment` row as a derived projection.
 *
 * Application-level concerns (customer record upsert, webhook delivery, audit
 * log) happen AFTER the dispatch succeeds. The `eventBus` events emitted here
 * are now a NOTIFICATION layer (not the source of truth) — they tell the
 * webhook/analytics projections that a payment happened, but the financial
 * state lives in the runtime EventStore.
 *
 *   paymentService.create()
 *     ├── 1. Upsert CustomerRecord (Prisma — application concern)
 *     ├── 2. runtime.dispatcher.dispatch({ type: 'payment.create', ... })
 *     │       ├── PaymentCommandHandler produces events
 *     │       ├── InvariantEngine verifies constitution
 *     │       ├── EventStore.append (atomic)
 *     │       └── PaymentProjection upserts Prisma Payment
 *     └── 3. eventBus.emit (notification layer for webhooks/audit)
 */

import { db } from '@/lib/db';
import { eventBus, createEvent } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import { executionPlanner } from '@/runtime/planner';
import { runtime } from '@/runtime';
import type { Environment } from '@/runtime';
import type { DispatchResult } from '@/runtime';
// P2-2 (C-5): BigInt Money for fee/net arithmetic. The Math.round(x*100)
// pattern accumulates IEEE-754 drift across thousands of payments; Money
// uses integer minor units (BigInt) so fee + net == gross exactly.
import { Money, asCurrency } from '@/money';

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
  // INTEGRATE-1: expose the dispatch result so callers can inspect the
  // appended events (for tracing, the inspector, and tests).
  dispatch?: DispatchResult;
}

class PaymentServiceClass {
  async create(params: CreatePaymentParams): Promise<PaymentResult> {
    const ts = params.timestamp ?? new Date();
    const success = params.success ?? Math.random() < 0.95;
    const lpFeeBps = params.lpFeeBps ?? 80;
    // P2-2 (C-5): BigInt Money arithmetic replaces the float Math.round
    // pattern. fee = gross * bps / 10_000 (integer division on BigInt
    // minor units); net = gross - fee (exact). The Money objects are the
    // source of truth inside this function; we convert to `number` at the
    // return boundary (PaymentResult.fee / netAmount) for backwards
    // compatibility with the API contract, and to `Decimal` via
    // `money.toDecimal()` at the Prisma write boundary (handled by the
    // PaymentProjection). For currencies not on Money's allow-list
    // (UGX/TZS/RWF/...) we fall back to 'USD' semantics — same 2-decimal
    // behavior as the legacy Math.round(x*100)/100 code.
    const currency = asCurrency(params.currency);
    const gross = Money.fromMajor(params.amount, currency);
    const feeMoney = Money.mulBps(gross, lpFeeBps);
    const netMoney = success ? gross.subtract(feeMoney) : Money.zero(currency);
    const fee = feeMoney.toNumber();
    const netAmount = netMoney.toNumber();
    const reference = params.description?.startsWith('SIM-')
      ? `SIM-${uuidv4().slice(0, 8)}`
      : `PAY-${uuidv4().slice(0, 8)}`;

    // ── 1. Find or create customer record (application concern) ──────────
    let customerId: string | null = null;
    let customerCountry: string | null = null;
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
      customerCountry = customer.country;
    }

    // ── 2. Execute through the Execution Planner ───────────────────────────
    // The Planner selects the appropriate Execution Profile (FAST/SAFE/
    // SIMULATION/STRATEGIC/EMERGENCY) based on transaction characteristics,
    // then runs the profile-selected pipeline: Intent → Compiler → Policy →
    // Council (if needed) → Coordinator → Settlement → Dispatcher → Ledger.
    //
    // This is the ONLY entry point to the runtime. Nothing dispatches directly.
    //
    // C-3 fix (regrade 2026-08-08): this used to be
    // `params.currency !== 'USD' && params.currency !== params.currency` —
    // the second clause is `x !== x`, always false, so crossBorder was
    // ALWAYS false regardless of the actual transaction, and no payment
    // ever reached the SAFE/STRATEGIC execution profile's policy/council/
    // settlement review on that basis. Real signal: this payment flow is
    // single-currency (sourceCurrency === destinationCurrency === params.
    // currency below), so "cross-border" here means the merchant and the
    // customer are in different countries — sourced from `Merchant.country`
    // and `CustomerRecord.country`, not a currency proxy that can't fire.
    const merchantRow = await db.merchant.findUnique({
      where: { id: params.merchantId },
      select: { country: true },
    });
    const crossBorder = !!(
      merchantRow?.country &&
      customerCountry &&
      merchantRow.country !== customerCountry
    );
    const plannerResult = await executionPlanner.execute({
      command: {
        type: 'payment.create',
        payload: {
          merchantId: params.merchantId,
          customerId: customerId ?? undefined,
          amount: params.amount,
          currency: params.currency,
          sourceCurrency: params.currency,
          destinationCurrency: params.currency,
          method: params.method,
          corridor: `${params.currency}-${params.currency}`,
          description: params.description,
          reference,
          lpId: params.lpId ?? 'lp_simulated',
          lpFeeBps,
          success,
          customerName: params.customerName,
          customerEmail: params.customerEmail,
          actorId: params.actorId,
          timestamp: ts.getTime(),
          environment: params.environment,
        },
        metadata: {
          actor: { id: params.actorId ?? 'system:payment-service', role: 'merchant' },
          environment: (params.environment === 'live' ? 'live' : 'sandbox') as Environment,
          correlationId: `payment-create-${uuidv4()}`,
          source: 'api',
        },
      },
      transactionType: 'payment',
      amount: params.amount,
      currency: params.currency,
      crossBorder,
      metadata: {
        actor: { id: params.actorId ?? 'system:payment-service', role: 'merchant' },
        environment: (params.environment === 'live' ? 'live' : 'sandbox') as Environment,
        correlationId: `payment-create-${uuidv4()}`,
        source: 'api',
      },
    });
    const dispatch = plannerResult.dispatchResult;

    if (!dispatch.success || !dispatch.entityId) {
      throw new Error(
        `Payment dispatch failed: ${dispatch.error ?? dispatch.message}`,
      );
    }

    const paymentId = dispatch.entityId;
    const status = success ? 'COMPLETED' : 'FAILED';

    // ── 3. Emit application-level events (notification layer) ─────────────
    // These are NOT the source of truth — they notify webhook/analytics
    // projections. The financial truth lives in the runtime EventStore.
    if (params.emitEvents !== false) {
      const basePayload = {
        paymentId,
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
        aggregateId: paymentId,
        aggregateType: 'Payment',
        merchantId: params.merchantId,
        environment: params.environment,
        payload: basePayload,
        actorId: params.actorId,
      }));

      if (success) {
        await eventBus.emit(createEvent({
          type: 'payment.completed',
          aggregateId: paymentId,
          aggregateType: 'Payment',
          merchantId: params.merchantId,
          environment: params.environment,
          payload: { ...basePayload, settledAt: ts.toISOString() },
          actorId: params.actorId,
        }));
      } else {
        await eventBus.emit(createEvent({
          type: 'payment.failed',
          aggregateId: paymentId,
          aggregateType: 'Payment',
          merchantId: params.merchantId,
          environment: params.environment,
          payload: { ...basePayload, reason: 'Simulated failure' },
          actorId: params.actorId,
        }));
      }
    }

    return {
      id: paymentId,
      reference,
      status,
      amount: params.amount,
      fee,
      netAmount,
      dispatch,
    };
  }
}

export const paymentService = new PaymentServiceClass();
