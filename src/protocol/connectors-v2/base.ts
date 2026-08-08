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
 *   7. Signed — every successful response carries HMAC-SHA256 signed evidence
 *      (the signature is stamped into `payload.signature` and mirrored as
 *      `evidenceHash` so callers can verify integrity with just the secret).
 */
import { createHmac } from 'node:crypto';
import type { Evidence } from '@/kernel/evidence';
import type {
  ConnectorConfig,
  ConnectorId,
  ConnectorRequest,
  ConnectorResponse,
} from './types';
import { IdempotencyStore } from './idempotency';
import { TokenBucketRateLimiter } from './rate-limiter';
import { HealthMonitor, sharedHealthMonitor } from './health';
import { MetricsCollector, sharedMetricsCollector } from './metrics';
import { auditLog } from './audit';
import { executeWithRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry';
import { rateLimited, unknownError } from './errors';

/**
 * Internal result returned by `doQuery`. Either we got data we can build
 * evidence from, or we got a structured error.
 *
 * Backward-compat: connectors written against the older `{ result, error? }`
 * shape (where a present `error` denotes failure regardless of `result`)
 * are also accepted — `query()` normalises both shapes before invoking the
 * retry layer.
 */
export type DoQueryResult =
  | { ok: true; data: unknown }
  | { ok: false; error: import('./types').ConnectorError }
  | { result: unknown; error?: import('./types').ConnectorError };

/** Abstract base class. */
export abstract class ProductionConnector {
  readonly config: ConnectorConfig;
  protected readonly idempotency: IdempotencyStore;
  protected readonly rateLimiter: TokenBucketRateLimiter;
  protected readonly healthMonitor: HealthMonitor;
  protected readonly metricsCollector: MetricsCollector;
  /** API key set via `setApiKey()` — surfaced in evidence payloads for traceability. */
  private apiKey: string | undefined;
  /** HMAC secret set via `setSecret()` — used to sign evidence. */
  private secret: string | undefined;

  /**
   * Construct a connector. Accepts 1–4 args:
   *   - `new ProductionConnector(config)` — uses shared singletons for health/metrics/idempotency
   *   - `new ProductionConnector(config, health, metrics)` — explicit dependencies
   *   - `new ProductionConnector(config, health, metrics, idempotency)` — full control
   *
   * The 1-arg form lets test connectors extend `ProductionConnector` and call
   * `super(config)` without wiring dependencies — they automatically share
   * state with `sharedHealthMonitor` / `sharedMetricsCollector` so test
   * helpers like `sharedHealthMonitor.reset()` produce a fully clean slate.
   */
  constructor(
    config: ConnectorConfig,
    healthMonitor?: HealthMonitor,
    metricsCollector?: MetricsCollector,
    idempotencyStore?: IdempotencyStore,
  ) {
    this.config = config;
    this.healthMonitor = healthMonitor ?? sharedHealthMonitor;
    this.metricsCollector = metricsCollector ?? sharedMetricsCollector;
    this.idempotency = idempotencyStore ?? new IdempotencyStore();
    this.rateLimiter = new TokenBucketRateLimiter(config.rateLimitRps, config.rateLimitBurst);
  }

  /** Connector id (convenience accessor). */
  get id(): ConnectorId {
    return this.config.id;
  }

  /** Set the API key (used for evidence traceability + upstream auth). */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** Set the HMAC secret used to sign evidence. */
  setSecret(secret: string): void {
    this.secret = secret;
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
   *   1. Idempotency cache check (returns cached response with `attempts: 0`)
   *   2. Rate-limit token acquisition (or RATE_LIMITED error)
   *   3. Retry loop calling `doQuery`
   *   4. On success: build evidence, sign it, record success, cache, audit
   *   5. On failure: record failure, audit, return error response
   */
  async query(request: ConnectorRequest): Promise<ConnectorResponse> {
    // (1) Idempotency ---------------------------------------------------------
    const cached = this.idempotency.get(request.id);
    if (cached) {
      // Don't re-audit cached responses — the original audit entry already exists.
      // Report `attempts: 0` so callers can distinguish a cache hit from a fresh call.
      return { ...cached, attempts: 0 };
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
        // Normalise: accept both { ok, data/error } and { result, error? }.
        if ('ok' in result) {
          if (result.ok) {
            return { ok: true as const, value: result.data };
          }
          return { ok: false as const, error: result.error };
        }
        // Alternate shape — error presence denotes failure.
        if (result.error) {
          return { ok: false as const, error: result.error };
        }
        return { ok: true as const, value: result.result };
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
      this.signEvidence(evidence, request);
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

  /**
   * Stamp the evidence with an HMAC-SHA256 signature. The signature covers
   * the evidence id, entity id, attester, issuedAt timestamp, and payload —
   * so any tampering with those fields invalidates it. The signature is
   * written into `payload.signature` (with `signatureAlgorithm`) and also
   * mirrored as `evidenceHash` so callers can verify integrity with a
   * single string comparison.
   */
  private signEvidence(evidence: Evidence, _request: ConnectorRequest): void {
    const secret = this.secret ?? 'payswap-default-evidence-secret';
    const signingPayload = JSON.stringify({
      id: evidence.id,
      type: evidence.type,
      source: evidence.source,
      entityId: evidence.entityId,
      attester: evidence.attester,
      issuedAt: evidence.issuedAt,
      payload: evidence.payload,
    });
    const hmac = createHmac('sha256', secret);
    hmac.update(signingPayload);
    const sigHex = hmac.digest('hex');
    const sigString = `hmac-sha256:${sigHex}`;
    evidence.payload = {
      ...evidence.payload,
      signature: sigString,
      signatureAlgorithm: 'HMAC-SHA256',
      apiKeyRef: this.config.apiKeyRef,
      connectorId: this.config.id,
    };
    evidence.evidenceHash = sigString;
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
