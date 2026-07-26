# Payments

A payment moves money **from** a customer **to** your merchant account.
Payments are the most common object in the PaySwap API.

## Payment lifecycle

```
                 create()                  capture()                  refund()
   ──────────►  pending  ──────────►  succeeded  ──────────►  refunded
                  │                       │
                  │ requires_action       │ failed
                  ▼                       ▼
            requires_action              failed
```

| Status                | Meaning                                                |
|-----------------------|--------------------------------------------------------|
| `pending`             | Payment created, awaiting authorization / 3DS.         |
| `requires_action`     | Customer must complete 3DS or OTP.                     |
| `succeeded`           | Funds captured.                                        |
| `failed`              | Authorization or capture failed.                       |
| `refunded`            | Fully refunded.                                        |
| `partially_refunded`  | Some but not all of the amount refunded.               |

## Payment methods

PaySwap supports four payment methods:

| Method   | Field  | Notes                                                |
|----------|--------|------------------------------------------------------|
| `mpesa`  | M-Pesa | STK push to a Safaricom number.                      |
| `card`   | Card   | Visa / Mastercard / Amex via Stripe / Flutterwave.   |
| `bank`   | Bank   | Bank transfer / EFT.                                 |
| `crypto` | Crypto | Stellar USDC, Ethereum USDC, Polygon USDC, Base USDC.|

Each method has its own `details` object — see the
[OpenAPI spec](../openapi/openapi.yaml) for the exact schema.

## Create a payment

### M-Pesa (STK push)

```ts
const payment = await client.payments.create({
  amount: 2900,
  currency: 'KES',
  method: {
    type: 'mpesa',
    mpesa: { phone: '+254700000000', reference: 'ORDER-123' },
  },
  description: 'Pro Plan subscription',
});
```

The customer receives an STK push prompt on their phone. The payment
transitions `pending` → `succeeded` (or `failed` if they decline).

### Card

```ts
const payment = await client.payments.create({
  amount: 100,
  currency: 'USD',
  method: {
    type: 'card',
    card: {
      number: '4242424242424242',
      exp_month: 12,
      exp_year: 2030,
      cvc: '123',
    },
  },
});
```

> **Never** log full card numbers. The SDK + API redact PANs to the last 4
> digits in all responses and logs.

### Crypto (Stellar USDC)

```ts
const payment = await client.payments.create({
  amount: 50,
  currency: 'USDC',
  method: {
    type: 'crypto',
    crypto: {
      chain: 'stellar',
      address: 'GABC...',
      asset: 'USDC:GA5ZARMB...',
    },
  },
});
```

Crypto payments return a `requires_action` status with a deposit address
the customer must send funds to. PaySwap monitors the chain and marks the
payment `succeeded` once the funds are confirmed.

## Authorize + capture (two-step)

For card payments, you can authorize first and capture later (e.g. to
verify funds before shipping). Pass `capture: false`:

```ts
const auth = await client.payments.create({
  amount: 5000,
  currency: 'KES',
  method: { type: 'card', card: { ... } },
  capture: false, // authorize only
});

// Later (within 7 days):
await fetch(`${baseUrl}/payments/${auth.id}/capture`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
});
```

## Retrieve a payment

```ts
const payment = await client.payments.get('pay_01HZX...');
```

## List payments

```ts
const list = await client.payments.list({
  limit: 25,
  starting_after: 'pay_01HZX...',
});

for (const p of list.data) {
  console.log(p.id, p.status, p.amount, p.currency);
}
if (list.has_more) {
  // Use the last id as `starting_after` for the next page.
}
```

### Filters

| Parameter        | Type     | Description                                |
|------------------|----------|--------------------------------------------|
| `limit`          | integer  | Page size (1–100). Default 25.             |
| `starting_after` | string   | Cursor for forward pagination.             |
| `ending_before`  | string   | Cursor for backward pagination.            |
| `status`         | enum     | Filter by status.                          |
| `customer`       | string   | Filter by customer id.                     |
| `created_gt`     | integer  | Created after (epoch ms).                  |
| `created_gte`    | integer  | Created at or after (epoch ms).            |
| `created_lt`     | integer  | Created before (epoch ms).                 |
| `created_lte`    | integer  | Created at or before (epoch ms).           |

## Refunds

Full refund:

```ts
await fetch(`${baseUrl}/payments/${payment.id}/refund`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
});
```

Partial refund:

```ts
await fetch(`${baseUrl}/payments/${payment.id}/refund`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ amount: 1000, reason: 'partial_refund_example' }),
});
```

A payment transitions to `refunded` (full) or `partially_refunded` (partial).

## Idempotency

`POST /payments` is idempotent when you pass an `Idempotency-Key` header.
The SDK auto-generates one for you, but you can pass your own to dedupe
against an external id (e.g. an order id):

```ts
await client.payments.create({
  amount: 2900,
  currency: 'KES',
  idempotency_key: 'order_12345_payment',
});
```

If you retry with the same idempotency key, PaySwap returns the original
payment instead of creating a duplicate.

## Webhook events

| Event type           | Fired when …                                  |
|----------------------|-----------------------------------------------|
| `payment.created`    | Payment object created (status=pending).      |
| `payment.succeeded`  | Funds captured.                               |
| `payment.failed`     | Authorization or capture failed.              |
| `payment.refunded`   | Full refund processed.                        |
| `payment.requires_action` | Customer action required (3DS / OTP).    |

Subscribe via [Webhooks](./webhooks.md).

## Errors specific to payments

| Status | Code                  | Cause                                |
|--------|-----------------------|--------------------------------------|
| 400    | `amount_invalid`      | `amount` ≤ 0 or non-integer.         |
| 400    | `currency_unsupported`| Currency not enabled for merchant.   |
| 400    | `method_required`     | No payment method supplied.          |
| 402    | `payment_declined`    | Issuer / wallet declined the charge. |
| 409    | `duplicate_payment`   | Same idempotency key reused with different params. |

See [Errors](./errors.md) for the full error envelope.
