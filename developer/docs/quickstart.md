# Quickstart

Welcome to PaySwap! This guide walks you through making your first payment,
listing your recent payments, and sending a payout — in under five minutes.

## 1. Get an API key

Sign up at <https://dashboard.payswap.io> and create an API key. You'll get
two strings:

- `psk_live_...` — production key (real money).
- `psk_test_...`  — sandbox key (test data, simulated connectors).

Start with the **sandbox** key for development.

## 2. Make your first request

You can call the PaySwap API directly with any HTTP client. The only
required header is `Authorization: Bearer <api_key>`.

```bash
curl https://api.sandbox.payswap.io/v1/payments \
  -H "Authorization: Bearer psk_test_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2900,
    "currency": "KES",
    "method": { "type": "mpesa", "mpesa": { "phone": "+254700000000" } },
    "description": "Pro Plan subscription"
  }'
```

You should get a `200 OK` with the created payment object:

```json
{
  "id": "pay_01HZX...",
  "object": "payment",
  "amount": 2900,
  "currency": "KES",
  "status": "succeeded",
  "customer": "cust_01HZX...",
  "created": 1735000000
}
```

## 3. Install the SDK (recommended)

```bash
npm install @payswap/sdk-typescript
# or
bun add @payswap/sdk-typescript
```

```ts
import { PaySwapClient } from '@payswap/sdk-typescript';

const client = new PaySwapClient({
  apiKey: process.env.PAYSWAP_API_KEY!,
  baseUrl: 'https://api.sandbox.payswap.io/v1',
});

const payment = await client.payments.create({
  amount: 2900,
  currency: 'KES',
  method: { type: 'mpesa', mpesa: { phone: '+254700000000' } },
  description: 'Pro Plan subscription',
});

console.log(payment.id, payment.status);
```

The SDK handles authentication, retries, idempotency, and typed errors for
you. See the [SDK README](../sdk/typescript/README.md) for the full API.

## 4. Send a payout

```ts
const payout = await client.payouts.create({
  amount: 50_000,
  currency: 'KES',
  destination: { type: 'mpesa', phone: '+254700000001' },
  reference: 'WITHDRAWAL-001',
});

// Payouts are created in `pending` state. Process them to execute:
await client.payouts.process(payout.id);
```

## 5. List recent payments

```ts
const list = await client.payments.list({ limit: 25 });
for (const p of list.data) {
  console.log(p.id, p.status, p.amount, p.currency);
}
```

## 6. Subscribe to webhooks (optional)

Webhooks let you react to events (`payment.succeeded`, `payout.paid`, …)
without polling. Create a webhook endpoint in the dashboard or via the API:

```ts
// POST /webhooks/endpoints
await fetch('https://api.sandbox.payswap.io/v1/webhooks/endpoints', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.PAYSWAP_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://example.com/webhooks/payswap',
    events: ['payment.succeeded', 'payout.paid', 'invoice.paid'],
  }),
});
```

See the [Webhooks guide](./webhooks.md) for signature verification.

## Next steps

- [Authentication](./authentication.md) — API key formats, scopes, rotation.
- [Payments](./payments.md) — capture, refunds, partial captures.
- [Payouts](./payouts.md) — destinations, scheduling, retries.
- [Errors](./errors.md) — error envelope, status codes, retry strategy.
- [Rate limits](./rate-limits.md) — quotas, backoff, `Retry-After`.
- [OpenAPI spec](../openapi/openapi.yaml) — machine-readable API contract.
