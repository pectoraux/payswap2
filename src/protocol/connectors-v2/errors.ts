/**
 * PaySwap Protocol — Production Connectors v2 — Error Factory + Classification.
 *
 * Structured errors so the retry layer, the metrics layer, and the audit log
 * all speak the same vocabulary. Every error carries a `retryable` flag —
 * the retry layer consults `isRetryable()` and stops immediately on
 * non-retryable errors (e.g. AUTH_FAILED, INSUFFICIENT_FUNDS).
 *
 * HTTP status mapping follows the standard cloud-API convention:
 *   401 / 403              → AUTH_FAILED        (not retryable)
 *   408 / 504              → TIMEOUT            (retryable)
 *   429                    → RATE_LIMITED       (retryable, with Retry-After)
 *   5xx (except 504)       → UPSTREAM_5XX       (retryable)
 *   4xx (except 401/403/408/429) → UPSTREAM_4XX (not retryable)
 *   fetch throws           → NETWORK            (retryable)
 */
import type { ConnectorError, ConnectorErrorCode } from './types';

/** Build a generic ConnectorError with the right `retryable` flag. */
function makeError(
  code: ConnectorErrorCode,
  message: string,
  retryable: boolean,
  extra: Pick<ConnectorError, 'httpStatus' | 'raw' | 'retryAfterMs'> = {},
): ConnectorError {
  return { code, message, retryable, ...extra };
}

/** Authentication failure (401/403, bad token, expired OAuth). Never retry. */
export function authFailed(message: string): ConnectorError {
  return makeError('AUTH_FAILED', message, false);
}

/** Rate-limited by upstream or local token bucket. Retryable after `retryAfterMs`. */
export function rateLimited(retryAfterMs: number): ConnectorError {
  return makeError(
    'RATE_LIMITED',
    `Rate limited; retry after ${retryAfterMs}ms`,
    true,
    { retryAfterMs },
  );
}

/** Per-request timeout. Retryable (transient). */
export function timeout(operation: string): ConnectorError {
  return makeError('TIMEOUT', `Operation '${operation}' timed out`, true);
}

/** Upstream 5xx (server error). Retryable. */
export function upstream5xx(status: number, body: unknown): ConnectorError {
  return makeError(
    'UPSTREAM_5XX',
    `Upstream server error: ${status}`,
    true,
    { httpStatus: status, raw: body },
  );
}

/** Upstream 4xx (client error). Not retryable except for 429. */
export function upstream4xx(status: number, body: unknown): ConnectorError {
  return makeError(
    'UPSTREAM_4XX',
    `Upstream client error: ${status}`,
    false,
    { httpStatus: status, raw: body },
  );
}

/** Network failure (DNS, connection refused, TLS). Retryable. */
export function network(err: unknown): ConnectorError {
  const msg = err instanceof Error ? err.message : String(err);
  return makeError('NETWORK', `Network error: ${msg}`, true, { raw: err });
}

/** Response did not match the expected shape. Not retryable. */
export function invalidResponse(detail: string, raw?: unknown): ConnectorError {
  return makeError('INVALID_RESPONSE', `Invalid response: ${detail}`, false, { raw });
}

/** Upstream reported insufficient funds. Not retryable (business state). */
export function insufficientFunds(detail: string): ConnectorError {
  return makeError('INSUFFICIENT_FUNDS', `Insufficient funds: ${detail}`, false);
}

/** Upstream reported the account is frozen. Not retryable. */
export function accountFrozen(detail: string): ConnectorError {
  return makeError('ACCOUNT_FROZEN', `Account frozen: ${detail}`, false);
}

/** Catch-all. Not retryable by default. */
export function unknownError(message: string, raw?: unknown): ConnectorError {
  return makeError('UNKNOWN', message, false, { raw });
}

/**
 * Classify whether an error is retryable.
 *
 * Retryable:     TIMEOUT, RATE_LIMITED, UPSTREAM_5XX, NETWORK
 * Not retryable: AUTH_FAILED, UPSTREAM_4XX (except 429),
 *                INVALID_RESPONSE, INSUFFICIENT_FUNDS, ACCOUNT_FROZEN, UNKNOWN
 */
export function isRetryable(error: ConnectorError): boolean {
  switch (error.code) {
    case 'TIMEOUT':
    case 'RATE_LIMITED':
    case 'UPSTREAM_5XX':
    case 'NETWORK':
      return true;
    case 'AUTH_FAILED':
    case 'UPSTREAM_4XX':
    case 'INVALID_RESPONSE':
    case 'INSUFFICIENT_FUNDS':
    case 'ACCOUNT_FROZEN':
    case 'UNKNOWN':
      return false;
    default:
      return false;
  }
}

/**
 * Map an HTTP response (status + body) to a ConnectorError.
 *
 * 429 is special-cased to RATE_LIMITED (retryable).
 * 401/403 → AUTH_FAILED.
 * 408/504 → TIMEOUT.
 * 5xx     → UPSTREAM_5XX.
 * 4xx     → UPSTREAM_4XX.
 * 2xx     → no error (returns null — caller should not call fromHttpError on success).
 */
export function fromHttpError(status: number, body: unknown): ConnectorError {
  if (status === 429) {
    // Honor Retry-After if present in body shape; otherwise default 1000ms.
    const retryAfterMs =
      typeof body === 'object' && body !== null && 'retryAfterMs' in body
        ? (body as { retryAfterMs: number }).retryAfterMs
        : 1000;
    return rateLimited(retryAfterMs);
  }
  if (status === 401 || status === 403) {
    return authFailed(`HTTP ${status}: authentication failed`);
  }
  if (status === 408 || status === 504) {
    return timeout(`http_${status}`);
  }
  if (status >= 500) {
    return upstream5xx(status, body);
  }
  if (status >= 400) {
    return upstream4xx(status, body);
  }
  // 2xx — shouldn't normally be called; synthesize an UNKNOWN.
  return unknownError(`Unexpected success status ${status} routed to error path`, body);
}
