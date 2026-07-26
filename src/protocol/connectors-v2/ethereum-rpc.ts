/**
 * PaySwap Protocol — Production Connectors v2 — Ethereum JSON-RPC.
 *
 * Simulated Ethereum JSON-RPC connector. Real implementations call a
 * node's RPC (e.g. Infura, Alchemy, or a self-hosted geth/reth); this
 * in-process simulation mirrors that surface area.
 *
 * Operations:
 *   - getBalance({ address })              — eth_getBalance
 *   - getTransactionReceipt({ txHash })    — eth_getTransactionReceipt
 *   - sendRawTransaction({ rawTx })        — eth_sendRawTransaction
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

/** Default config — public RPC characteristics. */
export const DEFAULT_ETHEREUM_RPC_CONFIG: ConnectorConfig = {
  id: 'ethereum_rpc',
  type: 'ethereum_rpc',
  name: 'Ethereum JSON-RPC',
  endpoint: 'sim://ethereum/rpc/v1',
  timeout: 12_000,
  retryCount: 3,
  retryBackoffMs: 300,
  rateLimitRps: 15,
  rateLimitBurst: 30,
  idempotencyTtlMs: 60_000,
};

interface EthTxRecord {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  status: 'success' | 'failed';
  blockNumber: number;
  blockHash: string;
  confirmations: number;
  createdAt: number;
}

interface EthAccountRecord {
  address: string;
  balanceWei: string;
  nonce: number;
}

/** Deterministic pseudo-balance in wei for a previously-uncached address. */
function pseudoBalanceWei(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) | 0;
  // 0..10 ETH, expressed in wei (1 ETH = 1e18 wei).
  const eth = Math.abs(h % 10_000) / 1_000;
  const wei = Math.floor(eth * 1e18);
  return `0x${wei.toString(16)}`;
}

function hexToInt(hex: string): number {
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    return parseInt(hex.slice(2), 16);
  }
  return parseInt(hex, 16);
}

export class EthereumRpcConnector extends ProductionConnector {
  private accounts = new Map<string, EthAccountRecord>();
  private transactions = new Map<string, EthTxRecord>();

  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<ConnectorConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(
      { ...DEFAULT_ETHEREUM_RPC_CONFIG, ...config },
      healthMonitor,
      metricsCollector,
      idempotency,
    );
  }

  protected async doQuery(request: ConnectorRequest): Promise<DoQueryResult> {
    switch (request.operation) {
      case 'getBalance':
        return this.getBalance(request.params);
      case 'getTransactionReceipt':
        return this.getTransactionReceipt(request.params);
      case 'sendRawTransaction':
        return this.sendRawTransaction(request.params);
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
      attester: 'ethereum-rpc-connector-v2',
      reputation: 1.0,
      payload: { operation: request.operation, requestId: request.id, result },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Date.now() - start };
  }

  // ----------------------------------------------------------------- getBalance
  private getBalance(params: Record<string, unknown>): DoQueryResult {
    const address = params['address'] as string | undefined;
    if (!address) {
      return { ok: false, error: invalidResponse('address_required') };
    }
    let account = this.accounts.get(address);
    if (!account) {
      account = {
        address,
        balanceWei: pseudoBalanceWei(address),
        nonce: 0,
      };
      this.accounts.set(address, account);
    }
    return {
      ok: true,
      data: {
        address: account.address,
        balanceWei: account.balanceWei,
        balanceEth: hexToInt(account.balanceWei) / 1e18,
        nonce: account.nonce,
        blockTag: 'latest',
      },
    };
  }

  // ----------------------------------------------------- getTransactionReceipt
  private getTransactionReceipt(params: Record<string, unknown>): DoQueryResult {
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

  // ------------------------------------------------------- sendRawTransaction
  private sendRawTransaction(params: Record<string, unknown>): DoQueryResult {
    const rawTx = params['rawTx'] as string | undefined;
    if (!rawTx) {
      return { ok: false, error: invalidResponse('rawTx_required') };
    }
    const hash = uid('ethtx');
    const blockNumber = Math.floor(Math.random() * 1_000_000) + 1;
    const tx: EthTxRecord = {
      hash,
      from: '0x' + '0'.repeat(40),
      to: '0x' + '0'.repeat(40),
      value: '0x0',
      gasUsed: '0x5208', // 21000 — standard ETH transfer
      status: 'success',
      blockNumber,
      blockHash: '0x' + '0'.repeat(64),
      confirmations: 1,
      createdAt: Date.now(),
    };
    this.transactions.set(hash, tx);
    return {
      ok: true,
      data: { hash, status: tx.status, blockNumber: tx.blockNumber },
    };
  }
}
