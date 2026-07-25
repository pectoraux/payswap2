/**
 * PaySwap Protocol — Provider Adapter — Airtel Money (Mobile Money).
 *
 * Simulated Airtel Money Open API connector. Real implementations call
 * the Airtel Money Open API (openapi.airtel.africa) with an OAuth2
 * bearer token; this in-process simulation mirrors that surface area.
 *
 * Operations:
 *   - getBalance({ currency })                              — GET /standard/v1/users/balance
 *   - requestToPay({ msisdn, amount, currency, reference }) — POST /standard/v1/collections
 *   - transfer({ msisdn, amount, currency, reference })     — POST /standard/v1/disbursements
 *   - getTransactionStatus({ id })                          — GET /standard/v1/requests/{id}
 *
 * Auth: OAuth2 password/client-credentials flow. POST to
 * `/auth/oauth2/token` with `client_id` and `client_secret` in the
 * body; receive `{"access_token": "...", "expires_in": 3600}`.
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional',
 * reputation=0.83, jurisdiction='UG/KE/TZ/NG/RW/ZM'.
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
import {
  asConnectorConfig,
  isTokenExpired,
  type AuthResult,
  type AuthToken,
  type ProviderConfig,
} from './types';

/** Default config — Airtel Money sandbox characteristics. */
export const DEFAULT_AIRTEL_MONEY_CONFIG: ProviderConfig = {
  id: 'airtel_money',
  type: 'mobile_money',
  name: 'Airtel Money',
  endpoint: 'https://openapiuat.airtel.africa',
  timeout: 12_000,
  retryCount: 3,
  retryBackoffMs: 400,
  rateLimitRps: 5,
  rateLimitBurst: 10,
  idempotencyTtlMs: 10 * 60 * 1000,
  environment: 'sandbox',
};

interface AirtelTxRecord {
  id: string;
  msisdn: string;
  amount: number;
  currency: string;
  reference?: string;
  kind: 'collection' | 'disbursement';
  status: 'pending' | 'completed' | 'failed';
  airtelReference?: string;
  createdAt: number;
}

function pseudoBalance(currency: string): number {
  let h = 0;
  for (let i = 0; i < currency.length; i++) h = (h * 31 + currency.charCodeAt(i)) | 0;
  return round(3_000 + (Math.abs(h) % 99_990), 2);
}

export class AirtelMoneyConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private authToken: AuthToken | undefined;
  private readonly transactions = new Map<string, AirtelTxRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_AIRTEL_MONEY_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate();
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'getBalance':
        return this.getBalance(request.params);
      case 'requestToPay':
        return this.requestToPay(request.params);
      case 'transfer':
        return this.transfer(request.params);
      case 'getTransactionStatus':
        return this.getTransactionStatus(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['msisdn'] as string | undefined) ??
      (params['id'] as string | undefined) ??
      (params['currency'] as string | undefined) ??
      request.id;
    return createEvidence({
      type: 'fiat_proof',
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: 'airtel-money-connector',
      reputation: 0.83,
      jurisdiction: 'UG/KE/TZ/NG/RW/ZM',
      currency: params['currency'] as string | undefined,
      attestedAmount: typeof params['amount'] === 'number' ? round(params['amount'], 2) : undefined,
      payload: { operation: request.operation, requestId: request.id, provider: 'airtel_money', result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /** Simulated OAuth2 client-credentials flow against `/auth/oauth2/token`. */
  private authenticate(): AuthResult {
    if (!isTokenExpired(this.authToken)) {
      return { ok: true, token: this.authToken! };
    }
    const { clientId, clientSecret } = this.providerConfig;
    if (!clientId || !clientSecret) {
      return { ok: false, error: authFailed('airtel_money: clientId + clientSecret required') };
    }
    this.authToken = {
      accessToken: uid('airtel_tk'),
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600 * 1000,
      scope: 'standard',
    };
    return { ok: true, token: this.authToken };
  }

  // ----------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    return {
      ok: true,
      data: {
        status: { success: true, code: '200', message: 'OK' },
        data: { balance: pseudoBalance(currency), currency },
      },
    };
  }

  // ------------------------------------------------------------- requestToPay
  private requestToPay(params: Record<string, unknown>): DoQueryResult {
    const msisdn = params['msisdn'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    const reference = params['reference'] as string | undefined;
    if (!msisdn || amount === undefined) {
      return { ok: false, error: invalidResponse('msisdn_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = uid('airtel_col');
    const record: AirtelTxRecord = {
      id,
      msisdn,
      amount: round(amount, 2),
      currency,
      reference,
      kind: 'collection',
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transactions.set(id, record);
    return {
      ok: true,
      data: {
        status: { success: true, code: '201', message: 'request_accepted' },
        data: { id, message: 'collection initiated' },
      },
    };
  }

  // ------------------------------------------------------------------ transfer
  private transfer(params: Record<string, unknown>): DoQueryResult {
    const msisdn = params['msisdn'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    const reference = params['reference'] as string | undefined;
    if (!msisdn || amount === undefined) {
      return { ok: false, error: invalidResponse('msisdn_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = uid('airtel_dis');
    const record: AirtelTxRecord = {
      id,
      msisdn,
      amount: round(amount, 2),
      currency,
      reference,
      kind: 'disbursement',
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transactions.set(id, record);
    return {
      ok: true,
      data: {
        status: { success: true, code: '201', message: 'request_accepted' },
        data: { id, message: 'disbursement initiated' },
      },
    };
  }

  // ------------------------------------------------------- getTransactionStatus
  private getTransactionStatus(params: Record<string, unknown>): DoQueryResult {
    const id = params['id'] as string | undefined;
    if (!id) {
      return { ok: false, error: invalidResponse('id_required') };
    }
    const tx = this.transactions.get(id);
    if (!tx) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${id}`) };
    }
    if (tx.status === 'pending') {
      tx.status = 'completed';
      tx.airtelReference = uid('airtel_ref');
    }
    return {
      ok: true,
      data: {
        status: { success: true, code: '200', message: 'OK' },
        data: {
          id: tx.id,
          status: tx.status,
          amount: tx.amount,
          currency: tx.currency,
          reference: tx.reference,
          airtelReference: tx.airtelReference,
          msisdn: tx.msisdn,
        },
      },
    };
  }
}
