# Authentication

The PaySwap API uses **bearer-token** authentication. Every request must
include an `Authorization` header with a valid API key.

```http
Authorization: Bearer psk_live_abc123...
```

## API key formats

PaySwap API keys are prefixed so you can tell at a glance whether a key is
production-grade or sandbox-only:

| Prefix       | Environment | Description                                          |
|--------------|-------------|------------------------------------------------------|
| `psk_live_`  | production  | Live key — moves real money. Treat like a password. |
| `psk_test_`  | sandbox     | Test key — exercises the full API on simulated data. |
| `pk_live_`   | production  | Publishable live key — for client-side (browser) use. Limited to read-only + payment-create. |
| `pk_test_`   | sandbox     | Publishable test key — sandbox equivalent of `pk_live_`. |

Keys are 48 random characters after the prefix. They never expire unless
rotated or revoked.

## Scopes

Each key has one or more scopes. The default scopes for a new secret key are
`payments:read`, `payments:write`, and `webhooks:read`. You can request
additional scopes when creating a key:

| Scope             | Description                                  |
|-------------------|----------------------------------------------|
| `payments:read`   | Read payments.                               |
| `payments:write`  | Create / capture / refund payments.          |
| `payouts:read`    | Read payouts.                                |
| `payouts:write`   | Create / process / cancel payouts.           |
| `customers:read`  | Read customers.                              |
| `customers:write` | Create / update customers.                   |
| `products:read`   | Read products.                               |
| `products:write`  | Create / update products.                    |
| `invoices:read`   | Read invoices.                               |
| `invoices:write`  | Create / send invoices.                      |
| `webhooks:read`   | Read webhook endpoints + deliveries.         |
| `webhooks:write`  | Create endpoints, trigger replays.           |
| `merchant:read`   | Read the current merchant.                   |
| `merchant:write`  | Update the current merchant.                 |
| `compliance:read` | Read compliance audit log.                   |
| `compliance:write`| Trigger screenings / exports.                |
| `treasury:read`   | Read treasury positions.                     |
| `treasury:write`  | Trigger rebalancing.                         |
| `ledger:read`     | Read ledger accounts / trial balance.        |
| `ledger:write`    | Trigger reconciliation.                      |
| `ops:read`        | Read ops health / metrics / overview.        |

A request that requires a scope the key doesn't have returns `403` with
`code=insufficient_scope`.

## Managing keys

Keys are managed in the [dashboard](https://dashboard.payswap.io/api-keys)
or via the API (use the master key returned during onboarding).

### Rotate a key

Rotation issues a new key with the same scopes and label, then keeps the
old key active for a grace period (default 24h). This lets you roll out
the new key without dropping in-flight requests.

```bash
POST /api-keys/{key_id}/rotate
```

### Revoke a key

Revocation takes effect immediately. Use it when a key is suspected
compromised.

```bash
POST /api-keys/{key_id}/revoke
```

## Keeping keys safe

- **Never** hard-code keys in source files. Use a secret manager or
  environment variables.
- **Never** ship a `psk_live_` key in a client-side (browser / mobile)
  app. Use a `pk_live_` publishable key for client-side flows.
- **Do** rotate keys at least every 90 days.
- **Do** set up alerts for `401` spikes — that often means a key is about
  to expire or has been revoked.
- **Do** scope keys narrowly. A checkout microservice only needs
  `payments:write` + `customers:read`, not full merchant admin.

## SDK configuration

The SDK reads the API key from the constructor:

```ts
const client = new PaySwapClient({
  apiKey: process.env.PAYSWAP_API_KEY!,
});
```

To switch environments, change the API key **and** the `baseUrl`:

```ts
const sandbox = new PaySwapClient({
  apiKey: 'psk_test_...',
  baseUrl: 'https://api.sandbox.payswap.io/v1',
});

const production = new PaySwapClient({
  apiKey: 'psk_live_...',
  baseUrl: 'https://api.payswap.io/v1',
});
```

## Authentication errors

| Status | Code                       | Cause                                              |
|--------|----------------------------|----------------------------------------------------|
| 401    | `authentication_error`     | Missing / malformed `Authorization` header.        |
| 401    | `invalid_api_key`          | Key not found, revoked, or expired.                |
| 403    | `insufficient_scope`       | Key lacks the scope required by the endpoint.      |
| 403    | `key_environment_mismatch` | Using a `psk_test_` key against the live base URL. |

All of these are non-retryable. See [Errors](./errors.md).
