# @payswap/sdk-typescript

[![npm version](https://img.shields.io/npm/v/@payswap/sdk-typescript.svg)](https://www.npmjs.com/package/@payswap/sdk-typescript)
[![license](https://img.shields.io/npm/l/@payswap/sdk-typescript.svg)](https://github.com/payswap/payswap/blob/main/developer/sdk/typescript/LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

The official TypeScript SDK for the [PaySwap](https://payswap.io) API. PaySwap
is a settlement + payments network built on Stellar and M-Pesa for African
fintechs. This SDK gives you a strongly-typed client that handles
authentication, retries, idempotency, and errors so you can focus on your
product.

## Features

- **Typed resource groups** — `client.payments`, `client.payouts`,
  `client.merchants`, `client.webhooks`, `client.customers`, `client.products`,
  `client.invoices`.
- **Automatic idempotency** — POST/PUT/PATCH requests get a random
  `Idempotency-Key` header if you don't supply one. Safe to retry on network
  failure.
- **Automatic retries with exponential backoff** — network errors, 409, 429,
  and 5xx are retried up to `maxRetries` (default 3). `429` honors the
  `retryAfterMs` field when present.
- **Typed errors** — `PaySwapError`, `AuthenticationError`,
  `InvalidRequestError`, `RateLimitError`, `NotFoundError`, `ServerError`.
  Each carries `status`, `code`, `type`, `requestId`, and `retryable`.
- **Configurable** — `baseUrl`, `timeout`, `maxRetries`, `fetchImpl`, `logger`,
  `userAgent`. Works in Node 18+, Bun, Deno, and modern browsers.
- **Zero runtime dependencies** — uses the global `fetch` and
  `AbortController`.

## Install

```bash
npm install @payswap/sdk-typescript
# or
yarn add @payswap/sdk-typescript
# or
bun add @payswap/sdk-typescript
```

## Quick start

```ts
import { PaySwapClient } from '@payswap/sdk-typescript';

const client = new PaySwapClient({
  apiKey: process.env.PAYSWAP_API_KEY!, // psk_live_... or psk_test_...
});

// Create a payment.
const payment = await client.payments.create({
  amount: 2900,
  currency: 'KES',
  method: { type: 'mpesa', mpesa: { phone: '+254700000000' } },
  description: 'Pro Plan subscription',
});

console.log(payment.id, payment.status);

// List payments.
const list = await client.payments.list({ limit: 25 });
for (const p of list.data) console.log(p.id, p.status);

// Create and process a payout.
const payout = await client.payouts.create({
  amount: 50_000,
  currency: 'KES',
  destination: { type: 'mpesa', phone: '+254700000001' },
});
await client.payouts.process(payout.id);
```

## Configuration

```ts
const client = new PaySwapClient({
  apiKey: 'psk_test_...',
  baseUrl: 'https://api.sandbox.payswap.io', // sandbox
  timeout: 60_000,
  maxRetries: 5,
  logger: {
    debug: (e) => console.debug(e.message, e.fields),
    info:  (e) => console.info(e.message, e.fields),
    warn:  (e) => console.warn(e.message, e.fields),
    error: (e) => console.error(e.message, e.fields),
  },
});
```

| Option       | Default                          | Description                              |
|--------------|----------------------------------|------------------------------------------|
| `apiKey`     | — (required)                     | `psk_live_...` or `psk_test_...`         |
| `baseUrl`    | `https://api.payswap.io`         | Override to point at sandbox / on-prem.  |
| `timeout`    | `30000`                          | Per-request timeout in ms.               |
| `maxRetries` | `3`                              | Max retry attempts on retryable errors.  |
| `fetchImpl`  | global `fetch`                   | Inject a custom fetch for testing.       |
| `logger`     | no-op                            | Inject a logger to trace requests.       |
| `userAgent`  | `@payswap/sdk-typescript/x.y.z`  | Override the `User-Agent` header.        |

## Idempotency

All `POST`, `PUT`, and `PATCH` requests automatically get an
`Idempotency-Key` header so a retry does not double-create a resource. Pass
your own key if you want to deduplicate against an external id:

```ts
await client.payments.create({
  amount: 1000,
  currency: 'KES',
  idempotency_key: 'order_12345_payment',
});
```

## Retries

The client retries on:

- Network errors (DNS, connection reset, timeout)
- HTTP 409 (conflict)
- HTTP 429 (rate limited) — honors `Retry-After` / `retryAfterMs`
- HTTP 5xx (server errors)

Backoff: `min(maxBackoffMs, baseMs * 2 ** attempt) + 25% jitter`, with
`baseMs = 500` and `maxBackoffMs = 30000` by default.

## Error handling

```ts
import {
  PaySwapError,
  AuthenticationError,
  RateLimitError,
  InvalidRequestError,
  NotFoundError,
  ServerError,
} from '@payswap/sdk-typescript';

try {
  await client.payments.get('pay_unknown');
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log('payment not found');
  } else if (err instanceof RateLimitError) {
    console.log(`rate-limited; retry after ${err.retryAfterMs}ms`);
  } else if (err instanceof PaySwapError) {
    console.log(err.toString()); // includes status, code, type, requestId
  } else {
    throw err; // non-PaySwap error
  }
}
```

## Webhooks

The SDK does **not** ship a webhook verifier — your HTTP framework owns the
request body. Use the webhook secret from your dashboard to verify the
`PaySwap-Signature` header:

```ts
import crypto from 'node:crypto';

function verifyWebhook(rawBody: Buffer, signature: string, secret: string): boolean {
  const [tPart, v1Part] = signature.split(',');
  const t = tPart.split('=')[1];
  const v1 = v1Part.split('=')[1];
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

See `developer/docs/webhooks.md` for the full guide.

## TypeScript

The SDK is written in strict TypeScript. All resource methods are fully
typed — request bodies, response bodies, and error subclasses. Import the
types you need:

```ts
import type { Payment, CreatePaymentRequest, ListResponse } from '@payswap/sdk-typescript';
```

## Versioning

This SDK follows SemVer. Breaking changes are released under a new major
version and announced in the [changelog](./CHANGELOG.md).

## Support

- Docs: <https://docs.payswap.io>
- API status: <https://status.payswap.io>
- Issues: <https://github.com/payswap/payswap/issues>
- Email: <developers@payswap.io>

## License

MIT © PaySwap
