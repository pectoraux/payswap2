/**
 * PaySwap Protocol — Production Connectors v2 — Barrel Export.
 *
 * The connectors-v2 module is the protocol-layer interface to real-world
 * payment rails: Open Banking (PSD2), M-Pesa (Daraja), Stellar Horizon,
 * Ethereum JSON-RPC, and FX rate feeds. Each connector turns an upstream
 * response into kernel-grade `Evidence` so the planner can reason about
 * off-chain state with quantified confidence.
 *
 * Surface area:
 *   - The abstract `ProductionConnector` base class
 *   - The 5 concrete connectors
 *   - The singleton `productionConnectorRegistry` (all 5 pre-registered)
 *   - All type definitions and error factories
 *   - Idempotency, rate-limiter, health, metrics, retry, audit primitives
 */
export type {
  ConnectorId,
  ConnectorType,
  ConnectorConfig,
  ConnectorRequest,
  ConnectorResponse,
  ConnectorError,
  ConnectorErrorCode,
  ConnectorHealth,
  ConnectorMetrics,
} from './types';

export {
  authFailed,
  rateLimited,
  timeout,
  upstream5xx,
  network,
  invalidResponse,
  insufficientFunds,
  unknownError,
  isRetryable,
} from './errors';

export {
  executeWithRetry,
  DEFAULT_RETRY_POLICY,
} from './retry';
export type { RetryPolicy, RetryOutcome } from './retry';

export { TokenBucketRateLimiter } from './rate-limiter';
export type { AcquireResult } from './rate-limiter';

export { IdempotencyStore } from './idempotency';

export { HealthMonitor, DEFAULT_FAILURE_THRESHOLD } from './health';

export { MetricsCollector } from './metrics';

export {
  auditLog,
  getAuditLog,
  auditLogSize,
  clearAuditLog,
} from './audit';
export type { ConnectorAuditEntry, AuditLogFilter } from './audit';

export { ProductionConnector } from './base';
export type { DoQueryResult } from './base';

export { OpenBankingConnector, DEFAULT_OPEN_BANKING_CONFIG } from './open-banking';
export { MpesaConnector, DEFAULT_MPESA_CONFIG } from './mpesa';
export { FxRateConnector, DEFAULT_FX_RATE_CONFIG } from './fx-rate';
export { StellarHorizonConnector, DEFAULT_STELLAR_HORIZON_CONFIG } from './stellar-horizon';
export { EthereumRpcConnector, DEFAULT_ETHEREUM_RPC_CONFIG } from './ethereum-rpc';

export {
  ProductionConnectorRegistry,
  productionConnectorRegistry,
} from './registry';
export type { AnyProductionConnector } from './registry';
