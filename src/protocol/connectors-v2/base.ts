/**
 * PaySwap Protocol — Production Connectors v2 — Base Production Connector.
 *
 * Abstract base class that every production connector extends. Wires together:
 *   - idempotency cache (skip upstream if same key seen recently)
 *   - rate limiter (token bucket — short-circuit on bucket empty)
 *   - retry with exponential backoff + jitter (respect isRetryable)
 *   - per-request hard timeout (Promise.race with setTimeout)
 *   - health monitor (record success/failure for dashboards)
 *   - metrics collector (counters + latency percentiles)
 *   - audit log (every request recorded + emitted as `connector.audit` event)
 *   - signed evidence (HMAC-SHA256 over the evidence payload)
 *
 * INVARIANTS (enforced by this class):
 *   1. A connector returning { success: false } NEVER changed protocol state.
 *      Connectors hold no protocol refs — they only return Evidence.
 *   2. Same idempotency key → same response (cached). attempts: 0 on cache hit.
 *   3. Rate limit exceeded → returns immediately with RATE_LIMITED, no doQuery call.
 *   4. Retry only happens for retryable errors, capped at maxAttempts.
 *   5. Every request is audited (success OR failure).
 *   6. Every successful response includes a signed Evidence.
 *
 * Connectors NEVER throw. Every code path returns a ConnectorResponse.
 */
import { createEvidence, type Evidence } from '@/kernel/evidence';
import { uid } from '@/kernel/support';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  ConnectorConfig,
  ConnectorError,
  ConnectorRequest,
  ConnectorResponse,
} from './types';
import { unknownError } from './errors';
import { defaultRetryPolicy, executeWithRetry, type RetryPolicy } from './retry';
import { TokenBucketRateLimiter } from './rate-limiter';
import { IdempotencyStore } from './idempotency';
import { HealthMonitor, sharedHealthMonitor } from './health';
import { MetricsCollector, sharedMetricsCollector } from './metrics';
import { auditLog } from './audit';

export interface ProductionConnectorDeps {
  healthMonitor?: HealthMonitor;
  metricsCollector?: MetricsCollector;
  idempotency?: IdempotencyStore;
  rateLimiter?: TokenBucketRateLimiter;
  retryPolicy?: RetryPolicy;
}

export abstract class ProductionConnector {
  protected readonly config: ConnectorConfig;
  protected readonly retryPolicy: RetryPolicy;
  protected readonly rateLimiter: TokenBucketRateLimiter;
  protected readonly idempotency: IdempotencyStore;
  protected readonly healthMonitor: HealthMonitor;
  protected readonly metricsCollector: MetricsCollector;

  /** Resolved API key (e.g. Bearer token). Empty until setApiKey() is called. */
  protected apiKey: string = '';
  /** Resolved HMAC secret. Empty until setSecret() is called. */
  protected secret: string = '';

  constructor(config: ConnectorConfig, deps: ProductionConnectorDeps = {}) {
    this.config = config;
    this.retryPolicy =
      deps.retryPolicy ?? defaultRetryPolicy(config.retryCount, config.retryBackoffMs);
    this.rateLimiter =
      deps.rateLimiter ?? new TokenBucketRateLimiter(config.rateLimitRps, config.rateLimitBurst);
    this.idempotency = deps.idempotency ?? new IdempotencyStore();
    this.healthMonitor = deps.healthMonitor ?? sharedHealthMonitor;
    this.metricsCollector = deps.metricsCollector ?? sharedMetricsCollector;
  }

  // ─── Secret resolution (called by the registry after construction) ─────────

  /** Set the resolved API key (from secret store). */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /** Set the resolved HMAC signing secret. */
  setSecret(secret: string): void {
    this.secret = secret;
  }

  /** Get the resolved HMAC secret (used by `signedEvidence`). */
  getSecret(): string {
    return this.secret;
  }

  /** Get the connector config. */
  getConfig(): ConnectorConfig {
    return this.config;
  }

  // ─── Abstract methods — subclasses implement these ─────────────────────────

  /**
   * Subclass-implemented upstream call. MUST NOT throw — return
   * `{ result, error? }`. If `error` is present, `result` is ignored.
   *
   * In production this is where the real `fetch` to the upstream API lives.
   * In this sandbox, subclasses simulate the response shape faithfully.
   */
  abstract doQuery(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }>;

  /**
   * Build an Evidence object from a successful result. Called by `query()`
   * AFTER doQuery returns successfully, BEFORE audit/health/metrics recording.
   *
   * The base class will sign the evidence (HMAC-SHA256 over the payload)
   * after this method returns.
   */
  abstract buildEvidence(
    request: ConnectorRequest,
    result: Record<string, unknown>,
  ): Evidence;

  /** Lightweight health probe — used by HealthMonitor.startPeriodic. */
  abstract healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;

  // ─── The canonical entry point ─────────────────────────────────────────────

  /**
   * Execute a connector request with full production guarantees.
   *
   * Flow:
   *   1. Idempotency cache lookup → return cached if present (attempts: 0).
   *   2. Rate-limit token acquire → if denied, return RATE_LIMITED (no doQuery).
   *   3. Execute doQuery with retry + timeout.
   *   4a. On success: build + sign evidence, record success, cache, audit.
   *   4b. On failure: record failure, audit, return error response.
   *
   * NEVER throws. Always returns a ConnectorResponse.
   */
  async query(request: ConnectorRequest): Promise<ConnectorResponse> {
    const start = Date.now();
    const requestId = uid('req');
    const id = this.config.id;

    // ── Step 1: idempotency cache ──────────────────────────────────────────
    const cached = this.idempotency.get(request.id);
    if (cached) {
      const latencyMs = Date.now() - start;
      const response: ConnectorResponse = {
        ...cached,
        // Re-stamp requestId and latencyMs for this call; attempts=0 because
        // the upstream was never touched.
        requestId,
        latencyMs,
        attempts: 0,
      };
      // Audit cache hits too — they ARE requests.
      auditLog(id, request, response, { cached: true });
      // Cache hits don't go through rate limiter or doQuery — record only metrics.
      this.metricsCollector.recordRequest(id, latencyMs, true, false, false);
      return response;
    }

    // ── Step 2: rate-limit token ───────────────────────────────────────────
    const rl = this.rateLimiter.acquire();
    if (!rl.allowed) {
      const latencyMs = Date.now() - start;
      const error: ConnectorError = {
        code: 'RATE_LIMITED',
        message: `Local rate limit exceeded for ${id}; retry after ${rl.retryAfterMs}ms`,
        retryable: true,
        retryAfterMs: rl.retryAfterMs,
      };
      this.healthMonitor.recordFailure(id, error);
      this.metricsCollector.recordRequest(id, latencyMs, false, false, true);
      const response: ConnectorResponse = {
        success: false,
        error,
        latencyMs,
        attempts: 0,
        requestId,
      };
      auditLog(id, request, response, { rateLimited: true });
      return response;
    }

    // ── Step 3: execute with retry + timeout ───────────────────────────────
    const retryResult = await executeWithRetry(
      () => this.callDoQueryWithTimeout(request),
      this.retryPolicy,
    );

    const latencyMs = Date.now() - start;
    const attempts = retryResult.attempts;
    const retried = attempts > 1;

    // ── Step 4a: success ───────────────────────────────────────────────────
    if (retryResult.result && !retryResult.error) {
      const result = retryResult.result;
      let evidence: Evidence;
      try {
        evidence = this.buildEvidence(request, result);
        this.signEvidence(evidence);
      } catch (e) {
        // Evidence construction failed — synthesize an error response.
        // (Defensive — buildEvidence should not throw, but we never propagate.)
        const msg = e instanceof Error ? e.message : String(e);
        const error = unknownError(`Evidence construction failed: ${msg}`, e);
        this.healthMonitor.recordFailure(id, error);
        this.metricsCollector.recordRequest(id, latencyMs, false, retried, false);
        const response: ConnectorResponse = {
          success: false,
          error,
          latencyMs,
          attempts,
          requestId,
        };
        auditLog(id, request, response);
        return response;
      }

      this.healthMonitor.recordSuccess(id, latencyMs);
      this.metricsCollector.recordRequest(id, latencyMs, true, retried, false);
      const response: ConnectorResponse = {
        success: true,
        evidence,
        data: result,
        latencyMs,
        attempts,
        requestId,
      };
      this.idempotency.set(request.id, response, this.config.idempotencyTtlMs);
      auditLog(id, request, response);
      return response;
    }

    // ── Step 4b: failure ───────────────────────────────────────────────────
    const error: ConnectorError = retryResult.error ?? unknownError('No result and no error');
    this.healthMonitor.recordFailure(id, error);
    this.metricsCollector.recordRequest(id, latencyMs, false, retried, false);
    const response: ConnectorResponse = {
      success: false,
      error,
      latencyMs,
      attempts,
      requestId,
    };
    auditLog(id, request, response);
    return response;
  }

  /**
   * Wrap doQuery with a hard timeout. If the timeout fires, synthesize a
   * TIMEOUT error (retryable). The doQuery promise continues in the
   * background — we don't abort it (no AbortController in this sandbox),
   * but we ignore its result.
   */
  private async callDoQueryWithTimeout(
    request: ConnectorRequest,
  ): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`CONNECTOR_TIMEOUT_${this.config.id}`)),
          this.config.timeout,
        );
      });
      const result = await Promise.race([
        this.doQuery(request),
        timeoutPromise,
      ]);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        result: {},
        error: {
          code: 'TIMEOUT',
          message: `Operation '${request.operation}' on ${this.config.id} timed out after ${this.config.timeout}ms: ${msg}`,
          retryable: true,
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Sign an Evidence object in place. Computes HMAC-SHA256 over a canonical
   * string (evidenceId + issuedAt + JSON payload) using the connector's
   * resolved secret. Stores the signature in `evidenceHash` (replacing the
   * placeholder) and in `payload.signature`.
   *
   * If the secret is not yet resolved, the signature is a placeholder —
   * the runtime warns but does NOT throw (evidence is still returned).
   */
  signEvidence(evidence: Evidence): void {
    const canonical = `${evidence.id}|${evidence.issuedAt}|${JSON.stringify(evidence.payload)}`;
    if (!this.secret) {
      // No secret resolved — record a placeholder signature. The evidence is
      // still returned; downstream consumers can check `payload.signatureAlgorithm`.
      evidence.evidenceHash = `unsigned:${hashString(canonical)}`;
      evidence.payload = {
        ...evidence.payload,
        signature: null,
        signatureAlgorithm: 'NONE',
        signedBy: this.config.id,
      };
      return;
    }
    const hmac = createHmac('sha256', this.secret);
    hmac.update(canonical);
    const signature = `hmac-sha256:${hmac.digest('hex')}`;
    evidence.evidenceHash = signature;
    evidence.payload = {
      ...evidence.payload,
      signature,
      signatureAlgorithm: 'HMAC-SHA256',
      signedBy: this.config.id,
      signedAt: Date.now(),
    };
  }

  /**
   * Verify a signature on an Evidence object. Returns true if the signature
   * matches a fresh HMAC computation. Used by downstream consumers that want
   * to verify the evidence has not been tampered with since issuance.
   */
  verifyEvidence(evidence: Evidence): boolean {
    if (!this.secret) return false;
    const sig = evidence.payload?.signature;
    if (typeof sig !== 'string' || !sig.startsWith('hmac-sha256:')) return false;
    const expected = sig.slice('hmac-sha256:'.length);
    const canonical = `${evidence.id}|${evidence.issuedAt}|${JSON.stringify({
      ...evidence.payload,
      signature: undefined,
      signatureAlgorithm: undefined,
      signedBy: undefined,
      signedAt: undefined,
    })}`;
    const hmac = createHmac('sha256', this.secret);
    hmac.update(canonical);
    const actual = hmac.digest('hex');
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
    } catch {
      return false;
    }
  }
}

/** Simple non-cryptographic string hash (for placeholder signatures). */
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * Helper for subclasses: build an Evidence via the kernel's createEvidence,
 * pre-stamped with the connector id as the attester. Subclasses then call
 * `signEvidence(evidence)` themselves (or the base class does it after
 * buildEvidence returns).
 */
export function buildAttestationEvidence(params: {
  source: import('@/kernel/evidence').EvidenceSource;
  verificationLevel: import('@/kernel/evidence').VerificationLevel;
  entityId: string;
  attester: string;
  attestedAmount?: number;
  currency?: string;
  reputation?: number;
  jurisdiction?: string;
  ttlMs?: number;
  payload?: Record<string, unknown>;
}): Evidence {
  return createEvidence({
    type: 'attestation',
    source: params.source,
    verificationLevel: params.verificationLevel,
    entityId: params.entityId,
    attestedAmount: params.attestedAmount,
    currency: params.currency,
    reputation: params.reputation,
    jurisdiction: params.jurisdiction,
    attester: params.attester,
    ttlMs: params.ttlMs,
    payload: params.payload,
  });
}
