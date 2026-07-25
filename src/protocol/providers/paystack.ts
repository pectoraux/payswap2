/**
 * PaySwap Protocol — Provider Adapter — Paystack (African PSP).
 *
 * Simulated Paystack API connector. Real implementations call the
 * Paystack REST API (api.paystack.co) with a bearer secret key
 * (`sk_live_...` / `sk_test_...`); this in-process simulation mirrors
 * that surface area.
 *
 * Operations:
 *   - initializeTransaction({ email, amount, currency, reference, callbackUrl }) — POST /transaction/initialize
 *   - verifyTransaction({ reference })                                          — GET /transaction/verify/{reference}
 *   - createTransferRecipient({ type, name, accountNumber, bankCode, currency }) — POST /transferrecipient
 *   - initiateTransfer({ source, amount, recipient, reason })                    — POST /transfer
 *   - getBalance({ ledger? })                                                    — GET /balance
 *
 * Auth: Bearer secret key in the `Authorization` header. Paystack
 * accepts both live (`sk_live_...`) and test (`sk_test_...`) keys.
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional',
 * reputation=0.88, jurisdiction='NG'.
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

/** Default config — Paystack sandbox characteristics. */
export const DEFAULT_PAYSTACK_CONFIG: ProviderConfig = {
  id: 'paystack',
  type: 'psp',
  name: 'Paystack',
  endpoint: 'https://api.paystack.co',
  timeout: 12_000,
  retryCount: 3,
  retryBackoffMs: 300,
  rateLimitRps: 20,
  rateLimitBurst: 40,
  idempotencyTtlMs: 15 * 60 * 1000,
  environment: 'test',
};

interface PaystackTxRecord {
  id: number;
  reference: string;
  amount: number; // in kobo (smallest unit)
  currency: string;
  email: string;
  status: 'pending' | 'success' | 'failed' | 'abandoned';
  channel?: string;
  authorizationUrl: string;
  accessCode: string;
  gatewayResponse?: string;
  createdAt: number;
}

interface PaystackRecipient {
  recipientCode: string;
  type: 'nuban' | 'mobile_money' | 'basa' | 'international_transfer';
  name: string;
  accountNumber: string;
  bankCode: string;
  currency: string;
  createdAt: number;
}

interface PaystackTransferRecord {
  transferCode: string;
  reference: string;
  amount: number;
  currency: string;
  recipient: string;
  reason?: string;
  status: 'pending' | 'success' | 'failed' | 'reversed';
  transferId: number;
  createdAt: number;
}

let _paystackSeq = 0;
function nextPaystackId(): number {
  _paystackSeq += 1;
  return 10_000_000 + _paystackSeq;
}

/** Convert major-unit amount to kobo (smallest unit). */
function toKobo(amount: number): number {
  return Math.round(amount * 100);
}

function fromKobo(amount: number): number {
  return round(amount / 100, 2);
}

function pseudoBalance(): number {
  // Stable across calls; ~500k NGN in kobo.
  return 50_000_000;
}

export class PaystackConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private readonly transactions = new Map<string, PaystackTxRecord>();
  private readonly recipients = new Map<string, PaystackRecipient>();
  private readonly transfers = new Map<string, PaystackTransferRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_PAYSTACK_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate();
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'initializeTransaction':
        return this.initializeTransaction(request.params);
      case 'verifyTransaction':
        return this.verifyTransaction(request.params);
      case 'createTransferRecipient':
        return this.createTransferRecipient(request.params);
      case 'initiateTransfer':
        return this.initiateTransfer(request.params);
      case 'getBalance':
        return this.getBalance(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['reference'] as string | undefined) ??
      (params['recipient'] as string | undefined) ??
      (params['email'] as string | undefined) ??
      request.id;
    const amount = params['amount'] as number | undefined;
    return createEvidence({
      type: 'fiat_proof',
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: 'paystack-connector',
      reputation: 0.88,
      jurisdiction: 'NG',
      currency: params['currency'] as string | undefined,
      attestedAmount: typeof amount === 'number' ? round(amount, 2) : undefined,
      payload: { operation: request.operation, requestId: request.id, provider: 'paystack', result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /** Paystack uses a single bearer secret key. */
  private authenticate(): { ok: true } | { ok: false; error: ReturnType<typeof authFailed> } {
    const { apiKey } = this.providerConfig;
    if (!apiKey) {
      return { ok: false, error: authFailed('paystack: secret_key required') };
    }
    if (!apiKey.startsWith('sk_')) {
      return { ok: false, error: authFailed('paystack: secret_key must start with sk_') };
    }
    return { ok: true };
  }

  // -------------------------------------------------- initializeTransaction
  private initializeTransaction(params: Record<string, unknown>): DoQueryResult {
    const email = params['email'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    const reference = (params['reference'] as string | undefined) ?? `psk-${uid('ref')}`;
    const callbackUrl = params['callbackUrl'] as string | undefined;
    if (!email || amount === undefined) {
      return { ok: false, error: invalidResponse('email_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = nextPaystackId();
    const accessCode = uid('ac');
    const record: PaystackTxRecord = {
      id,
      reference,
      amount: toKobo(amount),
      currency,
      email,
      status: 'pending',
      authorizationUrl: `https://checkout.paystack.com/${accessCode}`,
      accessCode,
      createdAt: Date.now(),
    };
    this.transactions.set(reference, record);
    return {
      ok: true,
      data: {
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: record.authorizationUrl,
          access_code: accessCode,
          reference,
          amount: record.amount,
          currency,
          callback_url: callbackUrl,
        },
      },
    };
  }

  // ------------------------------------------------------- verifyTransaction
  private verifyTransaction(params: Record<string, unknown>): DoQueryResult {
    const reference = params['reference'] as string | undefined;
    if (!reference) {
      return { ok: false, error: invalidResponse('reference_required') };
    }
    const tx = this.transactions.get(reference);
    if (!tx) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${reference}`) };
    }
    if (tx.status === 'pending') {
      tx.status = 'success';
      tx.gatewayResponse = 'Successful';
      tx.channel = 'card';
    }
    return {
      ok: true,
      data: {
        status: true,
        message: 'Verification successful',
        data: {
          id: tx.id,
          reference: tx.reference,
          amount: tx.amount,
          amountMajor: fromKobo(tx.amount),
          currency: tx.currency,
          email: tx.email,
          status: tx.status,
          channel: tx.channel,
          gateway_response: tx.gatewayResponse,
          created_at: tx.createdAt,
        },
      },
    };
  }

  // ---------------------------------------------- createTransferRecipient
  private createTransferRecipient(params: Record<string, unknown>): DoQueryResult {
    const type = (params['type'] as PaystackRecipient['type'] | undefined) ?? 'nuban';
    const name = params['name'] as string | undefined;
    const accountNumber = params['accountNumber'] as string | undefined;
    const bankCode = params['bankCode'] as string | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    if (!name || !accountNumber || !bankCode) {
      return { ok: false, error: invalidResponse('name_accountNumber_bankCode_required') };
    }
    const recipientCode = `RCP_${uid('psk').slice(-12)}`;
    const recipient: PaystackRecipient = {
      recipientCode,
      type,
      name,
      accountNumber,
      bankCode,
      currency,
      createdAt: Date.now(),
    };
    this.recipients.set(recipientCode, recipient);
    return {
      ok: true,
      data: {
        status: true,
        message: 'Recipient created',
        data: {
          type,
          name,
          account_number: accountNumber,
          bank_code: bankCode,
          currency,
          recipient_code: recipientCode,
          active: true,
          created_at: recipient.createdAt,
        },
      },
    };
  }

  // ------------------------------------------------------- initiateTransfer
  private initiateTransfer(params: Record<string, unknown>): DoQueryResult {
    const source = (params['source'] as string | undefined) ?? 'balance';
    const amount = params['amount'] as number | undefined;
    const recipient = params['recipient'] as string | undefined;
    const reason = params['reason'] as string | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'NGN';
    if (amount === undefined || !recipient) {
      return { ok: false, error: invalidResponse('amount_recipient_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const transferId = nextPaystackId();
    const transferCode = `TRF_${uid('psk').slice(-12)}`;
    const reference = `psk-tx-${transferId}`;
    const record: PaystackTransferRecord = {
      transferCode,
      reference,
      amount: toKobo(amount),
      currency,
      recipient,
      reason,
      status: 'success',
      transferId,
      createdAt: Date.now(),
    };
    this.transfers.set(transferCode, record);
    return {
      ok: true,
      data: {
        status: true,
        message: 'Transfer has been queued',
        data: {
          amount: record.amount,
          amountMajor: fromKobo(record.amount),
          currency,
          recipient,
          reason,
          source,
          transfer_code: transferCode,
          reference,
          id: transferId,
          status: record.status,
          created_at: record.createdAt,
        },
      },
    };
  }

  // --------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const ledger = (params['ledger'] as boolean | undefined) ?? false;
    const kobo = pseudoBalance();
    return {
      ok: true,
      data: {
        status: true,
        message: 'Balances retrieved',
        data: {
          balance: ledger ? Math.round(kobo * 1.05) : kobo,
          balanceMajor: fromKobo(ledger ? Math.round(kobo * 1.05) : kobo),
          currency: 'NGN',
        },
      },
    };
  }
}
