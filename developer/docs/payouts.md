# Payouts

A payout moves money **from** your merchant account **to** a destination
(customer, vendor, partner). Payouts are the inverse of payments.

## Payout lifecycle

```
   create()         process()        (settled on-chain / on-rail)
   ──────────►  pending  ──────────►  in_transit  ──────────►  paid
                  │                       │
                  │ canceled              │ failed
                  ▼                       ▼
               canceled                 failed
```

| Status      | Meaning                                                |
|-------------|--------------------------------------------------------|
| `pending`   | Payout created, awaiting `process()` to execute.       |
| `in_transit`| Payout submitted to the rail (M-Pesa / bank / chain).  |
| `paid`      | Funds arrived at the destination.                      |
| `failed`    | Rail returned an error.                                |
| `canceled`  | Merchant canceled before `process()`.                  |

## Destinations

A payout destination describes where the money goes. Each destination type
has its own fields:

| Type    | Required fields         | Optional fields |
|---------|-------------------------|-----------------|
| `mpesa` | `phone`                 | —               |
| `bank`  | `account`, `bank`       | —               |
| `crypto`| `address`, `chain`      | `asset`         |

```ts
const destinations = [
  { type: 'mpesa', phone: '+254700000001' },
  { type: 'bank',  account: '0123456789', bank: 'KCB' },
  { type: 'crypto', address: 'GABC...', chain: 'stellar', asset: 'USDC:GA5Z...' },
];
```

## Create a payout

```ts
const payout = await client.payouts.create({
  amount: 50_000,
  currency: 'KES',
  destination: { type: 'mpesa', phone: '+254700000001' },
  reference: 'WITHDRAWAL-001',
  description: 'May 2025 vendor settlement',
});
```

The payout is created in `pending` state. **No money has moved yet** —
you must explicitly `process` it.

## Process a payout

```ts
await client.payouts.process(payout.id);
```

`process()` submits the payout to the rail and returns the updated payout
object. The status transitions `pending` → `in_transit` → `paid` (or
`failed`).

> **Idempotency**: `process()` is idempotent. If you call it twice with
> the same payout id, the second call is a no-op. Safe to retry on network
> failure.

## Cancel a payout

You can cancel a payout that's still in `pending`:

```bash
POST /payouts/{id}/cancel
```

Once a payout is `in_transit`, it can no longer be canceled — the rail
already has the instruction.

## List payouts

```ts
const list = await client.payouts.list({ limit: 25 });
for (const p of list.data) console.log(p.id, p.status, p.amount);
```

Filters: `limit`, `starting_after`, `ending_before`, `status`.

## Scheduling

PaySwap does not currently schedule payouts server-side. To run a payout
on a schedule, use a job runner (cron, BullMQ, Temporal, …) and call
`create()` + `process()` from your job handler.

A typical batch-payout flow:

```ts
// 1. Pull the day's pending payouts from your DB.
const pending = await db.payouts.findMany({ where: { status: 'queued' } });

// 2. Create + process each one via PaySwap.
for (const p of pending) {
  const payout = await client.payouts.create({
    amount: p.amount,
    currency: p.currency,
    destination: p.destination,
    idempotency_key: `batch_${p.id}`, // protects against retries
  });
  await client.payouts.process(payout.id);

  // 3. Update your DB.
  await db.payouts.update({ where: { id: p.id }, data: { payswapId: payout.id } });
}
```

## Fees

PaySwap charges a per-payout fee that varies by rail and currency. Fees
are deducted from your merchant balance (not from the payout amount) and
visible in the [ledger](./../openapi/openapi.yaml). The `payout` object
does not include a `fee` field — query `GET /ledger/accounts` for fee
totals.

## Webhook events

| Event type        | Fired when …                          |
|-------------------|---------------------------------------|
| `payout.created`  | Payout object created.                |
| `payout.processed`| Payout moved to `in_transit`.         |
| `payout.paid`     | Funds arrived at the destination.     |
| `payout.failed`   | Rail returned an error.               |
| `payout.canceled` | Payout canceled before processing.    |

## Errors specific to payouts

| Status | Code                  | Cause                                       |
|--------|-----------------------|---------------------------------------------|
| 400    | `amount_invalid`      | `amount` ≤ 0 or non-integer.                |
| 400    | `destination_invalid` | Required fields missing for the type.       |
| 402    | `insufficient_balance`| Merchant balance too low.                   |
| 409    | `payout_not_cancellable` | Payout already `in_transit` / `paid`.    |
| 422    | `rail_unavailable`    | Connector down (M-Pesa / bank / chain).     |

For `rail_unavailable`, the SDK auto-retries up to `maxRetries`. If all
retries fail, the payout stays in `pending` and you can call `process()`
again later.

## Reconciliation

Every paid payout appears in the merchant ledger as a debit. Use the
[trial balance](../openapi/openapi.yaml) endpoint to reconcile payouts
against your bank statements:

```ts
const tb = await fetch(`${baseUrl}/ledger/trial-balance`, {
  headers: { Authorization: `Bearer ${apiKey}` },
}).then(r => r.json());
```

See [Errors](./errors.md) and [Rate limits](./rate-limits.md).
