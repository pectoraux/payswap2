/**
 * PaySwap Protocol — Provider Adapter — MTN MoMo (Mobile Money).
 *
 * Simulated MTN MoMo Open API connector. Real implementations call the
 * MTN MoMo Developer Portal endpoints (collection + disbursement +
 * remittance products) with OAuth2 bearer tokens and an
 * `Ocp-Apim-Subscription-Key` header; this in-process simulation
 * mirrors that surface area so the protocol layer can run end-to-end.
 *
 * Operations:
 *   - getBalance({ currency })                              — GET /collection/v1_0/account/balance
 *   - requestToPay({ msisdn, amount, currency, payeeNote }) — POST /collection/v1_0/requesttopay
 *   - transfer({ msisdn, amount, currency, note })          — POST /disbursement/v1_0/transfer
 *   - getTransactionStatus({ referenceId })                 — GET /collection/v1_0/requesttopay/{referenceId}
 *
 * Auth: OAuth2 client-credentials flow + `Ocp-Apim-Subscription-Key`
 * header on every request. The token endpoint accepts HTTP Basic auth
 * with `clientId:clientSecret` and returns a bearer token valid for
 * ~3600s. We simulate the dance lazily — the first authenticated call
 * mints a token, subsequent calls reuse it until expiry.
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional',
 * reputation=0.85, jurisdiction='UG/CI/CM/CD/RW/ZM' (MTN markets).
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

/** Default config — MTN MoMo sandbox characteristics. */
export const DEFAULT_MTN_MOMO_CONFIG: ProviderConfig = {
  id: 'mtn_momo',
  type: 'mobile_money',
  name: 'MTN MoMo',
  endpoint: 'https://sim.momodeveloper.mtn.com',
  timeout: 12_000,
  retryCount: 3,
  retryBackoffMs: 400,
  rateLimitRps: 5,
  rateLimitBurst: 10,
  idempotencyTtlMs: 10 * 60 * 1000,
  environment: 'sandbox',
};

interface MtnRequestToPayRecord {
  referenceId: string;
  msisdn: string;
  amount: number;
  currency: string;
  payeeNote?: string;
  payerMessage?: string;
  status: 'pending' | 'successful' | 'failed' | 'rejected';
  reason?: string;
  financialTransactionId?: string;
  createdAt: number;
}

interface MtnTransferRecord {
  referenceId: string;
  msisdn: string;
  amount: number;
  currency: string;
  note?: string;
  status: 'pending' | 'successful' | 'failed';
  financialTransactionId?: string;
  createdAt: number;
}

/** Deterministic pseudo-balance from the configured account holder. */
function pseudoBalance(currency: string): number {
  let h = 0;
  for (let i = 0; i < currency.length; i++) h = (h * 31 + currency.charCodeAt(i)) | 0;
  return round(5_000 + (Math.abs(h) % 99_990), 2);
}

export class MtnMomoConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private authToken: AuthToken | undefined;
  private readonly requestToPayRecords = new Map<string, MtnRequestToPayRecord>();
  private readonly transferRecords = new Map<string, MtnTransferRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_MTN_MOMO_CONFIG, ...config };
    super(
      asConnectorConfig(merged),
      healthMonitor,
      metricsCollector,
      idempotency,
    );
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
      (params['referenceId'] as string | undefined) ??
      (params['currency'] as string | undefined) ??
      request.id;
    return createEvidence({
      type: 'fiat_proof',
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: 'mtn-momo-connector',
      reputation: 0.85,
      jurisdiction: 'UG/CI/CM/CD/RW/ZM',
      currency: params['currency'] as string | undefined,
      attestedAmount: typeof params['amount'] === 'number' ? round(params['amount'], 2) : undefined,
      payload: { operation: request.operation, requestId: request.id, provider: 'mtn_momo', result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    // Real impl: GET /collection/v1_0/requesttopay/health or ping the API root.
    const auth = this.authenticate();
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /**
   * Simulated OAuth2 client-credentials flow. Real impl POSTs to
   * `/collection/token/` with HTTP Basic auth using `clientId:clientSecret`
   * and parses `{"access_token": "...", "expires_in": 3600, "token_type": "Bearer"}`.
   */
  private authenticate(): AuthResult {
    if (!isTokenExpired(this.authToken)) {
      return { ok: true, token: this.authToken! };
    }
    const { clientId, clientSecret, subscriptionKey } = this.providerConfig;
    if (!clientId || !clientSecret) {
      return { ok: false, error: authFailed('mtn_momo: clientId + clientSecret required') };
    }
    if (!subscriptionKey) {
      return { ok: false, error: authFailed('mtn_momo: Ocp-Apim-Subscription-Key required') };
    }
    this.authToken = {
      accessToken: uid('mtn_tk'),
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600 * 1000,
      scope: 'collection disbursement',
    };
    return { ok: true, token: this.authToken };
  }

  // ----------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const currency = (params['currency'] as string | undefined) ?? 'EUR';
    return {
      ok: true,
      data: {
        currency,
        availableBalance: pseudoBalance(currency),
        status: 'AVAILABLE',
        asOf: Date.now(),
      },
    };
  }

  // ------------------------------------------------------------- requestToPay
  private requestToPay(params: Record<string, unknown>): DoQueryResult {
    const msisdn = params['msisdn'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'EUR';
    const payeeNote = params['payeeNote'] as string | undefined;
    const payerMessage = params['payerMessage'] as string | undefined;
    if (!msisdn || amount === undefined) {
      return { ok: false, error: invalidResponse('msisdn_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const referenceId = uid('mtn_rtp');
    const record: MtnRequestToPayRecord = {
      referenceId,
      msisdn,
      amount: round(amount, 2),
      currency,
      payeeNote,
      payerMessage,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.requestToPayRecords.set(referenceId, record);
    // Simulated acceptance — MTN returns 202 Accepted with no body, the
    // caller polls getTransactionStatus with the X-Reference-Id.
    return {
      ok: true,
      data: { referenceId, status: 202, message: 'request_accepted' },
    };
  }

  // ------------------------------------------------------------------ transfer
  private transfer(params: Record<string, unknown>): DoQueryResult {
    const msisdn = params['msisdn'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'EUR';
    const note = params['note'] as string | undefined;
    if (!msisdn || amount === undefined) {
      return { ok: false, error: invalidResponse('msisdn_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const referenceId = uid('mtn_xfer');
    const record: MtnTransferRecord = {
      referenceId,
      msisdn,
      amount: round(amount, 2),
      currency,
      note,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transferRecords.set(referenceId, record);
    return {
      ok: true,
      data: { referenceId, status: 202, message: 'transfer_accepted' },
    };
  }

  // ------------------------------------------------------- getTransactionStatus
  private getTransactionStatus(params: Record<string, unknown>): DoQueryResult {
    const referenceId = params['referenceId'] as string | undefined;
    if (!referenceId) {
      return { ok: false, error: invalidResponse('referenceId_required') };
    }
    const rtp = this.requestToPayRecords.get(referenceId);
    if (rtp) {
      if (rtp.status === 'pending') {
        rtp.status = 'successful';
        rtp.financialTransactionId = uid('mtn_fitx');
      }
      return {
        ok: true,
        data: {
          referenceId: rtp.referenceId,
          status: rtp.status,
          amount: rtp.amount,
          currency: rtp.currency,
          msisdn: rtp.msisdn,
          financialTransactionId: rtp.financialTransactionId,
          reason: rtp.reason,
        },
      };
    }
    const xfer = this.transferRecords.get(referenceId);
    if (xfer) {
      if (xfer.status === 'pending') {
        xfer.status = 'successful';
        xfer.financialTransactionId = uid('mtn_fitx');
      }
      return {
        ok: true,
        data: {
          referenceId: xfer.referenceId,
          status: xfer.status,
          amount: xfer.amount,
          currency: xfer.currency,
          msisdn: xfer.msisdn,
          financialTransactionId: xfer.financialTransactionId,
        },
      };
    }
    return { ok: false, error: invalidResponse(`reference_not_found:${referenceId}`) };
  }
}
