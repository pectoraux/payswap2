/**
 * PaySwap Protocol — Production Connectors v2 — Type Definitions.
 *
 * The connectors-v2 module is the protocol-layer interface to real-world
 * payment rails: Open Banking (PSD2), M-Pesa (Daraja), Stellar Horizon,
 * Ethereum JSON-RPC, and FX rate feeds. Each connector turns an upstream
 * response into kernel-grade `Evidence` so the planner can reason about
 * off-chain state with quantified confidence.
 *
 * These types are deliberately connector-agnostic. Every connector accepts
 * a `ConnectorRequest` and returns a `ConnectorResponse` — the registry
 * and audit/metrics/health subsystems operate on the abstract shape, never
 * on the connector-specific payload.
 */
import type { Evidence } from '@/kernel/evidence';

/** Connector identifier — one per upstream rail. */
export type ConnectorId =
  | 'open_banking'
  | 'mpesa'
  | 'ethereum_rpc'
  | 'fx_rate'
  | 'stellar_horizon';

/** Connector type tag (mirrors id but is kept distinct for future multi-instance support). */
export type ConnectorType = ConnectorId;

/** Static configuration for a connector instance. */
export interface ConnectorConfig {
  id: ConnectorId;
  type: ConnectorType;
  name: string;
  /** Base URL or endpoint descriptor (may be unused by simulated connectors). */
  endpoint: string;
  /** Per-request timeout in ms. */
  timeout: number;
  /** Max retry attempts on retryable failures. */
  retryCount: number;
  /** Base backoff (ms) between retries; multiplied exponentially. */
  retryBackoffMs: number;
  /** Sustained requests-per-second the upstream allows. */
  rateLimitRps: number;
  /** Burst capacity above the sustained rate (token bucket). */
  rateLimitBurst: number;
  /** TTL for idempotency-key cache entries (ms). */
  idempotencyTtlMs: number;
  /** Optional vault reference for the upstream API key. */
  apiKeyRef?: string;
  /** Optional vault reference for the HMAC signing secret. */
  secretRef?: string;
}

/** Outbound request — `id` doubles as the idempotency key. */
export interface ConnectorRequest {
  id: string;
  operation: string;
  params: Record<string, unknown>;
}

/** Error codes every connector may emit. */
export type ConnectorErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UPSTREAM_5XX'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'INSUFFICIENT_FUNDS'
  | 'UNKNOWN';

/** Structured error — never thrown, always returned inside `ConnectorResponse`. */
export interface ConnectorError {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

/** Successful or failed response. `evidence` is only present on success. */
export interface ConnectorResponse {
  success: boolean;
  evidence?: Evidence;
  data?: unknown;
  error?: ConnectorError;
  latencyMs: number;
  attempts: number;
  requestId: string;
}

/** Health snapshot for a single connector. */
export interface ConnectorHealth {
  id: ConnectorId;
  healthy: boolean;
  latencyMs: number;
  lastCheckTs: number;
  consecutiveFailures: number;
}

/** Aggregate metrics for a single connector. */
export interface ConnectorMetrics {
  id: ConnectorId;
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  avgLatencyMs: number;
  lastRequestTs: number;
}
