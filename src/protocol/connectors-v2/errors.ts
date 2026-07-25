/**
 * PaySwap Protocol — Production Connectors v2 — Error Factories.
 *
 * Connectors never throw. They return a `ConnectorResponse` whose `error`
 * field is built by one of these factories. Each factory stamps the
 * correct `code` and `retryable` flag so the retry layer can decide
 * whether to back off or fail fast without re-inspecting the message.
 */
import type { ConnectorError, ConnectorErrorCode } from './types';

/** AUTH_FAILED — credentials rejected. Not retryable. */
export function authFailed(msg: string): ConnectorError {
  return { code: 'AUTH_FAILED', message: msg, retryable: false, httpStatus: 401 };
}

/** RATE_LIMITED — upstream asked us to slow down. Retryable after `retryAfterMs`. */
export function rateLimited(retryAfterMs: number): ConnectorError {
  return {
    code: 'RATE_LIMITED',
    message: `rate_limited retry_after=${retryAfterMs}ms`,
    retryable: true,
    httpStatus: 429,
  };
}

/** TIMEOUT — request exceeded the connector's timeout budget. Retryable. */
export function timeout(op: string): ConnectorError {
  return {
    code: 'TIMEOUT',
    message: `timeout operation=${op}`,
    retryable: true,
  };
}

/** UPSTREAM_5XX — server-side error from the rail. Retryable. */
export function upstream5xx(status: number, body: string): ConnectorError {
  return {
    code: 'UPSTREAM_5XX',
    message: `upstream_${status} body=${body.slice(0, 200)}`,
    retryable: true,
    httpStatus: status,
  };
}

/** NETWORK — transport-level failure (DNS, connection reset, …). Retryable. */
export function network(err: string): ConnectorError {
  return {
    code: 'NETWORK',
    message: `network_error ${err}`,
    retryable: true,
  };
}

/** INVALID_RESPONSE — upstream returned data we couldn't parse. Not retryable. */
export function invalidResponse(detail: string): ConnectorError {
  return {
    code: 'INVALID_RESPONSE',
    message: `invalid_response ${detail}`,
    retryable: false,
  };
}

/** INSUFFICIENT_FUNDS — account balance too low. Not retryable. */
export function insufficientFunds(detail: string): ConnectorError {
  return {
    code: 'INSUFFICIENT_FUNDS',
    message: `insufficient_funds ${detail}`,
    retryable: false,
  };
}

/** UNKNOWN — fallback for unmapped failures. Not retryable by default. */
export function unknownError(msg: string): ConnectorError {
  return {
    code: 'UNKNOWN',
    message: msg,
    retryable: false,
  };
}

/** Codes that should trigger exponential backoff. */
const RETRYABLE_CODES: ReadonlySet<ConnectorErrorCode> = new Set([
  'TIMEOUT',
  'RATE_LIMITED',
  'UPSTREAM_5XX',
  'NETWORK',
]);

/** True if the error's code is in the retryable set. */
export function isRetryable(error: ConnectorError): boolean {
  return RETRYABLE_CODES.has(error.code);
}
