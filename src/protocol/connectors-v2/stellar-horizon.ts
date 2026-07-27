/**
 * PaySwap Protocol — Production Connectors v2 — Stellar Horizon.
 *
 * Simulated Stellar Horizon API connector. Real implementations call
 * Horizon's REST endpoints (accounts, transactions, submit); this
 * in-process simulation mirrors that surface area.
 *
 * Operations:
 *   - getAccount({ address })        — fetch account balances
 *   - getTransaction({ txHash })     — fetch transaction details
 *   - submitTransaction({ xdr })     — submit a signed envelope
 *
 * Evidence: source='on_chain_state', verificationLevel='cryptographic', reputation=1.0.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import type { ConnectorConfig, ConnectorRequest } from './types';
import { invalidResponse } from './errors';
import { HealthMonitor } from './health';
import { MetricsCollector } from './metrics';
import { IdempotencyStore } from './idempotency';
import { ProductionConnector, type DoQueryResult } from './base';

/** Default config — Horizon public-node characteristics. */
export const DEFAULT_STELLAR_HORIZON_CONFIG: ConnectorConfig = {
  id: 'stellar_horizon',
  type: 'stellar_horizon',
  name: 'Stellar Horizon',
  endpoint: 'sim://stellar/horizon/v1',
  timeout: 10_000,
  retryCount: 3,
  retryBackoffMs: 300,
  rateLimitRps: 20,
  rateLimitBurst: 40,
  idempotencyTtlMs: 60_000,
};

interface StellarAccountRecord {
  address: string;
  balances: Array<{ asset: string; balance: number; issuer?: string }>;
  sequence: number;
  subentryCount: number;
  createdAt: number;
}

interface StellarTxRecord {
  hash: string;
  sourceAccount: string;
  successful: boolean;
  ledger: number;
  feePaid: number;
  operationCount: number;
  createdAt: number;
  envelopeXdr: string;
  resultXdr: string;
}

/** Deterministic pseudo-balance for a previously unfunded account. */
function pseudoNativeBalance(address: string): number {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) | 0;
  return Math.abs(h % 1_000_000) / 1_000_000; // 0..1 XLM (above the 1 XLM reserve)
}

export class StellarHorizonConnector extends ProductionConnector {
  private accounts = new Map<string, StellarAccountRecord>();
  private transactions = new Map<string, StellarTxRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ConnectorConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(
      { ...DEFAULT_STELLAR_HORIZON_CONFIG, ...config },
      healthMonitor,
      metricsCollector,
      idempotency,
    );
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    switch (request.operation) {
      case 'getAccount':
        return this.getAccount(request.params);
      case 'getTransaction':
        return this.getTransaction(request.params);
      case 'submitTransaction':
        return this.submitTransaction(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['address'] as string | undefined) ??
      (params['txHash'] as string | undefined) ??
      request.id;
    return createEvidence({
      type: 'observation',
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId,
      attester: 'stellar-horizon-connector-v2',
      reputation: 1.0,
      payload: { operation: request.operation, requestId: request.id, result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------------- getAccount
  private getAccount(params: Record<string, unknown>): DoQueryResult {
    const address = params['address'] as string | undefined;
    if (!address) {
      return { ok: false, error: invalidResponse('address_required') };
    }
    let account = this.accounts.get(address);
    if (!account) {
      // Lazily create a stub account so callers can fetch any address.
      account = {
        address,
        balances: [
          { asset: 'native', balance: pseudoNativeBalance(address) },
        ],
        sequence: 1,
        subentryCount: 0,
        createdAt: Date.now(),
      };
      this.accounts.set(address, account);
    }
    return { ok: true, data: account };
  }

  // -------------------------------------------------------------- getTransaction
  private getTransaction(params: Record<string, unknown>): DoQueryResult {
    const txHash = params['txHash'] as string | undefined;
    if (!txHash) {
      return { ok: false, error: invalidResponse('txHash_required') };
    }
    const tx = this.transactions.get(txHash);
    if (!tx) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${txHash}`) };
    }
    return { ok: true, data: tx };
  }

  // ----------------------------------------------------------- submitTransaction
  private submitTransaction(params: Record<string, unknown>): DoQueryResult {
    const xdr = params['xdr'] as string | undefined;
    if (!xdr) {
      return { ok: false, error: invalidResponse('xdr_required') };
    }
    const hash = uid('stellartx');
    const tx: StellarTxRecord = {
      hash,
      sourceAccount: 'simulated-source',
      successful: true,
      ledger: Math.floor(Math.random() * 1_000_000) + 1,
      feePaid: 100,
      operationCount: 1,
      createdAt: Date.now(),
      envelopeXdr: xdr,
      resultXdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=',
    };
    this.transactions.set(hash, tx);
    return {
      ok: true,
      data: {
        hash,
        successful: tx.successful,
        ledger: tx.ledger,
        feePaid: tx.feePaid,
        createdAt: tx.createdAt,
      },
    };
  }
}
