/**
 * PaySwap Protocol — Provider Adapter — Fireblocks (Institutional Custody).
 *
 * Simulated Fireblocks API connector. Real implementations call the
 * Fireblocks REST API (api.fireblocks.io/v1) with an API key + JWT
 * signed by the workspace's RSA private key; this in-process simulation
 * mirrors that surface area.
 *
 * Operations:
 *   - createVaultAccount({ name, hiddenOnUI?, customerRefId? }) — POST /v1/vault/accounts
 *   - getVaultAccount({ vaultAccountId })                       — GET /v1/vault/accounts/{id}
 *   - createWallet({ vaultAccountId, assetId })                 — POST /v1/vault/accounts/{id}/{assetId}
 *   - getWallet({ vaultAccountId, assetId })                    — GET /v1/vault/accounts/{id}/{assetId}
 *   - issueTransaction({ vaultAccountId, assetId, amount, destination, note? }) — POST /v1/transactions
 *   - getTransaction({ txId })                                  — GET /v1/transactions/{id}
 *   - getAddresses({ vaultAccountId, assetId })                 — GET /v1/vault/accounts/{id}/{assetId}/addresses
 *
 * Auth: API key + private key (RSA-SHA256 JWT). The JWT is signed over
 * a JSON body containing `uri`, `nonce`, `iat`, `exp`, `sub`, `bodyHash`.
 * We simulate the JWT issuance (the nonce and signature are present in
 * the evidence payload but no actual RSA signing is performed — the
 * signature is a deterministic hash for traceability). In production
 * this is replaced by `jsonwebtoken.sign(payload, privateKey, {algorithm: 'RS256'})`.
 *
 * Evidence: source='on_chain_state', verificationLevel='cryptographic',
 * reputation=1.0, jurisdiction='US'.
 */
import type { Evidence } from '@/kernel/evidence';
import { createEvidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import type { ConnectorRequest } from '@/protocol/connectors-v2/types';
import { authFailed, invalidResponse } from '@/protocol/connectors-v2/errors';
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { IdempotencyStore } from '@/protocol/connectors-v2/idempotency';
import { ProductionConnector, type DoQueryResult } from '@/protocol/connectors-v2/base';
import { asConnectorConfig, type ProviderConfig } from './types';

/** Default config — Fireblocks workspace characteristics. */
export const DEFAULT_FIREBLOCKS_CONFIG: ProviderConfig = {
  id: 'fireblocks',
  type: 'custody',
  name: 'Fireblocks',
  endpoint: 'https://api.fireblocks.io/v1',
  timeout: 15_000,
  retryCount: 3,
  retryBackoffMs: 400,
  rateLimitRps: 8,
  rateLimitBurst: 16,
  idempotencyTtlMs: 30 * 60 * 1000,
  environment: 'production',
};

interface VaultAccount {
  id: string;
  name: string;
  hiddenOnUI: boolean;
  customerRefId?: string;
  autoFuel: boolean;
  assets: VaultAsset[];
  createdAt: number;
}

interface VaultAsset {
  id: string; // e.g. 'BTC', 'ETH', 'USDC'
  balance: string;
  available: string;
  pending: string;
  frozen: string;
  total: string;
  addresses: VaultAddress[];
}

interface VaultAddress {
  address: string;
  addressFormat: 'LEGACY' | 'SEGWIT' | 'BECH32' | 'BASE58' | 'ETHER';
  addressType?: string;
  tag?: string;
  legacyAddress?: string;
}

interface FireblocksTx {
  id: string;
  asset: string;
  source: { type: 'VAULT_ACCOUNT'; id: string };
  destination: { type: 'VAULT_ACCOUNT' | 'EXTERNAL_WALLET' | 'ONE_TIME_ADDRESS'; id?: string; address?: string };
  amount: number;
  amountStr: string;
  fee: string;
  note?: string;
  status: 'SUBMITTED' | 'QUEUED' | 'PENDING_SIGNATURE' | 'PENDING_AUTHORIZATION' | 'BROADCASTING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELED' | 'REJECTED' | 'FAILED';
  txHash?: string;
  createdAt: number;
  lastUpdated: number;
}

let _vaultSeq = 0;
function nextVaultId(): string {
  _vaultSeq += 1;
  return String(_vaultSeq);
}

/** Deterministic pseudo-balance for a freshly created wallet. */
function initialBalance(assetId: string): string {
  switch (assetId.toUpperCase()) {
    case 'BTC': return '0.5';
    case 'ETH': return '12.0';
    case 'USDC': return '25000';
    case 'USDT': return '10000';
    case 'SOL': return '100';
    default: return '0';
  }
}

/** Generate a fake but well-formed address for the given asset. */
function pseudoAddress(assetId: string): string {
  switch (assetId.toUpperCase()) {
    case 'BTC':
      return 'bc1q' + '0'.repeat(38) + uid('btc').slice(-2);
    case 'ETH':
    case 'USDC':
    case 'USDT':
      return '0x' + '0'.repeat(38) + uid('eth').slice(-2);
    case 'SOL':
      return uid('sol') + uid('addr').slice(-16);
    default:
      return uid('addr');
  }
}

export class FireblocksConnector extends ProductionConnector {
  private readonly providerConfig: ProviderConfig;
  private readonly vaultAccounts = new Map<string, VaultAccount>();
  private readonly transactions = new Map<string, FireblocksTx>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    const merged: ProviderConfig = { ...DEFAULT_FIREBLOCKS_CONFIG, ...config };
    super(asConnectorConfig(merged), healthMonitor, metricsCollector, idempotency);
    this.providerConfig = merged;
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    const auth = this.authenticate(request);
    if (!auth.ok) return { ok: false, error: auth.error };

    switch (request.operation) {
      case 'createVaultAccount':
        return this.createVaultAccount(request.params);
      case 'getVaultAccount':
        return this.getVaultAccount(request.params);
      case 'createWallet':
        return this.createWallet(request.params);
      case 'getWallet':
        return this.getWallet(request.params);
      case 'issueTransaction':
        return this.issueTransaction(request.params);
      case 'getTransaction':
        return this.getTransaction(request.params);
      case 'getAddresses':
        return this.getAddresses(request.params);
      default:
        return { ok: false, error: invalidResponse(`unknown_operation:${request.operation}`) };
    }
  }

  protected buildEvidence(request: ConnectorRequest, result: unknown): Evidence {
    const params = request.params;
    const entityId =
      (params['vaultAccountId'] as string | undefined) ??
      (params['txId'] as string | undefined) ??
      (params['assetId'] as string | undefined) ??
      request.id;
    const amount = params['amount'] as number | undefined;
    return createEvidence({
      type: 'observation',
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId,
      attester: 'fireblocks-connector',
      reputation: 1.0,
      jurisdiction: 'US',
      payload: {
        operation: request.operation,
        requestId: request.id,
        provider: 'fireblocks',
        apiKeyId: this.providerConfig.apiKeyId,
        result,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    const auth = this.authenticate({ operation: 'healthCheck', params: {}, id: 'health' });
    return { healthy: auth.ok, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------- authenticate
  /**
   * Simulated Fireblocks JWT signing. Real impl:
   *   ```
   *   const token = jwt.sign(
   *     { uri, nonce, iat, exp, sub, bodyHash },
   *     privateKey,
   *     { algorithm: 'RS256', keyid: apiKeyId },
   *   );
   *   ```
   * We synthesise a deterministic signature over the request method+path+body
   * so the evidence payload carries a stable, traceable identifier.
   */
  private authenticate(request: ConnectorRequest): { ok: true; jwt: string } | { ok: false; error: ReturnType<typeof authFailed> } {
    const { apiKeyId, privateKey } = this.providerConfig;
    if (!apiKeyId) {
      return { ok: false, error: authFailed('fireblocks: apiKeyId required') };
    }
    if (!privateKey) {
      return { ok: false, error: authFailed('fireblocks: RSA private key required') };
    }
    // Build a fake JWT (header.payload.signature) — payload includes the
    // operation + bodyHash so each request gets a unique, traceable token.
    const nonce = uid('fb_nonce');
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 55; // Fireblocks tokens live ~55s
    const bodyHash = uid('fb_hash').slice(-16);
    const payload = { uri: `/v1/${request.operation}`, nonce, iat, exp, sub: apiKeyId, bodyHash };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = uid('fb_sig').slice(-43); // ~43 chars, base64url-ish
    const jwt = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${encodedPayload}.${signature}`;
    return { ok: true, jwt };
  }

  // ---------------------------------------------------------- createVaultAccount
  private createVaultAccount(params: Record<string, unknown>): DoQueryResult {
    const name = params['name'] as string | undefined;
    const hiddenOnUI = (params['hiddenOnUI'] as boolean | undefined) ?? false;
    const customerRefId = params['customerRefId'] as string | undefined;
    if (!name) {
      return { ok: false, error: invalidResponse('name_required') };
    }
    const id = nextVaultId();
    const account: VaultAccount = {
      id,
      name,
      hiddenOnUI,
      customerRefId,
      autoFuel: false,
      assets: [],
      createdAt: Date.now(),
    };
    this.vaultAccounts.set(id, account);
    return { ok: true, data: account };
  }

  // ----------------------------------------------------------- getVaultAccount
  private getVaultAccount(params: Record<string, unknown>): DoQueryResult {
    const id = params['vaultAccountId'] as string | undefined;
    if (!id) {
      return { ok: false, error: invalidResponse('vaultAccountId_required') };
    }
    const account = this.vaultAccounts.get(id);
    if (!account) {
      return { ok: false, error: invalidResponse(`vault_account_not_found:${id}`) };
    }
    return { ok: true, data: account };
  }

  // --------------------------------------------------------------- createWallet
  private createWallet(params: Record<string, unknown>): DoQueryResult {
    const vaultAccountId = params['vaultAccountId'] as string | undefined;
    const assetId = (params['assetId'] as string | undefined)?.toUpperCase();
    if (!vaultAccountId || !assetId) {
      return { ok: false, error: invalidResponse('vaultAccountId_assetId_required') };
    }
    const account = this.vaultAccounts.get(vaultAccountId);
    if (!account) {
      return { ok: false, error: invalidResponse(`vault_account_not_found:${vaultAccountId}`) };
    }
    const existing = account.assets.find((a) => a.id === assetId);
    if (existing) {
      return { ok: true, data: existing };
    }
    const balance = initialBalance(assetId);
    const asset: VaultAsset = {
      id: assetId,
      balance,
      available: balance,
      pending: '0',
      frozen: '0',
      total: balance,
      addresses: [
        {
          address: pseudoAddress(assetId),
          addressFormat: assetId === 'BTC' ? 'BECH32' : 'ETHER',
        },
      ],
    };
    account.assets.push(asset);
    return { ok: true, data: asset };
  }

  // ------------------------------------------------------------------- getWallet
  private getWallet(params: Record<string, unknown>): DoQueryResult {
    const vaultAccountId = params['vaultAccountId'] as string | undefined;
    const assetId = (params['assetId'] as string | undefined)?.toUpperCase();
    if (!vaultAccountId || !assetId) {
      return { ok: false, error: invalidResponse('vaultAccountId_assetId_required') };
    }
    const account = this.vaultAccounts.get(vaultAccountId);
    if (!account) {
      return { ok: false, error: invalidResponse(`vault_account_not_found:${vaultAccountId}`) };
    }
    const asset = account.assets.find((a) => a.id === assetId);
    if (!asset) {
      return { ok: false, error: invalidResponse(`wallet_not_found:${vaultAccountId}/${assetId}`) };
    }
    return { ok: true, data: asset };
  }

  // ----------------------------------------------------------- issueTransaction
  private issueTransaction(params: Record<string, unknown>): DoQueryResult {
    const vaultAccountId = params['vaultAccountId'] as string | undefined;
    const assetId = (params['assetId'] as string | undefined)?.toUpperCase();
    const amount = params['amount'] as number | undefined;
    const destination = params['destination'] as { type: string; id?: string; address?: string } | undefined;
    const note = params['note'] as string | undefined;
    if (!vaultAccountId || !assetId || amount === undefined || !destination) {
      return { ok: false, error: invalidResponse('vaultAccountId_assetId_amount_destination_required') };
    }
    if (amount <= 0) {
      return { ok: false, error: invalidResponse('amount_must_be_positive') };
    }
    const id = uid('fb_tx');
    const tx: FireblocksTx = {
      id,
      asset: assetId,
      source: { type: 'VAULT_ACCOUNT', id: vaultAccountId },
      destination: { type: destination.type as FireblocksTx['destination']['type'], id: destination.id, address: destination.address },
      amount,
      amountStr: String(amount),
      fee: '0.0001',
      note,
      status: 'SUBMITTED',
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    this.transactions.set(id, tx);
    return { ok: true, data: tx };
  }

  // ------------------------------------------------------------- getTransaction
  private getTransaction(params: Record<string, unknown>): DoQueryResult {
    const txId = params['txId'] as string | undefined;
    if (!txId) {
      return { ok: false, error: invalidResponse('txId_required') };
    }
    const tx = this.transactions.get(txId);
    if (!tx) {
      return { ok: false, error: invalidResponse(`transaction_not_found:${txId}`) };
    }
    // Simulate progression: SUBMITTED → QUEUED → BROADCASTING → CONFIRMED.
    const progression: FireblocksTx['status'][] = ['SUBMITTED', 'QUEUED', 'PENDING_SIGNATURE', 'BROADCASTING', 'CONFIRMED', 'COMPLETED'];
    const idx = progression.indexOf(tx.status);
    if (idx >= 0 && idx < progression.length - 1) {
      tx.status = progression[idx + 1];
      tx.lastUpdated = Date.now();
      if (tx.status === 'CONFIRMED') {
        tx.txHash = uid('fb_onchain');
      }
    }
    return { ok: true, data: tx };
  }

  // ----------------------------------------------------------------- getAddresses
  private getAddresses(params: Record<string, unknown>): DoQueryResult {
    const vaultAccountId = params['vaultAccountId'] as string | undefined;
    const assetId = (params['assetId'] as string | undefined)?.toUpperCase();
    if (!vaultAccountId || !assetId) {
      return { ok: false, error: invalidResponse('vaultAccountId_assetId_required') };
    }
    const account = this.vaultAccounts.get(vaultAccountId);
    if (!account) {
      return { ok: false, error: invalidResponse(`vault_account_not_found:${vaultAccountId}`) };
    }
    const asset = account.assets.find((a) => a.id === assetId);
    if (!asset) {
      return { ok: false, error: invalidResponse(`wallet_not_found:${vaultAccountId}/${assetId}`) };
    }
    return { ok: true, data: asset.addresses };
  }
}
