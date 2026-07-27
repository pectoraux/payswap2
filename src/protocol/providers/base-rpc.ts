/**
 * PaySwap Protocol — Provider Adapter — Base JSON-RPC.
 *
 * Concrete EVM-RPC adapter for Base (Coinbase L2, chain id 8453). Wraps
 * the shared `EvmRpcConnectorBase` with Base-specific config. Real
 * implementations point at a Base RPC provider (Coinbase public
 * mainnet.base.org, Alchemy, QuickNode).
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

/** Base (Coinbase L2) mainnet chain descriptor. */
export const BASE_CHAIN: EvmChainDescriptor = {
  name: 'Base JSON-RPC',
  chainId: 8453,
  nativeSymbol: 'ETH',
  defaultEndpoint: 'https://mainnet.base.org',
  jurisdiction: 'global',
  rateLimitRps: 20,
  rateLimitBurst: 40,
};

/** Default config — Base public RPC characteristics. */
export const DEFAULT_BASE_RPC_CONFIG: EvmProviderConfig = buildEvmConfig('base_rpc', BASE_CHAIN);

export class BaseRpcConnector extends EvmRpcConnectorBase {
  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<EvmProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(BASE_CHAIN, DEFAULT_BASE_RPC_CONFIG, healthMonitor, metricsCollector, config, idempotency);
  }
}
