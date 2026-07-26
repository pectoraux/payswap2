# Error handling

PaySwap uses conventional HTTP status codes plus a structured error
envelope. This guide covers the envelope, the SDK error hierarchy, and
retry strategy.

## Error envelope

Every error response has the same shape:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "amount_invalid",
    "message": "amount must be a positive integer",
    "param": "amount",
    "requestId": "req_01HZX...",
    "retryable": false,
    "retryAfterMs": null
  }
}
```

| Field          | Always present | Description                                              |
|----------------|----------------|----------------------------------------------------------|
| `type`         | yes            | High-level category (see below).                         |
| `code`         | yes            | PaySwitch-specific code, e.g. `payment_declined`.        |
| `message`      | yes            | Human-readable explanation.                              |
| `param`        | no             | The request parameter that caused the error.             |
| `requestId`    | yes            | Include this when reporting issues to support.           |
| `retryable`    | yes            | Whether retrying with the same params might succeed.     |
| `retryAfterMs` | no             | For 429s — how long to wait before retrying.             |

## `type` values

| `type`                  | HTTP status    | Meaning                                    |
|-------------------------|----------------|--------------------------------------------|
| `authentication_error`  | 401            | Missing / invalid API key.                 |
| `authorization_error`   | 403            | Authenticated but lacks scope.             |
| `invalid_request_error` | 400, 404, 422  | Caller-side problem (params, state).       |
| `rate_limit_error`      | 429            | Rate limit exceeded.                       |
| `api_error`             | 5xx            | PaySwitch-side failure.                    |

## SDK error hierarchy

The TypeScript SDK throws subclasses of `PaySwapError`. Catch the base
class to handle anything from the API:

```ts
import {
  PaySwapError,
  AuthenticationError,
  InvalidRequestError,
  RateLimitError,
  NotFoundError,
  ServerError,
} from '@payswap/sdk-typescript';

try {
  await client.payments.create({ ... });
} catch (err) {
  if (err instanceof AuthenticationError) {
    // 401 — fix your API key config.
  } else if (err instanceof RateLimitError) {
    // 429 — the SDK already retried with backoff, but if it gave up:
    console.log(`rate-limited; retry after ${err.retryAfterMs}ms`);
  } else if (err instanceof InvalidRequestError) {
    // 400 / 422 — your params are wrong.
    console.log(err.code, err.message, err.param);
  } else if (err instanceof NotFoundError) {
    // 404 — resource doesn't exist.
  } else if (err instanceof ServerError) {
    // 5xx — PaySwap-side problem.
  } else if (err instanceof PaySwapError) {
    // Catch-all for any other PaySwap error.
    console.log(err.toString());
  } else {
    // Non-PaySwap error (network / SDK bug).
    throw err;
  }
}
```

Every `PaySwapError` exposes:

| Property     | Type      | Description                              |
|--------------|-----------|------------------------------------------|
| `status`     | number    | HTTP status (0 for transport errors).    |
| `code`       | string    | PaySwitch error code.                    |
| `type`       | string    | High-level type.                         |
| `message`    | string    | Human-readable message.                  |
| `requestId`  | string?   | Server request id (for support).         |
| `retryable`  | boolean   | Safe to retry?                           |
| `raw`        | unknown?  | Raw API response body.                   |

## Retry strategy

The SDK retries automatically on:

- Network errors (DNS, connection reset, timeout).
- HTTP 409 (conflict — race condition, usually safe).
- HTTP 429 (rate limited) — honors `retryAfterMs` when present.
- HTTP 5xx (server errors).

Backoff is exponential with jitter:

```
delay = min(maxBackoffMs, baseMs * 2 ** attempt) + random(0, 25% of delay)
```

Defaults: `baseMs = 500`, `maxBackoffMs = 30_000`, `maxRetries = 3`.

To override:

```ts
const client = new PaySwapClient({
  apiKey: process.env.PAYSWAP_API_KEY!,
  maxRetries: 5,
  timeout: 60_000,
});
```

To retry manually (e.g. for jobs that should keep trying for hours):

```ts
async function retryWithBackoff<T>(fn: () => Promise<T>, maxAttempts = 10): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof PaySwapError && !err.retryable) throw err;
      const delay = Math.min(30_000, 500 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
  throw lastErr;
}
```

## Common error codes

### Authentication & authorization

| Code                       | Status | Retryable | Cause                                  |
|----------------------------|--------|-----------|----------------------------------------|
| `authentication_error`     | 401    | no        | Missing / malformed `Authorization`.   |
| `invalid_api_key`          | 401    | no        | Key not found / revoked / expired.     |
| `insufficient_scope`       | 403    | no        | Key lacks required scope.              |
| `key_environment_mismatch` | 403    | no        | `psk_test_` key against live URL.      |

### Payments

| Code                  | Status | Retryable | Cause                                |
|-----------------------|--------|-----------|--------------------------------------|
| `amount_invalid`      | 400    | no        | `amount` ≤ 0 or non-integer.         |
| `currency_unsupported`| 400    | no        | Currency not enabled for merchant.   |
| `method_required`     | 400    | no        | No payment method supplied.          |
| `payment_declined`    | 402    | no        | Issuer / wallet declined.            |
| `compliance_block`    | 403    | no        | Compliance screening blocked.        |
| `duplicate_payment`   | 409    | no        | Idempotency key reused with different params. |

### Payouts

| Code                       | Status | Retryable | Cause                                |
|----------------------------|--------|-----------|--------------------------------------|
| `amount_invalid`           | 400    | no        | `amount` ≤ 0 or non-integer.         |
| `destination_invalid`      | 400    | no        | Required fields missing for type.    |
| `insufficient_balance`     | 402    | no        | Merchant balance too low.            |
| `payout_not_cancellable`   | 409    | no        | Payout already `in_transit` / `paid`.|
| `rail_unavailable`         | 422    | yes       | Connector down — retry later.        |

### Server-side

| Code                  | Status | Retryable | Cause                                |
|-----------------------|--------|-----------|--------------------------------------|
| `internal_error`      | 500    | yes       | Unhandled server error.              |
| `bad_gateway`         | 502    | yes       | Upstream connector returned junk.    |
| `service_unavailable` | 503    | yes       | Maintenance / overload.              |
| `gateway_timeout`     | 504    | yes       | Upstream connector timed out.        |

## Reporting issues

When contacting support, include:

1. The `requestId` from the error (or the `X-Request-Id` response header).
2. The approximate timestamp.
3. The endpoint you called.
4. The error `code` and `type`.
5. (If possible) a minimal reproduction.

Email: <developers@payswap.io>
