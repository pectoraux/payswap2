# Rate limits

PaySwap enforces per-API-key rate limits to protect the platform and ensure
fair usage. This guide explains the limits, the headers returned, and how
to handle 429s.

## Default limits

| Tier        | Requests / min | Burst | Notes                          |
|-------------|----------------|-------|--------------------------------|
| Sandbox     | 1000           | 100   | All sandbox keys.              |
| Standard    | 1000           | 200   | Default for live keys.         |
| High-volume | 10 000         | 1000  | Negotiated — contact sales.    |
| Enterprise  | Custom         | Custom| Custom SLA + dedicated capacity.|

Limits apply **per API key**, not per IP. Spreading load across multiple
keys under the same merchant does not multiply your effective limit.

## Response headers

Every API response includes rate-limit headers:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 942
X-RateLimit-Reset: 1735000060
```

| Header                  | Description                                              |
|-------------------------|----------------------------------------------------------|
| `X-RateLimit-Limit`     | Total requests allowed in the current window.            |
| `X-RateLimit-Remaining` | Requests remaining in the current window.                |
| `X-RateLimit-Reset`     | Epoch seconds when the window resets.                    |

When you exceed the limit, the response is HTTP 429:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1735000060

{
  "error": {
    "type": "rate_limit_error",
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Retry after 12 seconds.",
    "requestId": "req_01HZX...",
    "retryable": true,
    "retryAfterMs": 12000
  }
}
```

## SDK behaviour

The SDK retries 429s automatically with exponential backoff and honors
`retryAfterMs` when present. The default is up to 3 retries within the
per-request timeout. If all retries fail, a `RateLimitError` is thrown.

```ts
import { RateLimitError } from '@payswap/sdk-typescript';

try {
  await client.payments.list();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`rate-limited; retry after ${err.retryAfterMs}ms`);
    // Option 1: sleep and retry manually.
    // Option 2: enqueue for a background worker.
  }
}
```

## Best practices

### 1. Use bulk endpoints where available

`/payments` accepts one payment per call. If you need to import 1000
payments, do it sequentially with retries — don't fan out 1000 concurrent
requests.

### 2. Cache `GET` responses

`GET /merchants/me` rarely changes — cache it for 5 minutes client-side.
The same goes for `GET /products`, `GET /customers` (per-customer), and
`GET /ledger/accounts`.

### 3. Use webhooks instead of polling

Polling `GET /payments/{id}` every second until status changes is wasteful
and rate-limit-prone. Subscribe to `payment.succeeded` / `payment.failed`
webhooks instead.

### 4. Implement adaptive concurrency

If you push the rate limit regularly, throttle your own client. A simple
token bucket:

```ts
class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  constructor(private capacity: number, private refillPerSecond: number) {
    this.tokens = capacity;
  }
  async take(): Promise<void> {
    while (true) {
      const now = Date.now();
      const refilled = ((now - this.lastRefill) / 1000) * this.refillPerSecond;
      this.tokens = Math.min(this.capacity, this.tokens + refilled);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const bucket = new TokenBucket(1000, 1000 / 60); // 1000/min
await bucket.take();
await client.payments.create({ ... });
```

### 5. Respect `Retry-After`

If you receive a 429, do **not** immediately retry. Wait at least
`Retry-After` seconds. The SDK does this for you — only retry manually if
you've disabled automatic retries.

## Burst behaviour

The rate limiter is a sliding-window token bucket with a small burst
allowance. A burst of `N` requests in 1 second will succeed if
`N ≤ remaining tokens`; the bucket will then refill at the configured
rate. Sustained traffic above the per-minute limit will hit 429s.

## Per-endpoint overrides

Some endpoints have stricter limits than the global default:

| Endpoint                          | Limit           | Notes                              |
|-----------------------------------|-----------------|------------------------------------|
| `POST /payments`                  | 100 / min       | Protects the downstream rails.     |
| `POST /payouts`                   | 60 / min        | Protects treasury.                 |
| `POST /compliance/screen`         | 200 / min       | Screening is rate-limited upstream.|
| `GET /ops/metrics`                | 60 / min        | Heavy query.                       |
| `GET /ledger/trial-balance`       | 30 / min        | Heavy aggregation.                 |
| `POST /webhooks/replay`           | 10 / min        | Replay is expensive.               |

Per-endpoint limits return the same `429` envelope with `code=rate_limit_exceeded`.

## Quota vs. rate limit

Rate limits are per-minute and reset automatically. **Quotas** are
per-month aggregates enforced separately (e.g. 100k API calls / month on
the Standard tier). Quota exhaustion returns `402` with
`code=quota_exceeded` and is **not** retryable. Upgrade your plan in the
dashboard to lift the quota.
