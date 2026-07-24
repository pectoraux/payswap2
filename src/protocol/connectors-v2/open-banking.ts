/**
 * PaySwap Protocol — Production Connectors v2 — Open Banking Connector.
 *
 * Real-shape simulated PSD2 / Open Banking API connector. Operations:
 *   - getBalance({ accountId, currency })            → balances[] (PSD2 shape)
 *   - initiateTransfer({ fromAccount, toAccount, amount, currency, reference })
 *                                                      → transactionId, status
 *   - verifyTransfer({ transferId })                  → status, amount, valueDateTime
 *   - getAccount({ accountId })                       → accountId, iban, bic, status
 *
 * Auth: `Authorization: Bearer <token>` (simulated, token resolved from apiKeyRef).
 *
 * The simulated response shapes mirror the UK Open Banking / Berlin Group PSD2
 * standards — IBAN, BIC, balance amount/currency, transaction reference. The
 * doQuery method is structured so that swapping the simulation body for a real
 * `fetch(this.config.endpoint + path, { headers })` is a 1:1 substitution.
 *
 * Evidence: source='open_banking', verificationLevel='institutional',
 *           reputation=0.9. Payload includes accountId, balance, attestedValue.
 */
import type { Evidence } from '@/kernel/evidence';
import type {
  ConnectorConfig,
  ConnectorError,
  ConnectorId,
  ConnectorRequest,
  ConnectorType,
} from './types';
import { ProductionConnector, buildAttestationEvidence } from './base';
import { invalidResponse } from './errors';

const DEFAULT_CONFIG: ConnectorConfig = {
  id: 'open_banking',
  type: 'bank',
  name: 'Open Banking API (PSD2)',
  endpoint: 'https://api.openbanking.example.com/psd2/v1',
  apiKeyRef: 'vault://payswap/open-banking/prod/api-key',
  secretRef: 'vault://payswap/open-banking/prod/hmac-secret',
  timeout: 5_000,
  retryCount: 3,
  retryBackoffMs: 200,
  rateLimitRps: 10,
  rateLimitBurst: 20,
  idempotencyTtlMs: 60_000,
};

export class OpenBankingConnector extends ProductionConnector {
  constructor(config?: Partial<ConnectorConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  // ─── Real auth header that would be sent on a real fetch ───────────────────
  /** Build the Authorization header value for a real upstream call. */
  protected authHeader(): string {
    return `Bearer ${this.apiKey || '<unresolved-token>'}`;
  }

  // ─── doQuery: simulated PSD2 response shapes ───────────────────────────────
  async doQuery(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    // In production:
    //   const res = await fetch(`${this.config.endpoint}/${path}`, {
    //     method, headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json', 'X-Idempotency-Key': request.id },
    //     body: method === 'POST' ? JSON.stringify(request.params) : undefined,
    //   });
    //   const body = await res.json();
    //   if (!res.ok) return { result: {}, error: fromHttpError(res.status, body) };
    //   return { result: body };
    //
    // Here we simulate faithful response shapes.

    switch (request.operation) {
      case 'getBalance':
        return this.simGetBalance(request);
      case 'initiateTransfer':
        return this.simInitiateTransfer(request);
      case 'verifyTransfer':
        return this.simVerifyTransfer(request);
      case 'getAccount':
        return this.simGetAccount(request);
      default:
        return {
          result: {},
          error: invalidResponse(`Unknown operation: ${request.operation}`),
        };
    }
  }

  private simGetBalance(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const accountId = request.params.accountId as string | undefined;
    const currency = (request.params.currency as string | undefined) ?? 'USD';
    if (!accountId) {
      return { result: {}, error: invalidResponse('accountId required') };
    }
    // PSD2 /accounts/{accountId}/balances response shape:
    //   { accountId, balances: [{ type, balanceAmount: { amount, currency }, referenceDate, lastChangeDateTime }] }
    const balance = (request.params.expectedBalance as number | undefined)
      ?? deterministicBalance(accountId, currency);
    return {
      result: {
        accountId,
        balances: [
          {
            type: 'available',
            balanceAmount: { amount: balance.toFixed(2), currency },
            referenceDate: new Date().toISOString().slice(0, 10),
            lastChangeDateTime: new Date().toISOString(),
          },
        ],
      },
    };
  }

  private simInitiateTransfer(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { fromAccount, toAccount, amount, currency, reference } = request.params as {
      fromAccount?: string; toAccount?: string; amount?: number; currency?: string; reference?: string;
    };
    if (!fromAccount || !toAccount || amount == null) {
      return { result: {}, error: invalidResponse('fromAccount, toAccount, amount required') };
    }
    // PSD2 /payments response: { transactionId, status: 'PENDING', amount: { amount, currency } }
    const transactionId = `OB-TX-${deterministicHash(`${fromAccount}${toAccount}${amount}${request.id}`).slice(0, 16)}`;
    return {
      result: {
        transactionId,
        status: 'PENDING',
        amount: { amount: amount.toFixed(2), currency: currency ?? 'USD' },
        reference: reference ?? `idem-${request.id.slice(0, 8)}`,
        submittedAt: new Date().toISOString(),
      },
    };
  }

  private simVerifyTransfer(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const transferId = request.params.transferId as string | undefined;
    if (!transferId) {
      return { result: {}, error: invalidResponse('transferId required') };
    }
    // PSD2 /payments/{transactionId} response:
    //   { transactionId, status, amount, valueDateTime, creditorName }
    // Simulated statuses: deterministic per transferId.
    const status = transferId.includes('FAIL')
      ? 'REJECTED'
      : transferId.includes('PEND')
      ? 'PENDING'
      : 'BOOKED';
    const amount = deterministicBalance(transferId, 'USD');
    return {
      result: {
        transactionId: transferId,
        status,
        amount: { amount: amount.toFixed(2), currency: 'USD' },
        valueDateTime: new Date().toISOString(),
        creditorName: 'PaySwap Merchant Settlement',
      },
    };
  }

  private simGetAccount(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const accountId = request.params.accountId as string | undefined;
    if (!accountId) {
      return { result: {}, error: invalidResponse('accountId required') };
    }
    // PSD2 /accounts/{accountId} response:
    //   { accountId, iban, bic, currency, status, name }
    const iban = `GB29 NWBK ${deterministicHash(accountId).slice(0, 12).toUpperCase()}`;
    return {
      result: {
        accountId,
        iban,
        bic: 'NWBKGB2L',
        currency: 'GBP',
        status: 'active',
        name: `Account ${accountId}`,
      },
    };
  }

  // ─── Evidence construction ─────────────────────────────────────────────────
  buildEvidence(request: ConnectorRequest, result: Record<string, unknown>): Evidence {
    const accountId =
      (request.params.accountId as string | undefined) ??
      (result.accountId as string | undefined) ??
      'unknown';
    const currency =
      (request.params.currency as string | undefined) ??
      ((result.amount as { currency?: string } | undefined)?.currency) ??
      'USD';

    // Extract attested amount based on operation.
    let attestedAmount: number | undefined;
    let attestedValue = '';
    if (request.operation === 'getBalance') {
      const balances = result.balances as Array<{ balanceAmount: { amount: string } }> | undefined;
      if (balances && balances.length > 0) {
        attestedAmount = parseFloat(balances[0].balanceAmount.amount);
        attestedValue = `${attestedAmount} ${currency} available`;
      }
    } else if (request.operation === 'initiateTransfer' || request.operation === 'verifyTransfer') {
      const amt = result.amount as { amount?: string; currency?: string } | undefined;
      if (amt?.amount) {
        attestedAmount = parseFloat(amt.amount);
        attestedValue = `${attestedAmount} ${amt.currency ?? currency} transfer`;
      }
    } else if (request.operation === 'getAccount') {
      attestedValue = `account ${accountId} verified (IBAN ${result.iban})`;
    }

    return buildAttestationEvidence({
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId: `account:${accountId}`,
      attester: this.config.id,
      attestedAmount,
      currency,
      reputation: 0.9,
      jurisdiction: 'EU-PSD2',
      ttlMs: 60_000,
      payload: {
        connector: this.config.id,
        connectorType: this.config.type,
        operation: request.operation,
        attestedValue,
        accountId,
        iban: result.iban,
        bic: result.bic,
      },
    });
  }

  // ─── Health probe ──────────────────────────────────────────────────────────
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    // In production: GET /health
    const start = Date.now();
    return { healthy: true, latencyMs: Math.floor(Math.random() * 80) + 40 };
  }
}

// ─── Deterministic simulation helpers ────────────────────────────────────────

/** Deterministic pseudo-balance for a given account/currency pair. */
function deterministicBalance(accountId: string, currency: string): number {
  const h = deterministicHash(`${accountId}|${currency}`);
  // Map the hash to a balance in [1000, 500000].
  const n = parseInt(h.slice(0, 8), 16);
  return 1000 + (n % 499000);
}

/** Simple FNV-1a hash → hex string. Deterministic across calls. */
export function deterministicHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Static type identifier (used by registry wiring). */
export const OPEN_BANKING_CONNECTOR_ID: ConnectorId = 'open_banking';
export const OPEN_BANKING_CONNECTOR_TYPE: ConnectorType = 'bank';
