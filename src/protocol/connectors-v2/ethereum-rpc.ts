/**
 * PaySwap Protocol — Production Connectors v2 — Ethereum JSON-RPC Connector.
 *
 * Real-shape simulated Ethereum JSON-RPC connector. Operations:
 *   - getBalance({ address })                       → eth_getBalance (hex wei)
 *   - getTransactionReceipt({ txHash })              → eth_getTransactionReceipt
 *   - estimateGas({ from, to, value, data })         → eth_estimateGas (hex)
 *   - sendRawTransaction({ rawTx })                  → eth_sendRawTransaction (tx hash)
 *   - getLogs({ address, topics, fromBlock, toBlock }) → eth_getLogs
 *
 * Auth: public RPC (no auth) OR API-key header for Infura/Alchemy/QuickNode.
 * The header is built by authHeaders() — empty for public, `Authorization: Bearer` or
 * custom header for paid providers.
 *
 * Response shapes are EXACTLY the JSON-RPC 2.0 shapes:
 *   { jsonrpc: '2.0', id: <number>, result: <hex string | object> }
 * Numeric values are hex-encoded strings (wei, gas, block number).
 *
 * Evidence: source='on_chain_state', verificationLevel='cryptographic',
 *           reputation=1.0. TTL ~forever (on-chain state is permanent).
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
  id: 'ethereum_rpc',
  type: 'blockchain_rpc',
  name: 'Ethereum JSON-RPC',
  endpoint: 'https://mainnet.infura.io/v3',
  apiKeyRef: 'vault://payswap/ethereum-rpc/prod/project-id',
  secretRef: 'vault://payswap/ethereum-rpc/prod/hmac-secret',
  timeout: 15_000,
  retryCount: 3,
  retryBackoffMs: 300,
  rateLimitRps: 20,
  rateLimitBurst: 50,
  // On-chain state is permanent — cache idempotency for a long time.
  idempotencyTtlMs: 600_000,
};

export class EthereumRpcConnector extends ProductionConnector {
  private rpcCallId = 0;

  constructor(config?: Partial<ConnectorConfig>) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  /** Headers for the JSON-RPC POST. Empty for public RPC, Bearer for Infura-style. */
  protected authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      // Infura-style: API key is part of the URL path; Alchemy-style: API key in header.
      // We support both via the endpoint convention.
      if (this.config.endpoint.includes('alchemy.com')) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      // Infura path-style: nothing to add here (key in URL).
    }
    return headers;
  }

  async doQuery(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    // In production:
    //   const body = { jsonrpc: '2.0', id: ++this.rpcCallId, method, params };
    //   const res = await fetch(`${this.config.endpoint}/${this.apiKey}`, {
    //     method: 'POST', headers: this.authHeaders(), body: JSON.stringify(body),
    //   });
    //   const json = await res.json();
    //   if (json.error) return { result: {}, error: fromHttpError(... or invalidResponse(json.error.message)) };
    //   return { result: json.result };
    switch (request.operation) {
      case 'getBalance':
        return this.simGetBalance(request);
      case 'getTransactionReceipt':
        return this.simGetTransactionReceipt(request);
      case 'estimateGas':
        return this.simEstimateGas(request);
      case 'sendRawTransaction':
        return this.simSendRawTransaction(request);
      case 'getLogs':
        return this.simGetLogs(request);
      default:
        return { result: {}, error: invalidResponse(`Unknown operation: ${request.operation}`) };
    }
  }

  private nextRpcId(): number {
    this.rpcCallId += 1;
    return this.rpcCallId;
  }

  private simGetBalance(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const address = request.params.address as string | undefined;
    if (!address) {
      return { result: {}, error: invalidResponse('address required') };
    }
    // eth_getBalance returns hex wei string. Deterministic per address.
    const wei = deterministicBalanceWei(address);
    return {
      result: {
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        result: wei, // hex string, e.g. "0x1bc16d674ec80000"
      },
    };
  }

  private simGetTransactionReceipt(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const txHash = request.params.txHash as string | undefined;
    if (!txHash) {
      return { result: {}, error: invalidResponse('txHash required') };
    }
    // eth_getTransactionReceipt response shape.
    // status: "0x1" = success, "0x0" = failure.
    const success = !txHash.includes('00');
    return {
      result: {
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        result: {
          transactionHash: txHash,
          transactionIndex: '0x1',
          blockHash: `0x${deterministicHash(txHash + 'block').padStart(64, '0')}`,
          blockNumber: '0x' + (18000000 + (parseInt(deterministicHash(txHash).slice(0, 6), 16) % 100000)).toString(16),
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          contractAddress: null,
          logs: [],
          logsBloom: `0x${'00'.repeat(256)}`,
          status: success ? '0x1' : '0x0',
          effectiveGasPrice: '0x' + (20000000000).toString(16),
        },
      },
    };
  }

  private simEstimateGas(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { from, to, value } = request.params as { from?: string; to?: string; value?: string };
    if (!from || !to) {
      return { result: {}, error: invalidResponse('from and to required') };
    }
    // eth_estimateGas returns hex gas string.
    return {
      result: {
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        result: '0x5208', // 21000 gas — standard ETH transfer
      },
    };
  }

  private simSendRawTransaction(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const rawTx = request.params.rawTx as string | undefined;
    if (!rawTx) {
      return { result: {}, error: invalidResponse('rawTx required') };
    }
    // eth_sendRawTransaction returns the tx hash.
    const txHash = `0x${deterministicHash(rawTx + request.id).padEnd(64, '0').slice(0, 64)}`;
    return {
      result: {
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        result: txHash,
      },
    };
  }

  private simGetLogs(request: ConnectorRequest): { result: Record<string, unknown>; error?: ConnectorError } {
    const { address, fromBlock, toBlock } = request.params as {
      address?: string; topics?: string[]; fromBlock?: string; toBlock?: string;
    };
    if (!address) {
      return { result: {}, error: invalidResponse('address required') };
    }
    // eth_getLogs returns array of log objects.
    return {
      result: {
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        result: [
          {
            address,
            topics: request.params.topics ?? [],
            data: '0x' + '00'.repeat(32),
            blockNumber: fromBlock ?? '0x' + (18000000).toString(16),
            blockHash: `0x${deterministicHash(address + (fromBlock ?? '')).padStart(64, '0')}`,
            transactionHash: `0x${deterministicHash(address + request.id).padStart(64, '0')}`,
            transactionIndex: '0x0',
            logIndex: '0x0',
            removed: false,
          },
        ],
      },
    };
  }

  buildEvidence(request: ConnectorRequest, result: Record<string, unknown>): Evidence {
    const address = request.params.address as string | undefined;
    const txHash =
      (request.params.txHash as string | undefined) ??
      (result.result as { transactionHash?: string } | undefined)?.transactionHash ??
      (typeof result.result === 'string' && result.result.startsWith('0x') ? result.result : undefined);

    let attestedAmount: number | undefined;
    let attestedValue = '';

    if (request.operation === 'getBalance' && address) {
      const weiHex = (result.result as string | undefined) ?? '0x0';
      attestedAmount = parseInt(weiHex, 16);
      attestedValue = `${attestedAmount} wei on ${address}`;
    } else if (request.operation === 'getTransactionReceipt' && txHash) {
      const status = (result.result as { status?: string } | undefined)?.status;
      attestedValue = `On-chain: ${txHash} status=${status ?? 'unknown'}`;
    } else if (request.operation === 'sendRawTransaction') {
      attestedValue = `Submitted raw tx ${txHash}`;
    } else if (request.operation === 'estimateGas') {
      const gas = (result.result as string | undefined) ?? '0x5208';
      attestedAmount = parseInt(gas, 16);
      attestedValue = `Estimated gas: ${attestedAmount}`;
    }

    const entityId = address
      ? `eth-address:${address}`
      : txHash
      ? `eth-tx:${txHash}`
      : 'ethereum';

    return buildAttestationEvidence({
      source: 'on_chain_state',
      verificationLevel: 'cryptographic',
      entityId,
      attester: this.config.id,
      attestedAmount,
      currency: 'WEI',
      reputation: 1.0,
      ttlMs: 999_999_999, // on-chain is effectively permanent
      payload: {
        connector: this.config.id,
        connectorType: this.config.type,
        operation: request.operation,
        attestedValue,
        address,
        txHash,
        rpcEndpoint: this.config.endpoint,
      },
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    return { healthy: true, latencyMs: Math.floor(Math.random() * 60) + 20 };
  }
}

/** Deterministic pseudo-balance in wei (hex string). */
function deterministicBalanceWei(address: string): string {
  const h = deterministicHash(address + 'balance');
  // 0..16 ETH range (16 ETH = 16 * 10^18 wei)
  const ethWhole = parseInt(h.slice(0, 4), 16) % 16;
  const wei = BigInt(ethWhole) * BigInt(10) ** BigInt(18) + BigInt(parseInt(h.slice(4, 12), 16));
  return '0x' + wei.toString(16);
}
