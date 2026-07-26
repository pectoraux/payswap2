# Checkout integration example (Next.js)

This example shows how to embed a PaySwap checkout flow into a Next.js
app. The server creates a payment intent with your **secret** API key,
and the browser polls for the result (or subscribes via webhook).

> **Stack**: Next.js 16 (App Router), TypeScript, `@payswap/sdk-typescript`.
> The full source lives next to this README — the snippets below are the
> important bits.

## 1. Install

```bash
bun add @payswap/sdk-typescript
```

## 2. Environment

```bash
# .env.local
PAYSWAP_API_KEY=psk_test_abc123...
PAYSWAP_BASE_URL=https://api.sandbox.payswap.io/v1
NEXT_PUBLIC_PAYSWAP_PUBLISHABLE_KEY=pk_test_abc123...
```

## 3. Server: create a payment intent

```ts
// app/api/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PaySwapClient } from '@payswap/sdk-typescript';

const client = new PaySwapClient({
  apiKey: process.env.PAYSWAP_API_KEY!,
  baseUrl: process.env.PAYSWAP_BASE_URL,
});

export async function POST(req: NextRequest) {
  const { productId, customer } = await req.json();
  const product = await getProduct(productId); // your DB

  const payment = await client.payments.create({
    amount: product.price,
    currency: product.currency,
    customer,
    method: { type: 'mpesa', mpesa: { phone: customer.phone } },
    description: product.name,
    metadata: { productId, orderId: generateOrderId() },
    idempotency_key: `order_${orderId}`, // dedupe against your order id
  });

  return NextResponse.json({ paymentId: payment.id, status: payment.status });
}
```

## 4. Browser: trigger checkout + poll

```tsx
// app/checkout/CheckoutButton.tsx
'use client';
import { useState } from 'react';

export function CheckoutButton({ productId }: { productId: string }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'succeeded' | 'failed'>('idle');

  async function pay() {
    setStatus('pending');
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, customer: { phone: '+254700000000' } }),
    });
    const { paymentId } = await res.json();

    // Poll until terminal state.
    const interval = setInterval(async () => {
      const r = await fetch(`/api/payments/${paymentId}`);
      const { status } = await r.json();
      if (status === 'succeeded' || status === 'failed') {
        clearInterval(interval);
        setStatus(status);
      }
    }, 2000);
  }

  return (
    <button onClick={pay} disabled={status === 'pending'}>
      {status === 'pending' ? 'Check your phone…' : 'Pay with M-Pesa'}
    </button>
  );
}
```

## 5. Server: poll endpoint

```ts
// app/api/payments/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PaySwapClient } from '@payswap/sdk-typescript';

const client = new PaySwapClient({ apiKey: process.env.PAYSWAP_API_KEY! });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const payment = await client.payments.get(params.id);
  return NextResponse.json({ id: payment.id, status: payment.status });
}
```

## 6. Server: webhook (recommended over polling)

Polling works for low-volume checkouts, but **webhooks** are the
production-grade pattern. They fire even if the customer closes the
browser tab:

```ts
// app/api/webhooks/payswap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

function verify(body: Buffer, sig: string, secret: string): boolean {
  const t = sig.split(',').find((p) => p.startsWith('t='))?.slice(2);
  const v1 = sig.split(',').find((p) => p.startsWith('v1='))?.slice(3);
  if (!t || !v1) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${body.toString('utf-8')}`)
    .digest('hex');
  const a = Buffer.from(v1, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const body = Buffer.from(await req.arrayBuffer());
  const sig = req.headers.get('payswap-signature') ?? '';
  if (!verify(body, sig, process.env.PAYSWAP_WEBHOOK_SECRET!)) {
    return new NextResponse('invalid signature', { status: 400 });
  }
  const event = JSON.parse(body.toString('utf-8'));
  switch (event.type) {
    case 'payment.succeeded':
      await fulfillOrder(event.data.object.metadata.orderId);
      break;
    case 'payment.failed':
      await cancelOrder(event.data.object.metadata.orderId);
      break;
  }
  return NextResponse.json({ ok: true });
}
```

## 7. Production checklist

- [ ] Use `psk_live_` keys (not `psk_test_`).
- [ ] Switch `PAYSWAP_BASE_URL` to `https://api.payswap.io/v1`.
- [ ] Verify webhook signatures.
- [ ] Make your webhook handler idempotent (key off `event.id`).
- [ ] Drop the polling fallback — rely on webhooks.
- [ ] Add a retry / DLQ for failed webhook deliveries.
- [ ] Monitor `payment.failed` events and surface them to support.

## Related

- [Webhook handler example](../webhook-handler/) — pure Node.js version.
- [Recurring billing example](../recurring-billing/) — subscription flow.
- [Payments guide](../../docs/payments.md) — full payment API surface.
- [OpenAPI spec](../../openapi/openapi.yaml) — request/response schemas.
