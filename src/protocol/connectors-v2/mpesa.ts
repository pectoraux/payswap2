/**
 * PaySwap Protocol — Production Connectors v2 — M-Pesa (Daraja).
 *
 * Simulated Safaricom Daraja API connector. Real implementations call
 * the Daraja REST endpoints (sandbox or production) with OAuth + STK Push;
 * this in-process simulation mirrors that surface area.
 *
 * Operations:
 *   - getBalance({ phoneNumber })
 *   - sendSTKPush({ phoneNumber, amount, callbackUrl })
 *   - verifyTransaction({ transactionId })
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional', reputation=0.85.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid, round } from '@/kernel/support';
import type { ConnectorConfig, ConnectorRequest } from './types';
import { invalidResponse } from './errors';
import { HealthMonitor } from './health';
import { MetricsCollector } from './metrics';
import { IdempotencyStore } from './idempotency';
import { ProductionConnector, type DoQueryResult } from './base';

/** Default config — Daraja sandbox-like characteristics. */
export const DEFAULT_MPESA_CONFIG: ConnectorConfig = {
  id: 'mpesa',
  type: 'mpesa',
  name: 'M-Pesa (Daraja)',
  endpoint: 'sim://mpesa/daraja/v1',
  timeout: 15_000,
  retryCount: 2,
  retryBackoffMs: 500,
  rateLimitRps: 5,
  rateLimitBurst: 10,
  idempotencyTtlMs: 10 * 60 * 1000,
};

interface StkPushRecord {
  checkoutRequestId: string;
  merchantRequestId: string;
  phoneNumber: string;
  amount: number;
  callbackUrl: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  transactionId?: string;
  createdAt: number;
}

interface TransactionRecord {
  transactionId: string;
  phoneNumber: string;
  amount: number;
  status: 'completed' | 'failed' | 'pending';
  createdAt: number;
}

/** Deterministic M-Pesa balance from a phone number — stable across calls. */
function pseudoBalance(phoneNumber: string): number {
  let h = 0;
  for (let i = 0; i < phoneNumber.length; i++) h = (h * 31 + phoneNumber.charCodeAt(i)) | 0;
  const positive = Math.abs(h);
  return round(100 + (positive % 9999) * 10, 2); // 100..99,990 in 10-unit steps
}

export class MpesaConnector extends ProductionConnector {
  /** checkoutRequestId -> STK Push record. */
  private stkPushes = new Map<string, StkPushRecord>();
  /** transactionId -> transaction record. */
  private transactions = new Map<string, TransactionRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ConnectorConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(
      { ...DEFAULT_MPESA_CONFIG, ...config },
      healthMonitor,
      metricsCollector,
      idempotency,
    );
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    switch (request.operation) {
      case 'getBalance':
        return this.getBalance(request.params);
      case 'sendSTKPush':
        return this.sendSTKPush(request.params);
      case 'verifyTransaction':
        return this.verifyTransaction(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['phoneNumber'] as string | undefined) ??
      (params['transactionId'] as string | undefined) ??
      request.id;
    return createEvidence({
      type: 'fiat_proof',
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: 'mpesa-connector-v2',
      reputation: 0.85,
      jurisdiction: 'Kenya',
      payload: { operation: request.operation, requestId: request.id, result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Date.now() - start };
  }

  // ---------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const phoneNumber = params['phoneNumber'] as string | undefined;
    if (!phoneNumber) {
      return { ok: false, error: invalidResponse('phoneNumber_required') };
    }
    const balance = pseudoBalance(phoneNumber);
    return {
      ok: true,
      data: { phoneNumber, currency: 'KES', balance, available: balance, asOf: Date.now() },
    };
  }

  // -------------------------------------------------------------- sendSTKPush
  private sendSTKPush(params: Record<string, unknown>): DoQueryResult {
    const phoneNumber = params['phoneNumber'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const callbackUrl = (params['callbackUrl'] as string | undefined) ?? '';
    if (!phoneNumber || amount === undefined) {
      return { ok: false, error: invalidResponse('phoneNumber_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const checkoutRequestId = uid('mpesackr');
    const merchantRequestId = uid('mpesamr');
    const record: StkPushRecord = {
      checkoutRequestId,
      merchantRequestId,
      phoneNumber,
      amount: round(amount, 2),
      callbackUrl,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.stkPushes.set(checkoutRequestId, record);
    return {
      ok: true,
      data: {
        checkoutRequestId,
        merchantRequestId,
        status: record.status,
        responseCode: '0',
        responseDescription: 'Success. Request accepted for processing',
      },
    };
  }

  // --------------------------------------------------------- verifyTransaction
  private verifyTransaction(params: Record<string, unknown>): DoQueryResult {
    const transactionId = params['transactionId'] as string | undefined;
    const checkoutRequestId = params['checkoutRequestId'] as string | undefined;
    if (!transactionId && !checkoutRequestId) {
      return { ok: false, error: invalidResponse('transactionId_or_checkoutRequestId_required') };
    }

    // If caller passed a checkoutRequestId, resolve it to a transaction.
    if (checkoutRequestId) {
      const stk = this.stkPushes.get(checkoutRequestId);
      if (!stk) {
        return { ok: false, error: invalidResponse(`checkout_request_not_found:${checkoutRequestId}`) };
      }
      // Simulated STK Push confirmation: pending -> success on first verify.
      if (stk.status === 'pending') {
        stk.status = 'success';
        const txId = stk.transactionId ?? uid('mpesatx');
        stk.transactionId = txId;
        const tx: TransactionRecord = {
          transactionId: txId,
          phoneNumber: stk.phoneNumber,
          amount: stk.amount,
          status: 'completed',
          createdAt: Date.now(),
        };
        this.transactions.set(txId, tx);
      }
      return {
        ok: true,
        data: {
          checkoutRequestId: stk.checkoutRequestId,
          transactionId: stk.transactionId,
          status: stk.status,
          amount: stk.amount,
          phoneNumber: stk.phoneNumber,
        },
      };
    }

    // transactionId path
    const tx = this.transactions.get(transactionId!);
    if (!tx) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${transactionId}`) };
    }
    return {
      ok: true,
      data: {
        transactionId: tx.transactionId,
        status: tx.status,
        amount: tx.amount,
        phoneNumber: tx.phoneNumber,
      },
    };
  }

  /** Test helper: force a checkout request into a specific state. */
  _setStkPushStatus(checkoutRequestId: string, status: StkPushRecord['status']): void {
    const r = this.stkPushes.get(checkoutRequestId);
    if (r) r.status = status;
  }
}
