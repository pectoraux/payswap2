/**
 * PaySwap TypeScript SDK — Typed error hierarchy.
 *
 * All errors thrown by the SDK extend `PaySwapError`, so callers can catch
 * a single base class. Each subclass maps to a specific HTTP condition:
 *
 *   - `AuthenticationError`   — 401 (bad API key)
 *   - `InvalidRequestError`   — 400 / 422 (caller-side problem)
 *   - `RateLimitError`        — 429 (back off and retry)
 *   - `NotFoundError`         — 404
 *   - `ServerError`           — 5xx (PaySwap-side problem)
 *
 * `PaySwapError` exposes `status`, `code`, `type`, `requestId`, `retryable`
 * — all pulled from the PaySwap error envelope when present.
 */

/** Base class for every SDK error. */
export class PaySwapError extends Error {
  /** HTTP status code returned by the API (or 0 for transport errors). */
  readonly status: number;
  /** PaySwap-specific error code (e.g. `payment_declined`). */
  readonly code: string;
  /** High-level error type (e.g. `invalid_request_error`). */
  readonly type: string;
  /** PaySwap request ID — useful for support. */
  readonly requestId?: string;
  /** Whether retrying the same request might succeed. */
  readonly retryable: boolean;
  /** Raw API error payload (if available). */
  readonly raw?: unknown;

  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      type?: string;
      requestId?: string;
      retryable?: boolean;
      raw?: unknown;
    } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? 0;
    this.code = opts.code ?? 'unknown_error';
    this.type = opts.type ?? 'api_error';
    this.requestId = opts.requestId;
    this.retryable = opts.retryable ?? false;
    this.raw = opts.raw;
    // Restore the prototype chain after the super() call (TS target ES5 quirk).
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Pretty-printed representation for logs. */
  toString(): string {
    const parts = [
      `${this.name}: ${this.message}`,
      `status=${this.status}`,
      `code=${this.code}`,
      `type=${this.type}`,
    ];
    if (this.requestId) parts.push(`requestId=${this.requestId}`);
    parts.push(`retryable=${this.retryable}`);
    return parts.join(' ');
  }
}

/** 401 — the API key is missing, invalid, or revoked. */
export class AuthenticationError extends PaySwapError {
  constructor(
    message: string,
    opts: { code?: string; requestId?: string; raw?: unknown } = {},
  ) {
    super(message, {
      status: 401,
      code: opts.code ?? 'authentication_error',
      type: 'authentication_error',
      requestId: opts.requestId,
      retryable: false,
      raw: opts.raw,
    });
  }
}

/** 400 / 422 — the request was malformed or invalid. */
export class InvalidRequestError extends PaySwapError {
  constructor(
    message: string,
    opts: {
      code?: string;
      requestId?: string;
      retryable?: boolean;
      raw?: unknown;
    } = {},
  ) {
    super(message, {
      status: 400,
      code: opts.code ?? 'invalid_request_error',
      type: 'invalid_request_error',
      requestId: opts.requestId,
      retryable: opts.retryable ?? false,
      raw: opts.raw,
    });
  }
}

/** 429 — rate limit exceeded. Safe to retry with backoff. */
export class RateLimitError extends PaySwapError {
  /** Epoch ms when the rate-limit window resets, if the API provided it. */
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    opts: {
      code?: string;
      requestId?: string;
      retryAfterMs?: number;
      raw?: unknown;
    } = {},
  ) {
    super(message, {
      status: 429,
      code: opts.code ?? 'rate_limit_error',
      type: 'rate_limit_error',
      requestId: opts.requestId,
      retryable: true,
      raw: opts.raw,
    });
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** 404 — the requested resource does not exist. */
export class NotFoundError extends PaySwapError {
  constructor(
    message: string,
    opts: { code?: string; requestId?: string; raw?: unknown } = {},
  ) {
    super(message, {
      status: 404,
      code: opts.code ?? 'not_found',
      type: 'invalid_request_error',
      requestId: opts.requestId,
      retryable: false,
      raw: opts.raw,
    });
  }
}

/** 5xx — PaySwap-side failure. Usually safe to retry. */
export class ServerError extends PaySwapError {
  constructor(
    message: string,
    opts: {
      status?: number;
      code?: string;
      requestId?: string;
      retryable?: boolean;
      raw?: unknown;
    } = {},
  ) {
    super(message, {
      status: opts.status ?? 500,
      code: opts.code ?? 'server_error',
      type: 'api_error',
      requestId: opts.requestId,
      retryable: opts.retryable ?? true,
      raw: opts.raw,
    });
  }
}
