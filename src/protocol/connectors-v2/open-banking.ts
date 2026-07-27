/**
 * PaySwap Protocol — Production Connectors v2 — Open Banking (PSD2).
 *
 * Simulated PSD2 / Open Banking connector. Real implementations call
 * bank APIs (e.g. TrueLayer, Plaid, Tink) under the Strong Customer
 * Authentication umbrella; this in-process simulation mirrors that
 * surface area so the protocol layer can run end-to-end.
 *
 * Operations:
 *   - getBalance({ accountId, currency })
 *   - initiateTransfer({ fromAccount, toAccount, amount, currency, reference })
 *   - verifyTransfer({ transferId })
 *
 * Evidence: source='open_banking', verificationLevel='institutional', reputation=0.9.
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

/** Default config — overridden by the registry for non-default deployments. */
export const DEFAULT_OPEN_BANKING_CONFIG: ConnectorConfig = {
  id: 'open_banking',
  type: 'open_banking',
  name: 'Open Banking (PSD2)',
  endpoint: 'sim://open-banking/v1',
  timeout: 8_000,
  retryCount: 2,
  retryBackoffMs: 400,
  rateLimitRps: 10,
  rateLimitBurst: 20,
  idempotencyTtlMs: 5 * 60 * 1000,
};

interface TransferRecord {
  transferId: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  currency: string;
  reference?: string;
  status: 'pending' | 'settled' | 'failed';
  createdAt: number;
}

/** Deterministic pseudo-balance derived from the accountId so the same account is stable across calls. */
function pseudoBalance(accountId: string, currency: string): number {
  let h = 0;
  const key = `${accountId}:${currency}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const positive = Math.abs(h);
  // Range 1,000..1,000,000 in 100-unit steps.
  return round(1000 + (positive % 9999) * 100, 2);
}

export class OpenBankingConnector extends ProductionConnector {
  /** transferId -> record (in-process simulation of the bank's transfer ledger). */
  private transfers = new Map<string, TransferRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ConnectorConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(
      { ...DEFAULT_OPEN_BANKING_CONFIG, ...config },
      healthMonitor,
      metricsCollector,
      idempotency,
    );
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    switch (request.operation) {
      case 'getBalance':
        return this.getBalance(request.params);
      case 'initiateTransfer':
        return this.initiateTransfer(request.params);
      case 'verifyTransfer':
        return this.verifyTransfer(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['accountId'] as string | undefined) ??
      (params['fromAccount'] as string | undefined) ??
      (params['transferId'] as string | undefined) ??
      request.id;

    return createEvidence({
      type: 'fiat_proof',
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId,
      attester: 'open-banking-connector-v2',
      reputation: 0.9,
      jurisdiction: 'EU',
      payload: { operation: request.operation, requestId: request.id, result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    // Simulated — instant in-process. A real impl would ping the bank's /health endpoint.
    return { healthy: true, latencyMs: Date.now() - start };
  }

  // --------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const accountId = params['accountId'] as string | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    if (!accountId) {
      return { ok: false, error: invalidResponse('accountId_required') };
    }
    const balance = pseudoBalance(accountId, currency);
    return {
      ok: true,
      data: { accountId, currency, balance, available: balance, asOf: Date.now() },
    };
  }

  // ----------------------------------------------------------- initiateTransfer
  private initiateTransfer(params: Record<string, unknown>): DoQueryResult {
    const fromAccount = params['fromAccount'] as string | undefined;
    const toAccount = params['toAccount'] as string | undefined;
    const amount = params['amount'] as number | undefined;
    const currency = (params['currency'] as string | undefined) ?? 'USD';
    const reference = params['reference'] as string | undefined;
    if (!fromAccount || !toAccount || amount === undefined) {
      return { ok: false, error: invalidResponse('fromAccount_toAccount_amount_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const transferId = uid('obxfer');
    const record: TransferRecord = {
      transferId,
      fromAccount,
      toAccount,
      amount: round(amount, 2),
      currency,
      reference,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.transfers.set(transferId, record);
    return {
      ok: true,
      data: { transferId, status: record.status, amount: record.amount, currency },
    };
  }

  // ------------------------------------------------------------ verifyTransfer
  private verifyTransfer(params: Record<string, unknown>): DoQueryResult {
    const transferId = params['transferId'] as string | undefined;
    if (!transferId) {
      return { ok: false, error: invalidResponse('transferId_required') };
    }
    const record = this.transfers.get(transferId);
    if (!record) {
      return { ok: false, error: invalidResponse(`transfer_not_found:${transferId}`) };
    }
    // Simulated settlement: any transfer older than 0ms is "settled" in this stub.
    // A real connector would poll the bank's status endpoint.
    if (record.status === 'pending') {
      record.status = 'settled';
    }
    return {
      ok: true,
      data: {
        transferId: record.transferId,
        status: record.status,
        amount: record.amount,
        currency: record.currency,
        fromAccount: record.fromAccount,
        toAccount: record.toAccount,
        reference: record.reference,
        settledAt: record.status === 'settled' ? Date.now() : undefined,
      },
    };
  }

  /** Helper used by tests to inject a failed transfer. */
  _injectFailedTransfer(transferId: string): void {
    const r = this.transfers.get(transferId);
    if (r) r.status = 'failed';
  }
}
