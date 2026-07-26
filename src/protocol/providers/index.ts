/**
 * PaySwap Protocol — Provider Adapters — Barrel Export.
 *
 * The providers module is the protocol-layer interface to real-world
 * banking (PSD2 Open Banking), mobile money (MTN, Airtel), card PSPs
 * (Stripe, Flutterwave, Paystack), institutional custody (Fireblocks),
 * crypto compliance (Chainalysis KYT, TRM Labs), and blockchain RPC
 * (Ethereum, Polygon, Base, Stellar Horizon).
 *
 * Each provider adapter extends `ProductionConnector` from
 * `@/protocol/connectors-v2/base` and therefore inherits idempotency,
 * rate limiting, retry, health, metrics, audit, and signed Evidence
 * production. Adapters never mutate protocol state — they only produce
 * Evidence that the planner / executor consumes.
 *
 * Surface area:
 *   - Type definitions (ProviderId, ProviderType, ProviderConfig, …)
 *   - All 13 concrete provider adapters
 *   - The singleton `providerRegistry` (all 13 pre-registered)
 *   - Default configs for each provider
 *
 * Drop-in upgrade paths (replace simulation with real API calls by
 * supplying credentials in the constructor config — no other code
 * changes required):
 *   - MTN MoMo:         `clientId` + `clientSecret` + `subscriptionKey`
 *   - Airtel Money:     `clientId` + `clientSecret`
 *   - Stripe:           `apiKey` (sk_live_…)
 *   - Flutterwave:      `apiKey` (FLWSECK-…) + optional `secretHash`
 *   - Paystack:         `apiKey` (sk_live_…)
 *   - Fireblocks:       `apiKeyId` + `privateKey` (PEM, RSA-2048+)
 *   - Chainalysis KYT:  `apiKey`
 *   - TRM Labs:         `apiKey` + `hmacSecret`
 *   - Open Banking:     `clientId` + `clientSecret` + optional `refreshToken`
 *   - Ethereum/Polygon/Base RPC: optional `apiKey` (Infura/Alchemy/QuickNode)
 *   - Stellar Horizon:  optional `apiKey` (gated Horizon deployments)
 */
export type {
  ProviderId,
  ProviderType,
  ProviderConfig,
  AuthToken,
  AuthResult,
} from './types';
export {
  asConnectorConfig,
  isTokenExpired,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_PROVIDER_IDEMPOTENCY_TTL_MS,
  DEFAULT_PROVIDER_RPS,
  DEFAULT_PROVIDER_BURST,
} from './types';

export { MtnMomoConnector, DEFAULT_MTN_MOMO_CONFIG } from './mtn-momo';
export { AirtelMoneyConnector, DEFAULT_AIRTEL_MONEY_CONFIG } from './airtel-money';
export { StripeConnector, DEFAULT_STRIPE_CONFIG } from './stripe';
export { FlutterwaveConnector, DEFAULT_FLUTTERWAVE_CONFIG } from './flutterwave';
export { PaystackConnector, DEFAULT_PAYSTACK_CONFIG } from './paystack';
export { FireblocksConnector, DEFAULT_FIREBLOCKS_CONFIG } from './fireblocks';
export {
  ChainalysisConnector,
  DEFAULT_CHAINALYSIS_CONFIG,
  type ChainalysisExposureCategory,
  type ChainalysisExposure,
  type ChainalysisAddressScreening,
  type ChainalysisTxScreening,
} from './chainalysis';
export {
  TrmLabsConnector,
  DEFAULT_TRM_LABS_CONFIG,
  type TrmRiskCategory,
  type TrmSeverity,
  type TrmRiskIndicator,
  type TrmAddressScreening,
  type TrmTransactionScreening,
} from './trm-labs';
export { OpenBankingPsd2Connector, DEFAULT_OPEN_BANKING_PSD2_CONFIG } from './open-banking';
export { EthereumRpcConnector, ETHEREUM_CHAIN } from './ethereum-rpc';
export { PolygonRpcConnector, POLYGON_CHAIN } from './polygon-rpc';
export { BaseRpcConnector, BASE_CHAIN } from './base-rpc';
export { StellarHorizonConnector, DEFAULT_STELLAR_HORIZON_CONFIG } from './horizon';

// Shared EVM-RPC base (exported for callers that want to build custom
// EVM-compatible adapters not in the default set).
export {
  EvmRpcConnectorBase,
  buildEvmConfig,
  type EvmChainDescriptor,
  type EvmProviderConfig,
  type EvmTxRecord,
  type EvmLog,
  type EvmAccountRecord,
} from './evm-rpc-base';

export {
  ProviderRegistry,
  providerRegistry,
  PROVIDER_DEFAULT_CONFIGS,
  type AnyProvider,
  type ProviderHealth,
  type ProviderMetrics,
} from './registry';
