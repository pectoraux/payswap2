/**
 * PaySwap Protocol — Provider Adapter — Stellar Horizon.
 *
 * Simulated Stellar Horizon API connector (HAL+json). Real
 * implementations call Horizon's REST endpoints
 * (horizon.stellar.org/accounts/{id}, /transactions/{id}, /transactions
 * for submit, /ledgers/{id}, /accounts/{id}/effects); this in-process
 * simulation mirrors that surface area.
 *
 * Operations:
 *   - getAccount({ address })          — GET /accounts/{address}
 *   - getTransaction({ txHash })        — GET /transactions/{txHash}
 *   - submitTransaction({ xdr })        — POST /transactions
 *   - getLedger({ sequence })           — GET /ledgers/{sequence}
 *   - getEffects({ address?, txHash?, ledgerId?, cursor?, limit? }) — GET /accounts/{id}/effects | /transactions/{id}/effects | /ledgers/{id}/effects | /effects
 *
 * Auth: none (public Horizon). Some deployments sit behind an API-key
 * gateway (e.g. Publicnode) — we surface the configured `apiKey` in the
 * evidence payload for traceability.
 *
 * Evidence: source='on_chain_state', verificationLevel='cryptographic',
 * reputation=1.0, jurisdiction='global'.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import type { ConnectorRequest } from '@/protocol/connectors-v2/types';
import { invalidResponse } from '@/protocol/connectors-v2/errors';
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { IdempotencyStore } from '@/protocol/connectors-v2/idempotency';
import { ProductionConnector, type DoQueryResult } from '@/protocol/connectors-v2/base';
import { asConnectorConfig, type ProviderConfig } from './types';

/** Default config — Horizon public-node characteristics. */
export const DEFAULT_STELLAR_HORIZON_CONFIG: ProviderConfig = {
  id: 'stellar_horizon',
  type: 'blockchain_rpc',
  name: 'Stellar Horizon',
  endpoint: 'https://horizon.stellar.org',
  timeout: 10_000,
  retryCount: 3,
  retryBackoffMs: 300,
  rateLimitRps: 20,
  rateLimitBurst: 40,
  idempotencyTtlMs: 60_000,
  environment: 'production',
};

interface HorizonAccount {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  inflation_destination?: string;
  home_domain?: string;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  flags: { auth_required: boolean; auth_revocable: boolean; auth_immutable: boolean; auth_clawback_enabled: boolean };
  balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string; limit?: string; buying_liabilities?: string; selling_liabilities?: string; liquidity_shares?: string }>;
  signers: Array<{ public_key: string; weight: number; key: string; type: string }>;
  data: Record<string, string>;
  paging_token: string;
  _links: Record<string, { href: string }>;
}

interface HorizonTx {
  id: string;
  paging_token: string;
  successful: boolean;
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  source_account_sequence: string;
  fee_account: string;
  fee_charged: string;
  max_fee: string;
  operation_count: number;
  envelope_xdr: string;
  result_xdr: string;
  result_meta_xdr: string;
  fee_meta_xdr: string;
  memo_type: string;
  memo?: string;
  signatures: string[];
  _links: Record<string, { href: string }>;
}

interface HorizonLedger {
  id: string;
  paging_token: string;
  hash: string;
  prev_hash: string;
  sequence: number;
  successful_transaction_count: number;
  failed_transaction_count: number;
  operation_count: number;
  tx_set_operation_count: number;
  closed_at: string;
  total_coins: string;
  fee_pool: string;
  base_fee_in_stroops: string;
  base_reserve_in_stroops: string;
  max_tx_set_size: number;
  protocol_version: number;
  header_xdr: string;
  _links: Record<string, { href: string }>;
}

interface HorizonEffect {
  id: string;
  paging_token: string;
  account: string;
  type: string;
  type_i: number;
  created_at: string;
  // Type-specific fields (flattened for simplicity).
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

interface StellarAccountRecord {
  account: HorizonAccount;
}

interface StellarTxRecord {
  tx: HorizonTx;
}

function pseudoNativeBalance(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) | 0;
  // 1..1000 XLM (above the 1 XLM base reserve) — 7 decimals.
  return ((Math.abs(h) % 999_999) / 1_000 + 1).toFixed(7);
}

function isoNow(): string {
  return new Date().toISOString();
}

function halLinks(self: string): Record<string, { href: string }> {
  return { self: { href: self } };
}

export class StellarHorizonConnector extends ProductionConnector {
  private readonly accounts = new Map<string, StellarAccountRecord>();
  private readonly transactions = new Map<string, StellarTxRecord>();
  private readonly ledgers = new Map<number, HorizonLedger>();
  private readonly effects: HorizonEffect[] = [];

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_STELLAR_HORIZON_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    switch (request.operation) {
      case 'getAccount':
        return this.getAccount(request.params);
      case 'getTransaction':
        return this.getTransaction(request.params);
      case 'submitTransaction':
        return this.submitTransaction(request.params);
      case 'getLedger':
        return this.getLedger(request.params);
      case 'getEffects':
        return this.getEffects(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['address'] as string | undefined) ??
      (params['txHash'] as string | undefined) ??
      (params['ledgerId'] as string | undefined) ??
      (params['sequence'] as number | undefined)?.toString() ??
      request.id;
    return createEvidence({
      type: 'observation',
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId,
      attester: 'stellar-horizon-connector',
      reputation: 1.0,
      jurisdiction: 'global',
      payload: {
        operation: request.operation,
        requestId: request.id,
        provider: 'stellar_horizon',
        endpoint: this.config.endpoint,
        result,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    // Real impl: GET / and check 200 + content-type=application/hal+json.
    return { healthy: true, latencyMs: Date.now() - start };
  }

  // ------------------------------------------------------------------- getAccount
  private getAccount(params: Record<string, unknown>): DoQueryResult {
    const address = params['address'] as string | undefined;
    if (!address) {
      return { ok: false, error: invalidResponse('address_required') };
    }
    let record = this.accounts.get(address);
    if (!record) {
      const account: HorizonAccount = {
        id: address,
        account_id: address,
        sequence: String(1 + (Math.abs(address.charCodeAt(address.length - 1)) % 1_000_000)),
        subentry_count: 0,
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
        balances: [
          { asset_type: 'native', balance: pseudoNativeBalance(address), buying_liabilities: '0', selling_liabilities: '0' },
        ],
        signers: [{ public_key: address, weight: 1, key: address, type: 'ed25519_public_key' }],
        data: {},
        paging_token: address,
        _links: halLinks(`/accounts/${address}`),
      };
      record = { account };
      this.accounts.set(address, record);
    }
    return { ok: true, data: record.account };
  }

  // ---------------------------------------------------------------- getTransaction
  private getTransaction(params: Record<string, unknown>): DoQueryResult {
    const txHash = params['txHash'] as string | undefined;
    if (!txHash) {
      return { ok: false, error: invalidResponse('txHash_required') };
    }
    const record = this.transactions.get(txHash);
    if (!record) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${txHash}`) };
    }
    return { ok: true, data: record.tx };
  }

  // ------------------------------------------------------------- submitTransaction
  private submitTransaction(params: Record<string, unknown>): DoQueryResult {
    const xdr = params['xdr'] as string | undefined;
    if (!xdr) {
      return { ok: false, error: invalidResponse('xdr_required') };
    }
    const hash = uid('stellar_tx');
    const ledger = Math.floor(Math.random() * 50_000_000) + 1;
    const tx: HorizonTx = {
      id: hash,
      paging_token: hash,
      successful: true,
      hash,
      ledger,
      created_at: isoNow(),
      source_account: 'G' + 'A'.repeat(55),
      source_account_sequence: String(Math.floor(Math.random() * 1_000_000_000)),
      fee_account: 'G' + 'B'.repeat(55),
      fee_charged: '100',
      max_fee: '100',
      operation_count: 1,
      envelope_xdr: xdr,
      result_xdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=',
      result_meta_xdr: 'AAAAAAAAAAEAAAACAAAAAAAAAAA=',
      fee_meta_xdr: 'AAAAAA==',
      memo_type: 'none',
      signatures: [uid('sig').slice(-56)],
      _links: halLinks(`/transactions/${hash}`),
    };
    this.transactions.set(hash, { tx });
    return {
      ok: true,
      data: {
        ...tx,
        // Horizon returns 200 + a "hal" transaction object on success; we mirror that.
        _links: {
          ...halLinks(`/transactions/${hash}`),
          transaction: { href: `/transactions/${hash}` },
        },
      },
    };
  }

  // --------------------------------------------------------------------- getLedger
  private getLedger(params: Record<string, unknown>): DoQueryResult {
    const sequence = params['sequence'] as number | undefined;
    if (sequence === undefined) {
      return { ok: false, error: invalidResponse('sequence_required') };
    }
    let ledger = this.ledgers.get(sequence);
    if (!ledger) {
      ledger = {
        id: String(sequence),
        paging_token: String(sequence),
        hash: uid('ledger_hash').slice(-64),
        prev_hash: uid('prev_hash').slice(-64),
        sequence,
        successful_transaction_count: Math.floor(Math.random() * 50),
        failed_transaction_count: Math.floor(Math.random() * 5),
        operation_count: Math.floor(Math.random() * 100),
        tx_set_operation_count: Math.floor(Math.random() * 100),
        closed_at: isoNow(),
        total_coins: '105000000000.0000000',
        fee_pool: '123456.7890123',
        base_fee_in_stroops: '100',
        base_reserve_in_stroops: '5000000',
        max_tx_set_size: 1000,
        protocol_version: 20,
        header_xdr: uid('hdr').slice(-256),
        _links: halLinks(`/ledgers/${sequence}`),
      };
      this.ledgers.set(sequence, ledger);
    }
    return { ok: true, data: ledger };
  }

  // -------------------------------------------------------------------- getEffects
  private getEffects(params: Record<string, unknown>): DoQueryResult {
    const address = params['address'] as string | undefined;
    const txHash = params['txHash'] as string | undefined;
    const ledgerId = params['ledgerId'] as number | undefined;
    const cursor = params['cursor'] as string | undefined;
    const limit = (params['limit'] as number | undefined) ?? 10;
    // Filter effects by source.
    let filtered = this.effects.slice();
    if (address) filtered = filtered.filter((e) => e.account === address);
    if (txHash) filtered = filtered.filter((e) => e.id.startsWith(txHash));
    if (ledgerId !== undefined) filtered = filtered.filter((e) => Number(e.paging_token.split('-')[0]) === ledgerId);
    // Synthesize a couple of effects if none yet recorded for this address.
    if (filtered.length === 0 && address) {
      const now = isoNow();
      const seedEffects: HorizonEffect[] = [
        { id: `${Date.now()}-1`, paging_token: `${Date.now()}-1`, account: address, type: 'account_credited', type_i: 2, created_at: now, amount: '100.0000000', asset_type: 'native' },
        { id: `${Date.now()}-2`, paging_token: `${Date.now()}-2`, account: address, type: 'account_debited', type_i: 3, created_at: now, amount: '25.0000000', asset_type: 'native' },
      ];
      this.effects.push(...seedEffects);
      filtered = seedEffects;
    }
    // Apply cursor (paging_token > cursor).
    if (cursor) {
      const idx = filtered.findIndex((e) => e.paging_token === cursor);
      if (idx >= 0) filtered = filtered.slice(idx + 1);
    }
    return {
      ok: true,
      data: {
        _links: halLinks('/effects'),
        _embedded: { records: filtered.slice(0, limit) },
      },
    };
  }
}
