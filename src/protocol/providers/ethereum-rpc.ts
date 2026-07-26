/**
 * PaySwap Protocol — Provider Adapter — Ethereum JSON-RPC.
 *
 * Concrete EVM-RPC adapter for Ethereum mainnet (chain id 1). Wraps the
 * shared `EvmRpcConnectorBase` with Ethereum-specific config. Real
 * implementations point at a node provider (Infura, Alchemy, QuickNode)
 * or a self-hosted geth/reth node; the API key, if present, is appended
 * to the endpoint URL by the real HTTP layer.
 *
 * Operations: see `evm-rpc-base.ts` (getBalance, getTransactionReceipt,
 * sendRawTransaction, estimateGas, getLogs, callContract).
 *
 * Evidence: source='on_chain_state', verificationLevel='cryptographic',
 * reputation=1.0, jurisdiction='global'.
 */
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { IdempotencyStore } from '@/protocol/connectors-v2/idempotency';
import { buildEvmConfig, EvmRpcConnectorBase, type EvmChainDescriptor, type EvmProviderConfig } from './evm-rpc-base';

/** Ethereum mainnet chain descriptor. */
export const ETHEREUM_CHAIN: EvmChainDescriptor = {
  name: 'Ethereum JSON-RPC',
  chainId: 1,
  nativeSymbol: 'ETH',
  defaultEndpoint: 'https://mainnet.infura.io/v3',
  jurisdiction: 'global',
  rateLimitRps: 20,
  rateLimitBurst: 40,
};

/** Default config — Infura-class public RPC characteristics. */
export const DEFAULT_ETHEREUM_RPC_CONFIG: EvmProviderConfig = buildEvmConfig('ethereum_rpc', ETHEREUM_CHAIN);

export class EthereumRpcConnector extends EvmRpcConnectorBase {
  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<EvmProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(ETHEREUM_CHAIN, DEFAULT_ETHEREUM_RPC_CONFIG, healthMonitor, metricsCollector, config, idempotency);
  }
}
