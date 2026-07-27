/**
 * PaySwap Protocol — Production Connectors v2 — Abstract Base Connector.
 *
 * `ProductionConnector` is the orchestrator every concrete connector
 * extends. It implements the cross-cutting contract that *every* rail
 * needs: idempotency, rate limiting, retry, evidence creation, health
 * tracking, metrics, and audit logging. Subclasses implement only the
 * rail-specific pieces: `doQuery`, `buildEvidence`, and `healthCheck`.
 *
 * Contract guarantees:
 *   1. `query()` NEVER throws — failures are returned as `ConnectorResponse.error`.
 *   2. Idempotent — the same `request.id` returns the cached response.
 *   3. Rate-limited — over-quota requests return RATE_LIMITED without hitting upstream.
 *   4. Retried — retryable errors back off exponentially.
 *   5. Auditable — every request is recorded via `auditLog()` + event bus.
 *   6. Observable — health and metrics are updated on every attempt.
 */
import type { Evidence } from '@/kernel/evidence';
import type {
  ConnectorConfig,
  ConnectorId,
  ConnectorRequest,
  ConnectorResponse,
} from './types';
import { IdempotencyStore } from './idempotency';
import { TokenBucketRateLimiter } from './rate-limiter';
import { HealthMonitor } from './health';
import { MetricsCollector } from './metrics';
import { auditLog } from './audit';
import { executeWithRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry';
import { rateLimited, unknownError } from './errors';

/**
 * Internal result returned by `doQuery`. Either we got data we can build
 * evidence from, or we got a structured error.
 */
export type DoQueryResult =
  | { ok: true; data: unknown }
  | { ok: false; error: import('./types').ConnectorError };

/** Abstract base class. */
export abstract class ProductionConnector {
  readonly config: ConnectorConfig;
  protected readonly idempotency: IdempotencyStore;
  protected readonly rateLimiter: TokenBucketRateLimiter;
  protected readonly healthMonitor: HealthMonitor;
  protected readonly metricsCollector: MetricsCollector;

  constructor(
    config: ConnectorConfig,
    healthMonitor: HealthMonitor,
    metricsCollector: MetricsCollector,
    idempotencyStore?: IdempotencyStore,
  ) {
    this.config = config;
    this.healthMonitor = healthMonitor;
    this.metricsCollector = metricsCollector;
    this.idempotency = idempotencyStore ?? new IdempotencyStore();
    this.rateLimiter = new TokenBucketRateLimiter(config.rateLimitRps, config.rateLimitBurst);
  }

  /** Connector id (convenience accessor). */
  get id(): ConnectorId {
    return this.config.id;
  }

  /** Rail-specific query. Implementations must NOT throw. */
  protected abstract doQuery(request: ConnectorRequest): Promise<DoQueryResult>;

  /** Build kernel-grade Evidence from a successful `doQuery` result. */
  protected abstract buildEvidence(request: ConnectorRequest, result: unknown): Evidence;

  /** Probe the upstream — used by registry health sweeps. */
  abstract healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;

  /** Build the retry policy from config. */
  protected retryPolicy(): RetryPolicy {
    return {
      maxAttempts: Math.max(1, this.config.retryCount + 1),
      initialBackoffMs: this.config.retryBackoffMs,
      maxBackoffMs: 10_000,
      backoffMultiplier: 2,
      jitter: 0.25,
    };
  }

  /**
   * Orchestrated query — runs the full pipeline. Never throws.
   *
   * Pipeline:
   *   1. Idempotency cache check
   *   2. Rate-limit token acquisition (or RATE_LIMITED error)
   *   3. Retry loop calling `doQuery`
   *   4. On success: build evidence, record success, cache, audit
   *   5. On failure: record failure, audit, return error response
   */
  async query(request: ConnectorRequest): Promise<ConnectorResponse> {
    // (1) Idempotency ---------------------------------------------------------
    const cached = this.idempotency.get(request.id);
    if (cached) {
      // Don't re-audit cached responses — the original audit entry already exists.
      return cached;
    }

    const startTs = Date.now();

    // (2) Rate limit ----------------------------------------------------------
    const acquire = this.rateLimiter.acquire();
    if (!acquire.allowed) {
      const error = rateLimited(acquire.retryAfterMs);
      const response: ConnectorResponse = {
        success: false,
        error,
        latencyMs: Date.now() - startTs,
        attempts: 0,
        requestId: request.id,
      };
      this.healthMonitor.recordFailure(this.id, error);
      this.metricsCollector.recordRequest(this.id, response.latencyMs, false);
      auditLog(this.id, request, response);
      return response;
    }

    // (3) Retry loop ----------------------------------------------------------
    const outcome = await executeWithRetry(async () => {
      try {
        const result = await this.doQuery(request);
        // Map DoQueryResult ({ ok, data }) to the retry layer's
        // expected shape ({ ok, value }) — the data is carried as `value`.
        if (result.ok) {
          return { ok: true as const, value: result.data };
        }
        return { ok: false as const, error: result.error };
      } catch (err) {
        // Defensive: subclasses are contractually forbidden from throwing,
        // but we don't trust them — coerce to UNKNOWN.
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: unknownError(`unexpected_throw: ${message}`) };
      }
    }, this.retryPolicy());

    const latencyMs = Date.now() - startTs;

    // (4) Success path --------------------------------------------------------
    if (outcome.ok) {
      const evidence = this.buildEvidence(request, outcome.value);
      const response: ConnectorResponse = {
        success: true,
        evidence,
        data: outcome.value,
        latencyMs,
        attempts: outcome.attempts,
        requestId: request.id,
      };
      this.healthMonitor.recordSuccess(this.id, latencyMs);
      this.metricsCollector.recordRequest(this.id, latencyMs, true);
      this.idempotency.set(request.id, response, this.config.idempotencyTtlMs);
      auditLog(this.id, request, response);
      return response;
    }

    // (5) Failure path --------------------------------------------------------
    const response: ConnectorResponse = {
      success: false,
      error: outcome.error,
      latencyMs,
      attempts: outcome.attempts,
      requestId: request.id,
    };
    this.healthMonitor.recordFailure(this.id, outcome.error);
    this.metricsCollector.recordRequest(this.id, latencyMs, false);
    auditLog(this.id, request, response);
    return response;
  }

  /** Convenience: returns current health snapshot. */
  health() {
    return this.healthMonitor.getHealth(this.id);
  }

  /** Convenience: returns current metrics snapshot. */
  metrics() {
    return this.metricsCollector.get(this.id);
  }
}

export { DEFAULT_RETRY_POLICY };
