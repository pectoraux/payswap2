/**
 * PaySwap Protocol — Production Connectors v2 — Core Types.
 *
 * These types define the contract for every production connector in the
 * PaySwap runtime. Connectors are READ-ONLY with respect to protocol state:
 * they ONLY produce Evidence. A connector returning `{ success: false }` must
 * not have mutated any protocol module's state.
 *
 * The ConnectorConfig shape mirrors what an SRE would provision in a secrets
 * manager + service catalog: endpoint URL, secret references (never the
 * secrets themselves), timeout, retry budget, rate-limit, idempotency TTL.
 *
 * The connector never sees the actual secret string at construction time in
 * real production — it resolves `secretRef` from the kernel's secret store at
 * call time. In this sandbox we keep a `secrets` map on the registry for the
 * HMAC signing path.
 */
import type { Evidence } from '@/kernel/evidence';

/** Identifier for a production connector. */
export type ConnectorId =
  | 'open_banking'
  | 'mpesa'
  | 'ethereum_rpc'
  | 'fx_rate'
  | 'stellar_horizon';

/** Coarse classification — drives dashboards + alert routing. */
export type ConnectorType =
  | 'bank'
  | 'mobile_money'
  | 'blockchain_rpc'
  | 'exchange';

/**
 * Connector configuration.
 *
 * `apiKeyRef` and `secretRef` are references (e.g. "vault://payswap/open-banking/prod")
 * — never inline secrets. The registry resolves them via the kernel secret
 * store at call time.
 */
export interface ConnectorConfig {
  id: ConnectorId;
  type: ConnectorType;
  name: string;
  endpoint: string;
  /** Secret-manager reference for the API key (e.g. Bearer token). */
  apiKeyRef: string;
  /** Secret-manager reference for the HMAC signing key. */
  secretRef: string;
  /** Per-request hard timeout (ms). */
  timeout: number;
  /** Max retry attempts (in addition to the initial attempt). */
  retryCount: number;
  /** Initial backoff (ms) — multiplied by `backoffMultiplier` each attempt. */
  retryBackoffMs: number;
  /** Sustained requests per second the connector is allowed to issue. */
  rateLimitRps: number;
  /** Burst capacity (token-bucket size). */
  rateLimitBurst: number;
  /** Idempotency cache TTL (ms). Same key within this window returns cached. */
  idempotencyTtlMs: number;
}

/**
 * A single connector request. `id` is the idempotency key — callers MUST
 * supply a stable id for any operation that mutates external state (transfer,
 * STK push, raw tx submit). Read-only queries may still pass an id; it will
 * be cached for the TTL window.
 */
export interface ConnectorRequest {
  /** Idempotency key — same key returns same response (cached). */
  id: string;
  /** Operation name, e.g. 'getBalance', 'sendSTKPush'. */
  operation: string;
  /** Operation-specific parameters. */
  params: Record<string, unknown>;
  /** Optional shape name for response validation. */
  expectedResponseShape?: string;
}

/**
 * Structured connector error. Every non-success response carries one.
 * Codes are the union of HTTP transport errors, upstream business errors,
 * and connector-internal errors.
 */
export interface ConnectorError {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
  /** HTTP status from upstream, if applicable. */
  httpStatus?: number;
  /** Upstream raw body / parsed response, for forensic debug. */
  raw?: unknown;
  /** For RATE_LIMITED — ms to wait before retrying. */
  retryAfterMs?: number;
}

export type ConnectorErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UPSTREAM_5XX'
  | 'UPSTREAM_4XX'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'INSUFFICIENT_FUNDS'
  | 'ACCOUNT_FROZEN'
  | 'UNKNOWN';

/** Per-connector health snapshot. */
export interface ConnectorHealth {
  id: ConnectorId;
  healthy: boolean;
  latencyMs: number;
  lastCheckTs: number;
  consecutiveFailures: number;
  lastError?: string;
}

/** Per-connector metrics snapshot. */
export interface ConnectorMetrics {
  id: ConnectorId;
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  requestsRetried: number;
  requestsRateLimited: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  lastRequestTs: number;
}

/**
 * Connector response — the canonical return type from every connector call.
 * Connectors NEVER throw. They always return a ConnectorResponse.
 *
 * Invariants:
 *   - success=true  → evidence is present, error is undefined, data is present
 *   - success=false → error is present, evidence is undefined (state untouched)
 *   - latencyMs, attempts, requestId always present
 */
export interface ConnectorResponse {
  success: boolean;
  evidence?: Evidence;
  data?: Record<string, unknown>;
  error?: ConnectorError;
  latencyMs: number;
  attempts: number;
  requestId: string;
}
