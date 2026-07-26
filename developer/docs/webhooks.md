# Webhooks

PaySwap fires webhook events whenever a resource changes state. Subscribe
to events to react in real time without polling.

## Endpoint lifecycle

1. **Create** an endpoint (`POST /webhooks/endpoints`) with a URL + the
   events you want to receive. PaySwap returns a `secret` — store it.
2. **Verify** signatures on incoming requests using the secret (below).
3. **Acknowledge** with HTTP `2xx` within 30 seconds. Anything else (or
   a timeout) is treated as a failure and retried.
4. **Replay** failed deliveries via `POST /webhooks/replay`.

## Event payload

```json
{
  "id": "evt_01HZX...",
  "object": "event",
  "type": "payment.succeeded",
  "api_version": "1.0.0",
  "created": 1735000000,
  "data": {
    "object": {
      "id": "pay_01HZX...",
      "object": "payment",
      "amount": 2900,
      "currency": "KES",
      "status": "succeeded"
    }
  },
  "previous_attributes": null
}
```

`data.object` is the affected resource in its current state.
`previous_attributes` (when present) is a sparse object of fields that
changed — e.g. `{ "status": "pending" }` for a `payment.succeeded` event.

## Event types

| Event type                  | Description                                   |
|-----------------------------|-----------------------------------------------|
| `payment.created`           | Payment created (status=pending).             |
| `payment.requires_action`   | Customer action required (3DS / OTP).         |
| `payment.succeeded`         | Funds captured.                               |
| `payment.failed`            | Authorization or capture failed.              |
| `payment.refunded`          | Full refund processed.                        |
| `payout.created`            | Payout created.                               |
| `payout.processed`          | Payout moved to `in_transit`.                 |
| `payout.paid`               | Payout funds arrived.                         |
| `payout.failed`             | Payout failed.                                |
| `payout.canceled`           | Payout canceled.                              |
| `invoice.created`           | Invoice created (draft).                      |
| `invoice.sent`              | Invoice sent to customer.                     |
| `invoice.paid`              | Invoice marked paid.                          |
| `invoice.overdue`           | Invoice past due.                             |
| `compliance.alert`          | Compliance screening flagged an entity.       |
| `treasury.threshold_breach` | Treasury position crossed a configured limit. |
| `ledger.reconciliation_failed` | Reconciliation detected a discrepancy.    |

## Signature verification

Every webhook request includes a `PaySwap-Signature` header:

```
PaySwap-Signature: t=1735000000,v1=4f7c8b9e...
```

Verify it using the endpoint's `secret`:

```ts
import crypto from 'node:crypto';

export function verifyPaySwapSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string,
  toleranceMs = 5 * 60 * 1000, // 5 min
): boolean {
  const parts = signatureHeader.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const t = Number(tPart.slice(2));
  const v1 = v1Part.slice(3);

  // Replay protection.
  if (Math.abs(Date.now() - t) > toleranceMs) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${body.toString('utf-8')}`)
    .digest('hex');

  // Constant-time compare.
  const a = Buffer.from(v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

> **Always** verify the raw request body, not a re-serialized JSON object.
> Different JSON serializers can produce different bytes and the signature
> won't match.

## Example handler (Node.js + Express)

```ts
import express from 'express';
import { verifyPaySwapSignature } from './payswap-webhook';

const app = express();

// Use raw body for signature verification.
app.use(
  '/webhooks/payswap',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    const sig = req.headers['payswap-signature'] as string | undefined;
    if (!sig || !verifyPaySwapSignature(req.body, sig, process.env.PAYSWAP_WEBHOOK_SECRET!)) {
      return res.status(400).send('invalid signature');
    }
    req.jsonBody = JSON.parse(req.body.toString('utf-8'));
    next();
  },
);

app.post('/webhooks/payswap', async (req, res) => {
  const event = req.jsonBody;
  try {
    switch (event.type) {
      case 'payment.succeeded':
        await fulfillOrder(event.data.object);
        break;
      case 'payout.paid':
        await markPayoutPaid(event.data.object);
        break;
      // ...
      default:
        console.log('unhandled event', event.type);
    }
    res.status(200).send('ok');
  } catch (err) {
    // Return 5xx to trigger a retry.
    console.error('webhook handler failed', err);
    res.status(500).send('handler_error');
  }
});
```

## Retry behavior

PaySwitch retries failed deliveries with exponential backoff:

| Attempt | Delay              |
|---------|--------------------|
| 1       | immediate          |
| 2       | 1 minute           |
| 3       | 5 minutes          |
| 4       | 30 minutes         |
| 5       | 2 hours            |
| 6       | 6 hours            |
| 7       | 24 hours (final)   |

After the final attempt the delivery is marked `failed` permanently. You
can still replay it later (below).

## Listing deliveries

```bash
GET /webhooks/deliveries?endpoint_id=we_01HZX...&status=failed
```

```ts
const list = await client.webhooks.list({
  endpoint_id: 'we_01HZX...',
  status: 'failed',
});
```

## Replaying deliveries

Replay a single delivery:

```ts
await client.webhooks.replay({ delivery_id: 'wd_01HZX...' });
```

Replay all failed deliveries from the last 24 hours:

```ts
await client.webhooks.replay({ failed_within_ms: 24 * 60 * 60 * 1000 });
```

Replay re-sends the original event payload (with the same `event.id`)
and creates a new delivery record. Your handler should be idempotent —
receiving the same event twice should produce the same result.

## Idempotency for handlers

Treat every event as if it might arrive twice. The simplest pattern is to
key your state mutation on `event.id`:

```ts
async function handleEvent(event: PaySwapEvent) {
  await db.events.upsert({
    where: { id: event.id },
    create: { id: event.id, type: event.type, processedAt: new Date() },
    update: {}, // no-op — already processed
  });
}
```

## Best practices

- **Verify signatures** on every request. Reject anything that fails.
- **Respond fast** — under 1 second. Offload heavy work to a queue.
- **Be idempotent** — duplicates are normal.
- **Don't trust the event payload blindly** — re-fetch the resource from
  the API if you need the latest state.
- **Monitor** `failed` deliveries. A spike usually means your handler is
  broken.
- **Don't put business logic in the webhook handler signature check** —
  the check should be a pure function of (body, signature, secret).
