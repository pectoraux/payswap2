/**
 * API Gateway — single ingress for runtime operations. (M-RT-15.)
 *
 * Responsibilities (orchestration only — no business logic):
 *   1. Authentication/authorization
 *   2. Request validation
 *   3. Idempotency keys
 *   4. Rate limiting
 *   5. Request tracing/correlation IDs
 *   6. Dispatch to the runtime
 *
 * The gateway orchestrates, not implements domain behavior.
 * It dispatches to the runtime without embedding business logic.
 */

import type { Environment } from '../../types';
import type { RuntimeClock } from '../../clock';

// ─── Types ──────────────────────────────────────────────────────────────────

/** A gateway request — what comes in from the client. */
export interface GatewayRequest {
  /** The runtime operation to perform. */
  operation: GatewayOperation;
  /** The request body (operation-specific). */
  body: Record<string, unknown>;
  /** The actor making the request. */
  actor: {
    id: string;
    role: string;
    orgId?: string;
  };
  /** The environment (sandbox or live). */
  environment: Environment;
  /** Optional idempotency key (if provided, duplicate requests return cached result). */
  idempotencyKey?: string;
  /** Optional correlation ID (if not provided, one is generated). */
  correlationId?: string;
}

/** The runtime operations the gateway can dispatch. */
export type GatewayOperation =
  | 'compile'
  | 'execute-payment'
  | 'discover-opportunities'
  | 'simulate-recommendation'
  | 'transition-recommendation'
  | 'get-inspector'
  | 'compare-sim-prod';

/** The gateway's response. */
export interface GatewayResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  correlationId: string;
  idempotentReplay: boolean;
  durationMs: number;
}

// ─── Rate Limiting ──────────────────────────────────────────────────────────

/** A simple in-memory rate limiter (per actor). */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /** Check if the actor is allowed to make a request. Returns true if allowed. */
  allow(actorId: string, now: number): boolean {
    const key = actorId;
    const timestamps = this.requests.get(key) ?? [];
    const cutoff = now - this.windowMs;
    const recent = timestamps.filter((ts) => ts > cutoff);
    if (recent.length >= this.maxRequests) return false;
    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}

// ─── Idempotency Cache ──────────────────────────────────────────────────────

/** A simple in-memory idempotency cache. */
export class IdempotencyCache {
  private cache: Map<string, { result: GatewayResponse; ts: number }> = new Map();
  private readonly ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  /** Get a cached result for an idempotency key. */
  get(key: string, now: number): GatewayResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (now - entry.ts > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  /** Cache a result for an idempotency key. */
  set(key: string, result: GatewayResponse, now: number): void {
    this.cache.set(key, { result, ts: now });
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Validate a gateway request. Returns errors (empty = valid). */
export function validateRequest(req: GatewayRequest): string[] {
  const errors: string[] = [];
  if (!req.operation) errors.push('Missing operation');
  if (!req.actor?.id) errors.push('Missing actor.id');
  if (!req.environment) errors.push('Missing environment');
  if (!['sandbox', 'live'].includes(req.environment)) errors.push('Invalid environment');
  return errors;
}

// ─── API Gateway ────────────────────────────────────────────────────────────

/** The dispatch handler — called by the gateway to execute the operation. */
export type DispatchHandler = (req: GatewayRequest, correlationId: string) => Promise<unknown>;

/**
 * APIGateway — single ingress for runtime operations.
 * Orchestrates auth, validation, idempotency, rate limiting, tracing.
 * Dispatches to the runtime without embedding business logic.
 */
export class APIGateway {
  private rateLimiter: RateLimiter;
  private idempotencyCache: IdempotencyCache;
  private clock: RuntimeClock;

  constructor(clock: RuntimeClock, opts?: { maxRequests?: number; windowMs?: number; idempotencyTtlMs?: number }) {
    this.clock = clock;
    this.rateLimiter = new RateLimiter(opts?.maxRequests ?? 100, opts?.windowMs ?? 60_000);
    this.idempotencyCache = new IdempotencyCache(opts?.idempotencyTtlMs ?? 24 * 60 * 60 * 1000);
  }

  /**
   * Process a request through the gateway.
   * Returns the response with correlation ID + timing.
   */
  async process<T = unknown>(
    req: GatewayRequest,
    dispatch: DispatchHandler,
  ): Promise<GatewayResponse<T>> {
    const start = this.clock.now();
    const correlationId = req.correlationId ?? `corr_${start.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // 1. Idempotency check (if key provided)
    if (req.idempotencyKey) {
      const cached = this.idempotencyCache.get(req.idempotencyKey, start);
      if (cached) {
        return { ...cached, idempotentReplay: true, durationMs: this.clock.now() - start } as GatewayResponse<T>;
      }
    }

    // 2. Rate limiting
    if (!this.rateLimiter.allow(req.actor.id, start)) {
      return {
        success: false,
        error: 'Rate limit exceeded',
        correlationId,
        idempotentReplay: false,
        durationMs: this.clock.now() - start,
      };
    }

    // 3. Validation
    const validationErrors = validateRequest(req);
    if (validationErrors.length > 0) {
      return {
        success: false,
        error: `Validation failed: ${validationErrors.join(', ')}`,
        correlationId,
        idempotentReplay: false,
        durationMs: this.clock.now() - start,
      };
    }

    // 4. Dispatch to the runtime
    try {
      const data = await dispatch(req, correlationId);
      const response: GatewayResponse<T> = {
        success: true,
        data: data as T,
        correlationId,
        idempotentReplay: false,
        durationMs: this.clock.now() - start,
      };

      // 5. Cache the result if idempotency key provided
      if (req.idempotencyKey) {
        this.idempotencyCache.set(req.idempotencyKey, response, this.clock.now());
      }

      return response;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        correlationId,
        idempotentReplay: false,
        durationMs: this.clock.now() - start,
      };
    }
  }
}
