# Webhook handler example (Node.js + Express)

A minimal Node.js server that receives PaySwap webhooks, verifies their
signatures, dispatches them to handlers, and is idempotent on `event.id`.

> **Stack**: Node.js 18+, Express, TypeScript. No SDK required — just the
> native `crypto` module and an HTTP server.

## 1. Install

```bash
bun add express
bun add -D @types/express typescript
```

## 2. Environment

```bash
PAYSWAP_WEBHOOK_SECRET=whsec_abc123...   # from the dashboard
PORT=3000
```

## 3. The server

```ts
// server.ts
import express, { Request, Response } from 'express';
import crypto from 'node:crypto';

const PORT = process.env.PORT ?? 3000;
const WEBHOOK_SECRET = process.env.PAYSWAP_WEBHOOK_SECRET!;

// ---- Signature verification ------------------------------------------------

function verifySignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const t = Number(tPart.slice(2));
  const v1 = v1Part.slice(3);

  // Replay protection: reject anything older than 5 minutes.
  if (Math.abs(Date.now() - t) > 5 * 60 * 1000) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf-8')}`)
    .digest('hex');

  const a = Buffer.from(v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- Event types ------------------------------------------------------------

interface PaySwapEvent {
  id: string;
  object: 'event';
  type: string;
  api_version: string;
  created: number;
  data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> };
}

// ---- Idempotency ------------------------------------------------------------

// In production, use Redis or your DB. This in-memory set only survives
// the lifetime of the process — fine for an example, not for production.
const processedEventIds = new Set<string>();

// ---- Handlers ---------------------------------------------------------------

async function handlePaymentSucceeded(payment: Record<string, unknown>): Promise<void> {
  console.log('payment.succeeded', payment.id, payment.amount, payment.currency);
  // TODO: fulfill the order in your DB.
}

async function handlePaymentFailed(payment: Record<string, unknown>): Promise<void> {
  console.log('payment.failed', payment.id, payment.status);
  // TODO: cancel the order, email the customer, etc.
}

async function handlePayoutPaid(payout: Record<string, unknown>): Promise<void> {
  console.log('payout.paid', payout.id, payout.amount);
  // TODO: mark the payout as paid in your DB.
}

async function handleInvoicePaid(invoice: Record<string, unknown>): Promise<void> {
  console.log('invoice.paid', invoice.id, invoice.number);
  // TODO: mark the invoice as paid, send receipt.
}

async function handleComplianceAlert(alert: Record<string, unknown>): Promise<void> {
  console.log('compliance.alert', alert);
  // TODO: page the compliance on-call.
}

async function dispatchEvent(event: PaySwapEvent): Promise<void> {
  switch (event.type) {
    case 'payment.succeeded':
      await handlePaymentSucceeded(event.data.object);
      break;
    case 'payment.failed':
      await handlePaymentFailed(event.data.object);
      break;
    case 'payout.paid':
      await handlePayoutPaid(event.data.object);
      break;
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object);
      break;
    case 'compliance.alert':
      await handleComplianceAlert(event.data.object);
      break;
    default:
      console.log('unhandled event', event.type);
  }
}

// ---- Server -----------------------------------------------------------------

const app = express();

// IMPORTANT: use express.raw so we get the raw bytes for signature
// verification. express.json would re-serialize the body and break
// the signature.
app.post(
  '/webhooks/payswap',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const sig = req.headers['payswap-signature'] as string | undefined;
    if (!sig) {
      return res.status(400).send('missing signature');
    }
    if (!verifySignature(req.body as Buffer, sig, WEBHOOK_SECRET)) {
      return res.status(400).send('invalid signature');
    }

    const event = JSON.parse((req.body as Buffer).toString('utf-8')) as PaySwapEvent;

    // Idempotency — the same event may arrive twice.
    if (processedEventIds.has(event.id)) {
      console.log('duplicate event, skipping', event.id);
      return res.status(200).send('ok (duplicate)');
    }
    processedEventIds.add(event.id);

    try {
      await dispatchEvent(event);
      res.status(200).send('ok');
    } catch (err) {
      // Returning 5xx triggers a retry from PaySwap.
      console.error('handler failed', err);
      // Roll back the event.id so a retry can re-process it.
      processedEventIds.delete(event.id);
      res.status(500).send('handler_error');
    }
  },
);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`PaySwap webhook server listening on :${PORT}`);
});
```

## 4. Run

```bash
bun run server.ts
```

Expose the server publicly (e.g. via [ngrok](https://ngrok.com) for local
dev) and register the URL in the dashboard or via the API:

```bash
curl https://api.sandbox.payswap.io/v1/webhooks/endpoints \
  -H "Authorization: Bearer $PAYSWAP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-tunnel.example/webhooks/payswap",
    "events": ["payment.succeeded", "payment.failed", "payout.paid", "invoice.paid", "compliance.alert"]
  }'
```

Store the returned `secret` as `PAYSWAP_WEBHOOK_SECRET`.

## 5. Test

Trigger a test event by creating a payment in the sandbox. You should see
the corresponding log line in your server console. If you don't:

1. Check that your tunnel is up and HTTPS is terminating correctly.
2. Check that the dashboard shows the endpoint as `enabled`.
3. Check the deliveries list (`GET /webhooks/deliveries?endpoint_id=we_...`)
   for the response code your server returned.
4. Replay failed deliveries from the dashboard or via
   `POST /webhooks/replay`.

## 6. Production checklist

- [ ] Replace the in-memory `processedEventIds` set with Redis / your DB.
- [ ] Add structured logging (JSON to stdout, picked up by your log shipper).
- [ ] Add a `/health` endpoint for your load balancer.
- [ ] Set a per-request timeout (Express has no default — use
  `server.setTimeout(30_000)`).
- [ ] Set up alerting on `failed` deliveries.
- [ ] Set up alerting on 5xx response-rate from this server.
- [ ] Make every handler idempotent — duplicates are normal.

## Related

- [Webhooks guide](../../docs/webhooks.md) — full reference.
- [Checkout integration](../checkout-integration/) — Next.js example.
- [OpenAPI spec](../../openapi/openapi.yaml) — webhook event schema.
