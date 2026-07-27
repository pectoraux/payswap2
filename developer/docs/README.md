# PaySwap developer documentation

Welcome to the PaySwap developer hub. PaySwap is a settlement and payments
network built on Stellar and M-Pesa for African fintechs.

## Get started

| Resource                                  | Audience                          |
|-------------------------------------------|-----------------------------------|
| [Quickstart](./quickstart.md)             | First-time integrators.           |
| [Authentication](./authentication.md)     | Setting up API keys + scopes.     |
| [OpenAPI spec](../openapi/openapi.yaml)   | Machine-readable API contract.    |
| [TypeScript SDK](../sdk/typescript/)      | Drop-in typed client for TS/JS.   |
| [CLI](../cli/)                            | Command-line tool for ops.        |

## Guides

| Guide                                  | What you'll learn                                |
|----------------------------------------|--------------------------------------------------|
| [Payments](./payments.md)              | Create, capture, refund, list.                   |
| [Payouts](./payouts.md)                | Send money to customers and vendors.             |
| [Webhooks](./webhooks.md)              | Subscribe to events + verify signatures.         |
| [Compliance](./compliance.md)          | Sanctions / PEP screening, audit export.         |
| [Errors](./errors.md)                  | Error envelope, SDK hierarchy, retry strategy.   |
| [Rate limits](./rate-limits.md)        | Quotas, headers, backoff, burst behaviour.       |

## Examples

| Example                                       | Stack                |
|-----------------------------------------------|----------------------|
| [Checkout integration](../examples/checkout-integration/)  | Next.js + SDK        |
| [Webhook handler](../examples/webhook-handler/)            | Node.js + Express    |
| [Recurring billing](../examples/recurring-billing/)        | Node.js + SDK        |

## Base URLs

| Environment | Base URL                                  |
|-------------|-------------------------------------------|
| Production  | `https://api.payswap.io/v1`               |
| Sandbox     | `https://api.sandbox.payswap.io/v1`       |
| Local dev   | `http://localhost:3000/api`               |

## API key prefixes

| Prefix       | Environment | Use case                              |
|--------------|-------------|---------------------------------------|
| `psk_live_`  | production  | Server-to-server, full access.        |
| `psk_test_`  | sandbox     | Server-to-server, simulated rails.    |
| `pk_live_`   | production  | Browser / mobile, payment-create only.|
| `pk_test_`   | sandbox     | Browser / mobile, sandbox.            |

## Status & support

- **API status**: <https://status.payswap.io>
- **Support email**: <developers@payswap.io>
- **Issue tracker**: <https://github.com/payswap/payswap/issues>
- **Discord**: <https://discord.gg/payswap>

## Changelog

API changes are announced in the [changelog](https://docs.payswap.io/changelog).
The API is versioned via the URL prefix (`/v1`); breaking changes ship
under a new prefix (`/v2`).
