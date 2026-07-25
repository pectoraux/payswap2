/**
 * PaySwap Protocol — Production Connectors v2 — M-Pesa Connector.
 *
 * Real-shape simulated Safaricom Daraja API connector. Operations:
 *   - getBalance({ phoneNumber })                          → balance, currency
 *   - sendSTKPush({ phoneNumber, amount, callbackUrl })    → ConversationID, OriginatorConversationID, ResponseCode
 *   - verifyTransaction({ transactionId })                  → ResponseCode, ResponseDescription, status
 *   - reverseTransaction({ transactionId })                 → ConversationID, status
 *
 * Auth: OAuth2 access token (simulated). In production this is a two-step flow:
 *   1. GET /oauth/v1/generate?grant_type=client_credentials with Basic auth → access_token
 *   2. Bearer access_token on all subsequent calls
 * We simulate the same shape: resolveOAuthToken() returns a deterministic token.
 *
 * Response shapes mirror Daraja API: ConversationID, OriginatorConversationID,
 * ResponseCode ('0' = success), ResponseDescription.
 *
 * Evidence: source='psp_confirmation', verificationLevel='institutional',
 *           reputation=0.85. TTL 90s.
 */
import type { Evidence } from '@/kernel/evidence';
import type {
  ConnectorConfig,
  ConnectorError,
  ConnectorRequest,
} from './types';
import { ProductionConnector, buildAttestationEvidence } from './base';
import { invalidResponse } from './errors';
import { deterministicHash } from './open-banking';

const DEFAULT_CONFIG: ConnectorConfig = {
  id: 'mpesa',
  type: 'mobile_money',
  name: 'Safaricom M-Pesa Daraja API',
  endpoint: 'https://sandbox.safaricom.co.ke',
  apiKeyRef: 'vault://payswap/mpesa/prod/consumer-key',
  secretRef: 'vault://payswap/mpesa/prod/hmac-secret',
  timeout: 10_000,
  retryCount: 2,
  retryBackoffMs: 500,
  rateLimitRps: 5,
  rateLimitBurst: 10,
  idempotencyTtlMs: 90_000,
};

export class MpesaConnector extends ProductionConnector {
  constructor(config?: Partial<ConnectorConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  /** Simulated OAuth2 token resolution (real Daraja: Basic auth → access_token). */
  protected resolveOAuthToken(): string {
    // In production: fetch(`${endpoint}/oauth/v1/generate?grant_type=client_credentials`,
    //   { headers: { Authorization: `Basic ${base64(consumerKey:consumerSecret)}` } })
    //   .then(r => r.json()) → r.access_token
    if (!this.apiKey) return '<unresolved-oauth-token>';
    return `access_${deterministicHash(this.apiKey).slice(0, 24)}`;
  }

  protected authHeader(): string {
    return `Bearer ${this.resolveOAuthToken()}`;
  }

  async doQuery(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    // In production: fetch(`${endpoint}/${path}`, {
    //   method: 'POST', headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
    //   body: JSON.stringify(request.params),
    // });
    switch (request.operation) {
      case 'getBalance':
        return this.simGetBalance(request);
      case 'sendSTKPush':
        return this.simSendSTKPush(request);
      case 'verifyTransaction':
        return this.simVerifyTransaction(request);
      case 'reverseTransaction':
        return this.simReverseTransaction(request);
      default:
        return { result: {}, error: invalidResponse(`Unknown operation: ${request.operation}`) };
    }
  }

  private simGetBalance(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const phoneNumber = request.params.phoneNumber as string | undefined;
    if (!phoneNumber) {
      return { result: {}, error: invalidResponse('phoneNumber required') };
    }
    // Daraja account-balance response shape.
    const balance = (request.params.expectedBalance as number | undefined)
      ?? deterministicBalance(phoneNumber, 'KES');
    return {
      result: {
        ConversationID: `AG_${deterministicHash(phoneNumber).slice(0, 24).toUpperCase()}`,
        OriginatorConversationID: `OC-${request.id.slice(0, 16)}`,
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully.',
        balance,
        currency: 'KES',
      },
    };
  }

  private simSendSTKPush(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { phoneNumber, amount, callbackUrl } = request.params as {
      phoneNumber?: string; amount?: number; callbackUrl?: string;
    };
    if (!phoneNumber || amount == null) {
      return { result: {}, error: invalidResponse('phoneNumber and amount required') };
    }
    // Daraja STK push response shape.
    const merchantRequestId = `29115-${deterministicHash(`${phoneNumber}${amount}`).slice(0, 8)}`;
    const checkoutRequestId = `ws_CO_${deterministicHash(`${request.id}${phoneNumber}`).slice(0, 16)}`;
    return {
      result: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing',
        CustomerMessage: 'Success. Request accepted for processing',
        callbackUrl: callbackUrl ?? 'https://payswap.example.com/mpesa/callback',
      },
    };
  }

  private simVerifyTransaction(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const transactionId = request.params.transactionId as string | undefined;
    if (!transactionId) {
      return { result: {}, error: invalidResponse('transactionId required') };
    }
    // Deterministic transaction status.
    const status = transactionId.includes('FAIL')
      ? 'failed'
      : transactionId.includes('PEND')
      ? 'pending'
      : 'completed';
    return {
      result: {
        ConversationID: `AG_${deterministicHash(transactionId).slice(0, 24).toUpperCase()}`,
        OriginatorConversationID: `OC-${transactionId.slice(0, 16)}`,
        ResponseCode: status === 'completed' ? '0' : status === 'pending' ? '1' : '2',
        ResponseDescription:
          status === 'completed' ? 'Transaction completed successfully'
          : status === 'pending' ? 'Transaction pending confirmation'
          : 'Transaction failed',
        status,
        amount: deterministicBalance(transactionId, 'KES'),
        currency: 'KES',
      },
    };
  }

  private simReverseTransaction(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const transactionId = request.params.transactionId as string | undefined;
    if (!transactionId) {
      return { result: {}, error: invalidResponse('transactionId required') };
    }
    return {
      result: {
        ConversationID: `AG_REV_${deterministicHash(transactionId).slice(0, 20).toUpperCase()}`,
        OriginatorConversationID: `OC-REV-${transactionId.slice(0, 12)}`,
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully.',
        status: 'reversed',
        originalTransactionId: transactionId,
      },
    };
  }

  buildEvidence(request: ConnectorRequest, result: Record<string, unknown>): Evidence {
    const phoneNumber = request.params.phoneNumber as string | undefined;
    const transactionId =
      (request.params.transactionId as string | undefined) ??
      (result.CheckoutRequestID as string | undefined) ??
      (result.ConversationID as string | undefined);

    let attestedAmount: number | undefined;
    let attestedValue = '';
    const currency = (result.currency as string | undefined) ?? 'KES';

    if (request.operation === 'getBalance') {
      attestedAmount = result.balance as number | undefined;
      attestedValue = `${attestedAmount} ${currency} on M-Pesa`;
    } else if (request.operation === 'sendSTKPush') {
      const amt = request.params.amount as number | undefined;
      attestedAmount = amt;
      attestedValue = `STK push ${amt} ${currency} to ${phoneNumber}`;
    } else if (request.operation === 'verifyTransaction') {
      attestedAmount = result.amount as number | undefined;
      attestedValue = `M-Pesa transaction ${transactionId}: ${result.status}`;
    } else if (request.operation === 'reverseTransaction') {
      attestedValue = `M-Pesa transaction ${transactionId} reversed`;
    }

    const entityId = phoneNumber
      ? `mmo:${phoneNumber}`
      : transactionId
      ? `mpesa-tx:${transactionId}`
      : 'mpesa';

    return buildAttestationEvidence({
      source: 'psp_confirmation',
      verificationLevel: 'institutional',
      entityId,
      attester: this.config.id,
      attestedAmount,
      currency,
      reputation: 0.85,
      jurisdiction: 'KE',
      ttlMs: 90_000,
      payload: {
        connector: this.config.id,
        connectorType: this.config.type,
        operation: request.operation,
        attestedValue,
        phoneNumber,
        transactionId,
        conversationId: result.ConversationID,
        responseCode: result.ResponseCode,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Math.floor(Math.random() * 200) + 100 };
  }
}

/** Deterministic pseudo-balance for a phone/transaction identifier. */
function deterministicBalance(id: string, currency: string): number {
  const h = deterministicHash(`${id}|${currency}`);
  const n = parseInt(h.slice(0, 8), 16);
  return 500 + (n % 99500);
}
