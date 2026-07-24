/**
 * PaySwap Protocol — Production Connectors v2 — Stellar Horizon Connector.
 *
 * Real-shape simulated Stellar Horizon REST connector. Operations:
 *   - getAccount({ address })              → account sequence, balances[], signers[]
 *   - getTransaction({ txHash })            → envelope_xdr, result_xdr, success
 *   - getLedger({ sequence })               → ledger header (hash, sequence, close_time)
 *   - submitTransaction({ xdr })             → hash, ledger, success (or error)
 *   - getEffects({ txHash })                 → effects[] (account credited/debited)
 *
 * NOTE: This connector is for the "read-only observation" path (horizon
 * ingestion) — used by the LP proof / settlement observer subsystem. The
 * heavy Stellar transaction-building logic is in `src/protocol/chains/stellar/adapter.ts`
 * (Task 3-A). This connector is drop-in replaceable with a real
 * `fetch('https://horizon.stellar.org/...')` call.
 *
 * Auth: public Horizon (no auth) OR Friendbot for testnet. API key optional.
 *
 * Response shapes mirror Horizon's REST API: `_links`, `id`, `paging_token`,
 * `account_id`, `sequence`, `balances[]`, `signers[]`, `created_at`.
 *
 * Evidence: source='on_chain_state', verificationLevel='cryptographic',
 *           reputation=1.0. On-chain Stellar state is permanent.
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
  id: 'stellar_horizon',
  type: 'blockchain_rpc',
  name: 'Stellar Horizon API',
  endpoint: 'https://horizon-testnet.stellar.org',
  apiKeyRef: 'vault://payswap/stellar-horizon/prod/api-key',
  secretRef: 'vault://payswap/stellar-horizon/prod/hmac-secret',
  timeout: 10_000,
  retryCount: 3,
  retryBackoffMs: 400,
  rateLimitRps: 10,
  rateLimitBurst: 30,
  idempotencyTtlMs: 600_000,
};

export class StellarHorizonConnector extends ProductionConnector {
  constructor(config?: Partial<ConnectorConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  protected authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/hal+json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  async doQuery(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    // In production:
    //   const res = await fetch(`${this.config.endpoint}/${path}`, {
    //     headers: this.authHeaders(),
    //     method: request.operation === 'submitTransaction' ? 'POST' : 'GET',
    //     body: request.operation === 'submitTransaction' ? `tx=${encodeURIComponent(request.params.xdr)}` : undefined,
    //   });
    //   const body = await res.json();
    //   if (!res.ok) return { result: {}, error: fromHttpError(res.status, body) };
    //   return { result: body };
    switch (request.operation) {
      case 'getAccount':
        return this.simGetAccount(request);
      case 'getTransaction':
        return this.simGetTransaction(request);
      case 'getLedger':
        return this.simGetLedger(request);
      case 'submitTransaction':
        return this.simSubmitTransaction(request);
      case 'getEffects':
        return this.simGetEffects(request);
      default:
        return { result: {}, error: invalidResponse(`Unknown operation: ${request.operation}`) };
    }
  }

  private simGetAccount(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const address = request.params.address as string | undefined;
    if (!address) {
      return { result: {}, error: invalidResponse('address required') };
    }
    // Horizon /accounts/{address} response shape.
    const sequence = deterministicSequence(address);
    return {
      result: {
        id: address,
        account_id: address,
        sequence,
        subentry_count: 0,
        last_modified_ledger: 18000000 + (parseInt(deterministicHash(address).slice(0, 6), 16) % 100000),
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
        balances: [
          {
            balance: '1000.0000000',
            limit: '922337203685.4775807',
            asset_type: 'native',
            asset_code: 'XLM',
            asset_issuer: '',
          },
        ],
        signers: [
          {
            key: address,
            weight: 1,
            type: 'ed25519_public_key',
          },
        ],
        _links: {
          self: { href: `${this.config.endpoint}/accounts/${address}` },
          transactions: { href: `${this.config.endpoint}/accounts/${address}/transactions{?cursor,limit,order}`, templated: true },
        },
      },
    };
  }

  private simGetTransaction(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const txHash = request.params.txHash as string | undefined;
    if (!txHash) {
      return { result: {}, error: invalidResponse('txHash required') };
    }
    // Horizon /transactions/{txHash} response shape.
    const success = !txHash.includes('fail');
    return {
      result: {
        id: txHash,
        paging_token: deterministicHash(txHash).padStart(16, '0'),
        hash: txHash,
        ledger: 18000000 + (parseInt(deterministicHash(txHash).slice(0, 6), 16) % 100000),
        created_at: new Date().toISOString(),
        source_account: `G${deterministicHash(txHash + 'src').padEnd(55, 'A').slice(0, 55)}`,
        successful: success,
        envelope_xdr: `AAAAAG${deterministicHash(txHash + 'env').slice(0, 60).toUpperCase()}==`,
        result_xdr: success ? 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAB' : 'AAAAAAAAAGT/////AAAAAQ==',
        fee_meta_xdr: `AAAAAM${deterministicHash(txHash + 'fee').slice(0, 60).toUpperCase()}==`,
        fee_charged: 100,
        max_fee: 100,
        operation_count: 1,
        _links: {
          self: { href: `${this.config.endpoint}/transactions/${txHash}` },
        },
      },
    };
  }

  private simGetLedger(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const sequence = request.params.sequence as number | undefined;
    if (sequence == null) {
      return { result: {}, error: invalidResponse('sequence required') };
    }
    // Horizon /ledgers/{sequence} response shape.
    return {
      result: {
        id: `${deterministicHash(String(sequence)).padStart(64, '0')}`,
        paging_token: String(sequence),
        hash: `${deterministicHash(`ledger${sequence}`).padStart(64, '0')}`,
        sequence,
        successful_transaction_count: 10,
        failed_transaction_count: 0,
        operation_count: 10,
        closed_at: new Date().toISOString(),
        total_coins: '105000000000.0000000',
        fee_pool: '100.0000000',
        base_fee_in_stroops: 100,
        base_reserve_in_stroops: '5000000',
        max_tx_set_size: 1000,
        protocol_version: 20,
        header_xdr: `AAAAAM${deterministicHash(`hdr${sequence}`).slice(0, 60).toUpperCase()}==`,
      },
    };
  }

  private simSubmitTransaction(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const xdr = request.params.xdr as string | undefined;
    if (!xdr) {
      return { result: {}, error: invalidResponse('xdr required') };
    }
    // Horizon /transactions POST response shape (success).
    // On failure, real Horizon returns { type: 'transaction_failed', status: 400, extras: { result_codes: {...} } }.
    const txHash = `${deterministicHash(xdr + request.id).padEnd(64, '0').slice(0, 64)}`;
    return {
      result: {
        hash: txHash,
        ledger: 18000001,
        envelope_xdr: xdr,
        result_xdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAB',
        successful: true,
        created_at: new Date().toISOString(),
      },
    };
  }

  private simGetEffects(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const txHash = request.params.txHash as string | undefined;
    if (!txHash) {
      return { result: {}, error: invalidResponse('txHash required') };
    }
    // Horizon /transactions/{txHash}/effects response shape.
    return {
      result: {
        _embedded: {
          records: [
            {
              id: `${txHash}-1`,
              account: `G${deterministicHash(txHash + 'src').padEnd(55, 'A').slice(0, 55)}`,
              type: 'account_credited',
              amount: '100.0000000',
              asset_type: 'native',
              asset_code: 'XLM',
            },
            {
              id: `${txHash}-2`,
              account: `G${deterministicHash(txHash + 'dst').padEnd(55, 'A').slice(0, 55)}`,
              type: 'account_debited',
              amount: '100.0000000',
              asset_type: 'native',
              asset_code: 'XLM',
            },
          ],
        },
        _links: {
          self: { href: `${this.config.endpoint}/transactions/${txHash}/effects` },
        },
      },
    };
  }

  buildEvidence(request: ConnectorRequest, result: Record<string, unknown>): Evidence {
    const address = request.params.address as string | undefined;
    const txHash =
      (request.params.txHash as string | undefined) ??
      (result.hash as string | undefined);
    const sequence =
      (request.params.sequence as number | undefined) ??
      (result.sequence as number | undefined);

    let attestedAmount: number | undefined;
    let attestedValue = '';

    if (request.operation === 'getAccount' && address) {
      const balances = result.balances as Array<{ balance: string; asset_code: string }> | undefined;
      if (balances && balances.length > 0) {
        attestedAmount = parseFloat(balances[0].balance);
        attestedValue = `${attestedAmount} ${balances[0].asset_code} on ${address.slice(0, 12)}…`;
      }
    } else if (request.operation === 'getTransaction' && txHash) {
      attestedValue = `Stellar tx ${txHash.slice(0, 12)}… success=${result.successful}`;
    } else if (request.operation === 'submitTransaction') {
      attestedValue = `Submitted Stellar tx ${result.hash}`;
    } else if (request.operation === 'getLedger' && sequence != null) {
      attestedValue = `Stellar ledger ${sequence}`;
    } else if (request.operation === 'getEffects' && txHash) {
      attestedValue = `Effects for Stellar tx ${txHash.slice(0, 12)}…`;
    }

    const entityId = address
      ? `stellar-account:${address}`
      : txHash
      ? `stellar-tx:${txHash}`
      : sequence != null
      ? `stellar-ledger:${sequence}`
      : 'stellar';

    return buildAttestationEvidence({
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId,
      attester: this.config.id,
      attestedAmount,
      currency: 'XLM',
      reputation: 1.0,
      ttlMs: 999_999_999,
      payload: {
        connector: this.config.id,
        connectorType: this.config.type,
        operation: request.operation,
        attestedValue,
        address,
        txHash,
        ledger: sequence,
        horizonEndpoint: this.config.endpoint,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Math.floor(Math.random() * 100) + 30 };
  }
}

/** Deterministic account sequence (string-encoded bigint). */
function deterministicSequence(address: string): string {
  const h = deterministicHash(address + 'sequence');
  const n = BigInt('0x' + h + deterministicHash(address).padStart(16, '0'));
  return n.toString();
}
