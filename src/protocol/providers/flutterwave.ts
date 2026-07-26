/**
 * PaySwap Protocol — Provider Adapter — Flutterwave (African PSP).
 *
 * Simulated Flutterwave API connector. Real implementations call the
 * Flutterwave REST API (api.flutterwave.com/v3) with a bearer secret
 * key and a secret-hash for webhook verification; this in-process
 * simulation mirrors that surface area.
 *
 * Operations:
 *   - initiatePayment({ amount, currency, customer, txRef, paymentOptions? })  — POST /v3/payments
 *   - verifyPayment({ id })                                                    — GET /v3/transactions/{id}/verify
 *   - createTransfer({ accountBank, accountNumber, amount, currency, narration, reference }) — POST /v3/transfers
 *   - getBalance({ currency })                                                 — GET /v3/balances
 *   - createPayout({ amount, currency, beneficiary, reference })               — POST /v3/payouts
 *
 * Auth: Bearer `SECRET_KEY` in the `Authorization` header. Flutterwave
 * also uses a `secret_hash` for webhook signature verification (passed
 * in the `SEC_KEY` config). Real impl validates `verif-hash` on
 * incoming webhook payloads; here we surface the hash via the evidence
 * payload for traceability.
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional',
 * reputation=0.87, jurisdiction='NG'.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid, round } from '@/kernel/support';
import type { ConnectorRequest } from '@/protocol/connectors-v2/types';
import { authFailed, invalidResponse } from '@/protocol/connectors-v2/errors';
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { IdempotencyStore } from '@/protocol/connectors-v2/idempotency';
import { ProductionConnector, type DoQueryResult } from '@/protocol/connectors-v2/base';
import { asConnectorConfig, type ProviderConfig } from './types';

/** Default config — Flutterwave sandbox characteristics. */
export const DEFAULT_FLUTTERWAVE_CONFIG: ProviderConfig = {
  id: 'flutterwave',
  type: 'psp',
  name: 'Flutterwave',
  endpoint: 'https://api.flutterwave.com/v3',
  timeout: 12_000,
  retryCount: 3,
  retryBackoffMs: 300,
  rateLimitRps: 15,
  rateLimitBurst: 30,
  idempotencyTtlMs: 15 * 60 * 1000,
  environment: 'sandbox',
};

interface FlwTxRecord {
  id: number;
  txRef: string;
  flwRef: string;
  amount: number;
  currency: string;
  customer: { email: string; name?: string; phone_number?: string };
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  paymentType?: string;
  createdAt: number;
}

interface FlwTransferRecord {
  id: number;
  accountBank: string;
  accountNumber: string;
  amount: number;
  currency: string;
  narration?: string;
  reference: string;
  status: 'pending' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  createdAt: number;
}

interface FlwPayoutRecord {
  id: number;
  amount: number;
  currency: string;
  beneficiary: { email: string; account?: string };
  reference: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  createdAt: number;
}

let _flwSeq = 0;
function nextFlwId(): number {
  _flwSeq += 1;
  return 1_000_000 + _flwSeq;
}

function pseudoBalance(currency: string): number {
  let h = 0;
  for (let i = 0; i < currency.length; i++) h = (h * 31 + currency.charCodeAt(i)) | 0;
  return round(50_000 + (Math.abs(h) % 950_000), 2);
}

export class FlutterwaveConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private readonly transactions = new Map<number, FlwTxRecord>();
  private readonly txRefIndex = new Map<string, number>();
  private readonly transfers = new Map<number, FlwTransferRecord>();
  private readonly payouts = new Map<number, FlwPayoutRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_FLUTTERWAVE_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate();
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'initiatePayment':
        return this.initiatePayment(request.params);
      case 'verifyPayment':
        return this.verifyPayment(request.params);
      case 'createTransfer':
        return this.createTransfer(request.params);
      case 'getBalance':
        return this.getBalance(request.params);
      case 'createPayout':
        return this.createPayout(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['id'] as number | undefined)?.toString() ??
      (params['txRef'] as string | undefined) ??
      (params['reference'] as string | undefined) ??
      (params['currency'] as string | undefined) ??
      request.id;
    const amount = params['amount'] as number | undefined;
    return createEvidence({
      type: 'fiat_proof',
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: 'flutterwave-connector',
      reputation: 0.87,
      jurisdiction: 'NG',
      currency: params['currency'] as string | undefined,
      attestedAmount: typeof amount === 'number' ? round(amount, 2) : undefined,
      payload: {
        operation: request.operation,
        requestId: request.id,
        provider: 'flutterwave',
        secretHashPresent: Boolean(this.providerConfig.secretHash),
        result,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /** Flutterwave uses a single bearer SECRET_KEY (FLWSECK-...). */
  private authenticate(): { ok: true } | { ok: false; error: ReturnType<typeof authFailed> } {
    const { apiKey } = this.providerConfig;
    if (!apiKey) {
      return { ok: false, error: authFailed('flutterwave: secret_key required') };
    }
    if (!apiKey.startsWith('FLWSECK-')) {
      return { ok: false, error: authFailed('flutterwave: secret_key must start with FLWSECK-') };
    }
    return { ok: true };
  }

  // ----------------------------------------------------------- initiatePayment
  private initiatePayment(params: Record<string, unknown>): DoQueryResult {
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    const customer = params['customer'] as { email: string; name?: string; phone_number?: string } | undefined;
    const txRef = (params['txRef'] as string | undefined) ?? `tx-${uid('flw')}`;
    const paymentOptions = (params['paymentOptions'] as string | undefined) ?? 'card';
    if (amount === undefined || !customer) {
      return { ok: false, error: invalidResponse('amount_customer_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = nextFlwId();
    const record: FlwTxRecord = {
      id,
      txRef,
      flwRef: `FLW-MOCK-${id}`,
      amount: round(amount, 2),
      currency,
      customer,
      status: 'pending',
      paymentType: paymentOptions,
      createdAt: Date.now(),
    };
    this.transactions.set(id, record);
    this.txRefIndex.set(txRef, id);
    return {
      ok: true,
      data: {
        status: 'success',
        message: 'Hosted Link',
        data: {
          id,
          tx_ref: txRef,
          flw_ref: record.flwRef,
          amount: record.amount,
          currency,
          payment_type: paymentOptions,
          link: `https://checkout.flutterwave.com/v3/hosted/pay/${txRef}`,
        },
      },
    };
  }

  // --------------------------------------------------------------- verifyPayment
  private verifyPayment(params: Record<string, unknown>): DoQueryResult {
    const id = params['id'] as number | undefined;
    const txRef = params['txRef'] as string | undefined;
    if (id === undefined && !txRef) {
      return { ok: false, error: invalidResponse('id_or_txRef_required') };
    }
    const resolvedId = id ?? (txRef ? this.txRefIndex.get(txRef) : undefined);
    if (resolvedId === undefined) {
      return { ok: false, error: invalidResponse('transaction_not_found') };
    }
    const tx = this.transactions.get(resolvedId);
    if (!tx) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${resolvedId}`) };
    }
    // Simulated settlement — first verify flips pending → successful.
    if (tx.status === 'pending') {
      tx.status = 'successful';
    }
    return {
      ok: true,
      data: {
        status: 'success',
        message: 'Transaction fetched successfully',
        data: {
          id: tx.id,
          tx_ref: tx.txRef,
          flw_ref: tx.flwRef,
          amount: tx.amount,
          currency: tx.currency,
          charged_amount: tx.amount,
          status: tx.status,
          payment_type: tx.paymentType,
          customer: tx.customer,
          created_at: tx.createdAt,
        },
      },
    };
  }

  // ------------------------------------------------------------- createTransfer
  private createTransfer(params: Record<string, unknown>): DoQueryResult {
    const accountBank = params['accountBank'] as string | undefined;
    const accountNumber = params['accountNumber'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    const narration = params['narration'] as string | undefined;
    const reference = (params['reference'] as string | undefined) ?? `trf-${uid('flw')}`;
    if (!accountBank || !accountNumber || amount === undefined) {
      return { ok: false, error: invalidResponse('accountBank_accountNumber_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = nextFlwId();
    const record: FlwTransferRecord = {
      id,
      accountBank,
      accountNumber,
      amount: round(amount, 2),
      currency,
      narration,
      reference,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transfers.set(id, record);
    return {
      ok: true,
      data: {
        status: 'success',
        message: 'Transfer queued successfully',
        data: { id, account_number: accountNumber, amount: record.amount, currency, reference, status: record.status },
      },
    };
  }

  // ------------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    const balance = pseudoBalance(currency);
    return {
      ok: true,
      data: {
        status: 'success',
        message: 'Balances fetched',
        data: { available_balance: balance, ledger_balance: round(balance * 1.05, 2), currency },
      },
    };
  }

  // ------------------------------------------------------------------- createPayout
  private createPayout(params: Record<string, unknown>): DoQueryResult {
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    const beneficiary = params['beneficiary'] as { email: string; account?: string } | undefined;
    const reference = (params['reference'] as string | undefined) ?? `pay-${uid('flw')}`;
    if (amount === undefined || !beneficiary) {
      return { ok: false, error: invalidResponse('amount_beneficiary_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = nextFlwId();
    const record: FlwPayoutRecord = {
      id,
      amount: round(amount, 2),
      currency,
      beneficiary,
      reference,
      status: 'PENDING',
      createdAt: Date.now(),
    };
    this.payouts.set(id, record);
    return {
      ok: true,
      data: {
        status: 'success',
        message: 'Payout initiated',
        data: { id, amount: record.amount, currency, reference, status: record.status },
      },
    };
  }
}
