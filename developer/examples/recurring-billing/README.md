# Recurring billing example (Node.js)

This example shows how to build a subscription / recurring-billing flow
on top of PaySwap. PaySwap does **not** ship a built-in subscriptions
product — instead, you schedule payments yourself and use idempotency
keys to dedupe.

> **Stack**: Node.js 18+, TypeScript, `@payswap/sdk-typescript`. A
> background job runner (BullMQ / Temporal / cron) is required — the
> example uses a simple `setInterval` for clarity.

## 1. Install

```bash
bun add @payswap/sdk-typescript
```

## 2. Data model

You'll need a `subscriptions` table in your DB:

```ts
interface Subscription {
  id: string;             // your internal id
  customerId: string;     // payswap customer id
  planId: string;         // your plan id
  amount: number;         // smallest currency unit
  currency: string;       // ISO 4217
  interval: 'monthly' | 'yearly';
  currentPeriodEnd: number;  // epoch ms
  status: 'active' | 'past_due' | 'canceled';
  failedAttempts: number;
}
```

## 3. Subscribe a customer

```ts
import { PaySwapClient } from '@payswap/sdk-typescript';

const client = new PaySwapClient({ apiKey: process.env.PAYSWAP_API_KEY! });

async function subscribe(customerId: string, planId: string): Promise<Subscription> {
  const plan = await getPlan(planId); // { amount, currency, interval }

  // Charge immediately for the first period.
  const payment = await client.payments.create({
    amount: plan.amount,
    currency: plan.currency,
    customer: customerId,
    method: { type: 'mpesa', mpesa: { phone: (await getCustomer(customerId)).phone } },
    description: `Subscription ${planId} — first period`,
    // Idempotency key ties this payment to the subscription create.
    idempotency_key: `sub_first_${customerId}_${planId}`,
  });

  const now = Date.now();
  const periodEnd = plan.interval === 'monthly'
    ? now + 30 * 24 * 60 * 60 * 1000
    : now + 365 * 24 * 60 * 60 * 1000;

  const sub: Subscription = {
    id: generateSubId(),
    customerId,
    planId,
    amount: plan.amount,
    currency: plan.currency,
    interval: plan.interval,
    currentPeriodEnd: periodEnd,
    status: payment.status === 'succeeded' ? 'active' : 'past_due',
    failedAttempts: payment.status === 'succeeded' ? 0 : 1,
  };

  await db.subscriptions.create(sub);
  return sub;
}
```

## 4. Billing worker

Run this on a schedule (e.g. every hour). It finds subscriptions whose
current period has ended and charges them.

```ts
async function billSubscriptions(): Promise<void> {
  const now = Date.now();
  const due = await db.subscriptions.findMany({
    where: {
      status: { in: ['active', 'past_due'] },
      currentPeriodEnd: { lte: now },
    },
  });

  for (const sub of due) {
    await billOne(sub);
  }
}

async function billOne(sub: Subscription): Promise<void> {
  // Use a deterministic idempotency key tied to the period — that way a
  // retry never double-charges the customer.
  const periodKey = `${sub.id}_${sub.currentPeriodEnd}`;
  try {
    const payment = await client.payments.create({
      amount: sub.amount,
      currency: sub.currency,
      customer: sub.customerId,
      method: { type: 'mpesa', mpesa: { phone: (await getCustomer(sub.customerId)).phone } },
      description: `Subscription ${sub.planId} — period ${periodKey}`,
      idempotency_key: `sub_${periodKey}`,
    });

    if (payment.status === 'succeeded') {
      // Advance the period.
      const next = sub.interval === 'monthly'
        ? sub.currentPeriodEnd + 30 * 24 * 60 * 60 * 1000
        : sub.currentPeriodEnd + 365 * 24 * 60 * 60 * 1000;
      await db.subscriptions.update(sub.id, {
        currentPeriodEnd: next,
        status: 'active',
        failedAttempts: 0,
      });
    } else {
      await markPastDue(sub);
    }
  } catch (err) {
    // Retryable errors (network, 429, 5xx) are auto-retried by the SDK.
    // If we get here, the charge definitively failed.
    console.error('billing failed', sub.id, err);
    await markPastDue(sub);
  }
}

async function markPastDue(sub: Subscription): Promise<void> {
  const failedAttempts = sub.failedAttempts + 1;
  // Give up after 4 attempts → cancel.
  const status = failedAttempts >= 4 ? 'canceled' : 'past_due';
  await db.subscriptions.update(sub.id, { status, failedAttempts });

  if (status === 'canceled') {
    await emailCustomerCancellation(sub.customerId);
  } else {
    // Schedule a retry in 3 days using exponential backoff.
    const retryAt = Date.now() + 3 * 24 * 60 * 60 * 1000 * failedAttempts;
    await db.subscriptions.update(sub.id, { currentPeriodEnd: retryAt });
  }
}
```

## 5. Schedule the worker

```ts
// Run billing every hour.
setInterval(billSubscriptions, 60 * 60 * 1000);

// Or, in production, use cron / BullMQ:
//   cron: '0 * * * *'  → top of every hour
//   BullMQ: queue.add('bill', {}, { repeat: { every: 60 * 60 * 1000 } })
```

## 6. Webhook reconciliation

Even with the billing worker, you should also handle `payment.failed`
webhooks to mark a subscription past_due immediately (the worker only
runs hourly):

```ts
async function handleEvent(event: PaySwapEvent): Promise<void> {
  switch (event.type) {
    case 'payment.succeeded': {
      const payment = event.data.object;
      const subId = payment.metadata?.subscriptionId as string | undefined;
      if (subId) await db.subscriptions.update(subId, { status: 'active', failedAttempts: 0 });
      break;
    }
    case 'payment.failed': {
      const payment = event.data.object;
      const subId = payment.metadata?.subscriptionId as string | undefined;
      if (subId) {
        const sub = await db.subscriptions.get(subId);
        await markPastDue(sub);
      }
      break;
    }
  }
}
```

## 7. Customer-facing flows

| Flow                  | Endpoint                | Notes                                        |
|-----------------------|-------------------------|----------------------------------------------|
| Subscribe             | `POST /payments`        | First-period charge + create subscription.   |
| Cancel                | Your DB                 | Set `status='canceled'`. Don't refund.       |
| Refund (within 7d)    | `POST /payments/{id}/refund` | Use sparingly; consider prorating.     |
| Upgrade / downgrade   | Your DB                 | Update `planId`; next billing uses new amount. |
| Pause                 | Your DB                 | Set `status='paused'`; skip in worker.       |

## 8. Production checklist

- [ ] Move `processedEventIds` to Redis / DB.
- [ ] Replace `setInterval` with a real job runner (BullMQ / Temporal).
- [ ] Add monitoring on `past_due` count.
- [ ] Send dunning emails on each `payment.failed`.
- [ ] Send receipt emails on each `payment.succeeded`.
- [ ] Add a customer self-serve portal (cancel / update phone).
- [ ] Track MRR / churn in your analytics.
- [ ] Handle tax (VAT in Kenya is 16% — include or exclude as appropriate).

## Idempotency is critical

The single most important rule in this example: **every recurring charge
must use a deterministic idempotency key tied to (subscription_id, period)**.
This protects you against:

- The billing worker running twice in the same minute.
- A webhook firing while the worker is mid-charge.
- A network retry on the same `create` call.

```ts
idempotency_key: `sub_${sub.id}_${sub.currentPeriodEnd}`
```

If the worker re-runs the same period, PaySwap returns the original
payment instead of creating a duplicate.

## Related

- [Payments guide](../../docs/payments.md) — full payment API surface.
- [Webhooks guide](../../docs/webhooks.md) — signature verification.
- [Checkout integration](../checkout-integration/) — one-shot checkout flow.
