/**
 * PaySwap Protocol — Provider Adapter — Polygon JSON-RPC.
 *
 * Concrete EVM-RPC adapter for Polygon PoS (chain id 137). Wraps the
 * shared `EvmRpcConnectorBase` with Polygon-specific config. Real
 * implementations point at a Polygon RPC provider (Alchemy, QuickNode,
 * or the public polygon-rpc.com endpoint).
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

/** Polygon PoS mainnet chain descriptor. */
export const POLYGON_CHAIN: EvmChainDescriptor = {
  name: 'Polygon JSON-RPC',
  chainId: 137,
  nativeSymbol: 'POL',
  defaultEndpoint: 'https://polygon-rpc.com',
  jurisdiction: 'global',
  rateLimitRps: 20,
  rateLimitBurst: 40,
};

/** Default config — Polygon public RPC characteristics. */
export const DEFAULT_POLYGON_RPC_CONFIG: EvmProviderConfig = buildEvmConfig('polygon_rpc', POLYGON_CHAIN);

export class PolygonRpcConnector extends EvmRpcConnectorBase {
  constructor(
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    config?: Partial<EvmProviderConfig>,
    idempotency?: IdempotencyStore,
  ) {
    super(POLYGON_CHAIN, DEFAULT_POLYGON_RPC_CONFIG, healthMonitor, metricsCollector, config, idempotency);
  }
}
