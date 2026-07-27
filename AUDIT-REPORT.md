# PaySwap — Full Repository Audit Report

> **Auditor**: Independent review agent
> **Date**: 2026-07-25
> **Scope**: Entire repository (`src/`, `prisma/`, `developer/`, `deploy/`, `certification/`)
> **Method**: File-by-file reading, cross-reference search, runtime-wiring verification
> **Stance**: Brutally honest. This audit drives the rebuild plan.

---

## 0. One-Sentence Verdict

> **PaySwap is a 70,000-line single-page demo with no authentication, no PostgreSQL, no real navigation, and no persistent domain state — dressed up in 20 protocol modules (most of which are dead code or duplicate `v1`/`v2` implementations) and accompanied by self-authored "certification" reports that grade subsystems "Ready" while simultaneously admitting a Critical cross-merchant authorization vulnerability that makes the API unsafe to expose.**

---

## 1. Current Architecture

### 1.1 What actually exists (verified by tracing imports)

```
src/
├── app/                      ← Next.js 16 app router
│   ├── layout.tsx            (44 LOC)   root shell: fonts + ThemeProvider + Sonner
│   ├── page.tsx              (1,719 LOC) THE ENTIRE UI — one page, 7 tabs
│   ├── globals.css           (122 LOC)  shadcn theme tokens, no custom design system
│   └── api/                  (29 route.ts files)
│       ├── merchant/         (4 routes)  ← the only "product" surface
│       ├── treasury-v2/      (1 route)   ← orphan, no UI consumes it
│       ├── treasury/         (1 route)
│       ├── ledger/           (2 routes)
│       ├── ops/              (3 routes)
│       ├── persistence/      (4 routes)
│       ├── compliance/       (1 route)   status-only
│       ├── resilience/       (1 route)
│       ├── developer/        (1 route)   sandbox-only
│       ├── dr/               (1 route)
│       ├── scenarios/        (2 routes)  ← uses Prisma
│       ├── simulate/         (1 route)   ← uses Prisma
│       ├── supply-chain/     (1 route)
│       ├── infrastructure/   (1 route)
│       ├── fuzz/             (1 route)
│       ├── validation/       (1 route)
│       ├── protocol/         (1 route)
│       ├── metrics/          (1 route)
│       └── route.ts          ← returns {"message":"Hello, world!"} placeholder
├── kernel/                   (50 files)  frozen "Global Liquidity OS" engine
├── protocol/                 (20 modules, ~150 files) domain layer
├── components/
│   ├── ui/                   (48 shadcn primitives) ← mostly unused
│   └── simulator/            (22 components)        ← ALL DEAD CODE except theme-toggle
├── hooks/                    use-mobile.ts, use-toast.ts
└── lib/                      db.ts (Prisma client), utils.ts (cn helper)
```

### 1.2 Layer claims vs reality

| Layer | Claimed | Reality |
|-------|---------|---------|
| **Kernel** ("frozen, 7 primitives") | Generic distributed-state OS | 50 files, 1,073 LOC `types.ts` alone; heavily PaySwap-coupled (reserves, LPs, treasury in kernel). The earlier `AUDIT-REPORT.md` (Phase 1) already flagged this. |
| **Protocol** ("20 modules") | Production financial network | 20 folders exist, but only **7 are reachable from any API route**: `merchant/`, `payouts/`, `twin-token/`, `webhooks/`, `qr/`, `ledger/`, `treasury/` (v1). The other 13 are dead code or demo-only. |
| **Application** | Merchant platform | A single 1,719-LOC `page.tsx` with 7 hardcoded tabs. No routing, no auth, no signup. |

---

## 2. Application Modules

### 2.1 Modules that are actually wired to the UI/API

| Module | Files | LOC | Persisted? | Used by UI? |
|--------|-------|-----|------------|-------------|
| `merchant/platform.ts` (v1) | 1 | 541 | ❌ In-memory `Map` | ✅ via `/api/merchant/*` |
| `payouts/payout-service.ts` | 1 | 434 | ❌ In-memory `Map` | ✅ via `/api/merchant/payout` |
| `twin-token/engine.ts` | 1 | ~400 | ❌ In-memory `Map` | ✅ via `/api/merchant/state` |
| `webhooks/engine.ts` | 1 | ~300 | ❌ In-memory `Map` | ✅ |
| `qr/qr-service.ts` | 1 | ~250 | ❌ In-memory `Map` | ✅ |
| `ledger/engine.ts` | 1 | ~400 | ❌ In-memory | ✅ via `/api/ledger/*` |
| `treasury.ts` (v1) | 1 | 180 | ❌ In-memory | ✅ via `/api/treasury/status` |

### 2.2 Modules that exist but are NOT wired to anything reachable

| Module | LOC | Status |
|--------|-----|--------|
| `merchant-v2/` (12 files) | 3,736 | Dead. Not imported by any API route. |
| `wallets-v2/` (12 files) | 4,272 | Dead. Not imported by any API route. |
| `connectors-v2/` (16 files) | 2,122 | Dead. Not imported by any API route. |
| `providers/` (16 files) | 4,357 | Dead. Not imported by any API route. |
| `treasury-v2/` (11 files) | 3,465 | Half-dead. Only `/api/treasury-v2/status` reads it. No UI consumes it. |
| `compliance/` (13 files) | ~3,000 | Half-dead. Only `/api/compliance/status` returns counts. No KYC submission API, no sanctions screening endpoint. |
| `disaster-recovery/` (10 files) | ~3,500 | Dead. Only `/api/dr/status` returns a static config. |
| `observability/` (10 files) | ~3,500 | Dead. Not imported by any API route. |
| `ops/` (5 files) | ~1,800 | Partially used — only metrics/alerts/SLO counts. |
| `resilience/` (6 files) | ~1,000 | Half-dead. Only `/api/resilience/health` reads it. |
| `deployment/` (7 files) | ~2,000 | Dead. Not imported anywhere. |
| `developer/` (4 files) | ~600 | Dead. Only `/api/developer/sandbox` returns a stub. |
| `chains/` (8 files) | 3,167 | Partially imported by `treasury-v2/status`. Not used for real chain ops. |
| `blockchains/` (1 file) | 275 | Legacy duplicate of `chains/stellar/`. |
| `economics/` (6 files) | ~1,200 | Dead. Not imported by any API route. |
| `settlement/` (7 files) | ~2,000 | Dead. Not imported by any API route. |
| `persistence/` (3 files) | ~500 | Used — but only persists the **event stream**, not domain state. See §5.2. |

**Roughly 60–70% of the protocol layer is dead code** — written, never wired, never tested in a running server.

---

## 3. Missing Product Features

Compared to a real fintech platform (Stripe / Shopify Payments / Mercury / Wise):

| Feature | Stripe | Mercury | Wise | PaySwap | Severity |
|---------|--------|---------|------|---------|----------|
| Merchant signup flow | ✅ | ✅ | ✅ | ❌ Hardcoded "Acme Ghana Market" auto-bootstrap | **Critical** |
| User authentication (email/password, OAuth, SSO) | ✅ | ✅ | ✅ | ❌ None | **Critical** |
| Multi-user organizations / RBAC | ✅ | ✅ | ✅ | ❌ `merchant-v2/team.ts` exists but is dead code | **Critical** |
| KYC / KYB document upload | ✅ | ✅ | ✅ | ❌ `compliance/kyc.ts` exists but no upload API | **Critical** |
| Bank account linking (plaid/etc.) | ✅ | ✅ | ✅ | ❌ None | **High** |
| Card issuing / virtual cards | ✅ | ✅ | — | ❌ None | Medium |
| Payment intents / checkout sessions | ✅ | — | ✅ | ❌ QR generation only, no hosted checkout page | **High** |
| Subscription billing engine | ✅ | — | — | ❌ `merchant-v2/subscriptions.ts` (472 LOC) is dead code | **High** |
| Dispute management / chargebacks | ✅ | — | ✅ | ❌ `settlement/disputes.ts` is dead code | **High** |
| Reporting / statements / exports | ✅ | ✅ | ✅ | ❌ None | **High** |
| Tax / VAT handling | ✅ | — | — | ❌ None | Medium |
| Multi-currency wallets (real) | ✅ | ✅ | ✅ | ❌ TWIN tokens are simulated, no real fiat custody | **Critical** |
| ACH / SEPA / wire transfers | ✅ | ✅ | ✅ | ❌ None | **High** |
| Invoicing (send, track, reminders) | ✅ | — | ✅ | ⚠️ `merchant/platform.ts` has draft/sent/paid states but no email delivery | Medium |
| Customer portal | ✅ | — | — | ❌ None | Medium |
| Admin / ops console | ✅ | ✅ | ✅ | ❌ None (the single page is merchant-only) | **High** |
| Audit log UI | ✅ | ✅ | ✅ | ⚠️ Read-only event log in Events tab, no filter/search/export | Medium |
| Notification center (email/SMS/push) | ✅ | ✅ | ✅ | ❌ None | **High** |
| Settings page (profile, security, billing) | ✅ | ✅ | ✅ | ❌ None | **High** |
| API key management UI | ✅ | ✅ | ✅ | ⚠️ Read-only list, no create/revoke from UI (only via API) | Medium |
| Webhook retry / replay UI | ✅ | ✅ | ✅ | ❌ Read-only deliveries list | Medium |
| Sandbox / test mode | ✅ | ✅ | ✅ | ⚠️ `developer/sandbox.ts` exists but is dead code | Medium |
| Rate limiting | ✅ | ✅ | ✅ | ❌ `connectors-v2/rate-limiter.ts` exists but is dead code | **High** |
| Idempotency keys | ✅ | ✅ | ✅ | ❌ `connectors-v2/idempotency.ts` exists but is dead code | **High** |
| 2FA / MFA | ✅ | ✅ | ✅ | ❌ None | **High** |
| Activity log / login history | ✅ | ✅ | ✅ | ❌ None | Medium |

---

## 4. Duplicate Functionality

This is the single biggest code-quality problem. **Five separate module pairs overlap**, and in every case the `v1` is what the app actually uses while the `v2` is dead code.

| Pair | v1 LOC | v2 LOC | Which is used? | Recommendation |
|------|--------|--------|----------------|----------------|
| `treasury.ts` vs `treasury-v2/` | 180 | 3,465 | v1 (`/api/treasury/status`) | Delete v1, wire v2 — or delete v2 if v1 is sufficient |
| `wallets/wallet-service.ts` vs `wallets-v2/` | 278 | 4,272 | Neither (no wallet API route exists) | Pick one; the v2 (HD/MPC/custodial) is the production shape |
| `merchant/platform.ts` vs `merchant-v2/` | 541 | 3,736 | v1 only (`/api/merchant/*`) | v2 has subscriptions, OAuth, refunds, catalogs — but is dead code |
| `connectors-v2/` vs `providers/` | 2,122 | 4,357 | Neither is wired | `providers/` has real adapter shapes (Stripe, Flutterwave, Paystack…); `connectors-v2/` has the framework (retry, circuit breaker, idempotency). They should be ONE module. |
| `chains/` vs `blockchains/` | 2,892 | 275 | `chains/stellar/adapter.ts` imported by treasury-v2 status | `blockchains/stellar/adapter.ts` is a legacy duplicate |

**Total duplicate LOC: ~21,000 lines of dead or competing code.**

Additionally, the **kernel** carries its own duplication:
- `liquidity-planner.ts` (826 LOC) vs `planner.ts` — the previous audit flagged this as "superseded"
- `optimization-engine.ts` vs `planner.ts` — same
- `treasury-ai.ts` vs `treasury.ts` vs `treasury-v2/treasury.ts` — three treasury brains

---

## 5. Technical Debt

### 5.1 In-memory state masquerading as a persisted system — **Critical**

Every domain service stores state in process-memory:

```ts
// src/protocol/merchant/platform.ts
export class MerchantPlatform {
  private merchants = new Map<string, MerchantAccount>();   // ❌ lost on restart
  private apiKeys: ApiKey[] = [];                            // ❌ lost on restart
  private products = new Map<string, Product>();             // ❌ lost on restart
  private invoices = new Map<string, Invoice>();             // ❌ lost on restart
  ...
}
```

The same pattern repeats in **382 places** across `src/protocol/` (`new Map<>()` or `= []` as class fields). None of these services have a `hydrate()` / `load()` / `replay()` method that is ever called.

**Consequence**: Restart the server → every merchant, every payout, every wallet balance, every API key, every webhook endpoint, every QR code, every invoice — **gone**. The frontend `useEffect` will fail to find the `merchantId` it cached in `localStorage` and the user is silently re-bootstrapped to "Acme Ghana Market".

The `Reset` button on the dashboard explicitly acknowledges this: it clears `localStorage` and re-runs the entire demo bootstrap.

### 5.2 The "persistence" layer is a mirage — **Critical**

`src/protocol/persistence/event-store.ts` does persist events to the `EventRecord` Prisma table. **But:**

1. It only persists the **event stream** (the audit log), not the domain aggregates.
2. On startup, it hydrates `eventEngine.stream` (the in-memory event bus) — but **no service consumes those events to rebuild its own state**. `merchantPlatform.merchants` stays empty even after 1,000 `merchant.onboarded` events are loaded.
3. The `EventStore` constructor starts a `setInterval(flush, 2000)` — a 2-second polling flush. This means up to 2 seconds of events can be lost on crash.
4. The `db.custom.db` file is 40 MB — but it contains only simulation runs and the event audit log. Zero merchant rows, zero payout rows, zero wallet rows.

### 5.3 SQLite, not PostgreSQL — **High**

```prisma
datasource db {
  provider = "sqlite"        // ← not "postgresql"
  url      = env("DATABASE_URL")
}
```

`.env`:
```
DATABASE_URL=file:/home/z/my-project/db/custom.db
```

SQLite is single-writer, file-local, and not production-grade for a fintech. There are **no Prisma migrations** — only `prisma db push --accept-data-loss` (the `--accept-data-loss` flag is itself a red flag). The `deploy/terraform/rds.tf` file exists but is not connected to the actual app.

### 5.4 TypeScript build errors are silently ignored — **High**

```ts
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: true },   // ← swallows all type errors
  reactStrictMode: false,
};
```

This means the codebase could (and likely does) contain type errors that never surface. `reactStrictMode: false` also disables React's development safety checks.

### 5.5 The connector registry is a global that is never populated — **High**

```ts
// src/protocol/payouts/payout-service.ts:38
const CONNECTOR_REGISTRY: { openBanking?: any; mpesa?: any; exchangeRate?: any } =
  (globalThis as any).__PAYSWAP_CONNECTORS__ ?? {};
```

Nothing in the codebase ever sets `globalThis.__PAYSWAP_CONNECTORS__`. So every payout falls through to `simulatedEvidence()` — a hardcoded `createEvidence()` call. **No real bank transfer, no real M-Pesa B2C, no real Stellar payment has ever been executed by this codebase.**

### 5.6 Zero environment variables for real integrations — **Critical**

`.env` and `.env.local` contain only:
- `DATABASE_URL` (SQLite path)
- `VERCEL_OIDC_TOKEN`

There are **no** `STRIPE_SECRET_KEY`, `MPESA_CONSUMER_KEY`, `STELLAR_SECRET`, `FIREBLOCKS_API_KEY`, `CHAINALYSIS_API_KEY`, `PAYSTACK_SECRET_KEY`, etc. The 16 provider adapters in `src/protocol/providers/` are template code with no credentials.

### 5.7 Self-authored "certification" reports grade the system "Ready" while admitting Critical vulnerabilities — **High**

`certification/results/production-acceptance.md` claims:
> ✅ Ready: Ledger, Treasury, Connectors, Payouts, Compliance, Observability
> ❌ Not Ready: Security, Developer Platform

But the same report's "Critical Remediations" table lists **SEC-016: Add authentication to all merchant API endpoints — Critical — Without this, no API can be exposed.** A system with no authentication is not "Ready" by any reasonable definition — yet 7 of 13 subsystems are marked Ready.

`certification/results/security-review.md` documents **13 vulnerabilities (1 Critical, 7 High, 5 Medium)** found by self-run adversarial tests. None are remediated. The certification suite passes 17/17 checks that **it wrote for itself**.

### 5.8 Dead simulator UI — **Medium**

`src/components/simulator/` contains 22 components (entity-registry, financial-graph, scenario-library, constitution-panel, scenario-builder, lp-lifecycle, world-state, reasoning-panel, ai-reasoning, execution-graph, protocol-panel, runtime-services, state-machine-panel, replay-stepper, engines-panel, optimization-panel, protocol-scenarios, treasury-amendments, world-inspector, metrics-panel, solver-panel, execution-graph-dag). **Zero are imported by `page.tsx`** (only `theme-toggle.tsx` is). This is the leftover UI from a previous "kernel simulator" phase that was replaced by the merchant dashboard.

### 5.9 Unused shadcn primitives — **Low**

48 shadcn primitives are installed. `page.tsx` imports ~12 of them. The other 36 (carousel, command, context-menu, hover-card, menubar, navigation-menu, pagination, radio-group, slider, toggle-group, aspect-ratio, etc.) are dead weight.

### 5.10 The root API route is a placeholder — **Low**

```ts
// src/app/api/route.ts
export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}
```

### 5.11 No tests — **High**

- `tests/` contains two shell scripts (`python-runtime-build.sh`, `python-runtime-container.sh`) — not tests.
- `package.json` has no `test` script.
- No Jest, Vitest, Bun test, or Playwright configuration.
- The `certification/run.ts` script is a runtime smoke-test, not a unit/integration test suite — and it operates on fresh in-memory state, so it cannot catch persistence bugs.

### 5.12 No error tracking, no logging, no observability in the app layer — **Medium**

- No Sentry, Logflare, Datadog, or OpenTelemetry SDK initialized.
- `instrumentation.ts` exists but is empty.
- API routes use `console.error` in a few places. No structured logging.

---

## 6. UI Inconsistencies

### 6.1 Single 1,719-LOC page.tsx — **Critical**

The entire UI is one file. It contains:
- 14 inline interface declarations
- 8 inline subcomponents (`KpiCard`, `EmptyState`, `OpIcon`, `ArrowRight2`, `Lock2`, `Unlock2`, `MethodIcon`, `QrTypeIcon`, `CheckoutLinkCard`, `ReconRow`, `HeroCard`, `HeroStat`, `OverviewTab`, `CheckoutTab`, `PayoutsTab`, `CatalogTab`, `ApiTab`, `EventsTab`, `InfraTab`, `LoadingDashboard`)
- All state, all fetch logic, all rendering in one module

This is unmaintainable. There is no component library, no shared layout, no design tokens beyond shadcn defaults.

### 6.2 No app shell — **High**

`layout.tsx` is 44 lines: fonts, ThemeProvider, Sonner toaster. There is:
- ❌ No sidebar
- ❌ No top navigation bar (the header is inline in `page.tsx` and merchant-specific)
- ❌ No breadcrumb
- ❌ No user menu / account switcher
- ❌ No command palette
- ❌ No footer navigation

The shadcn `sidebar.tsx` component (726 LOC) is installed but **not used anywhere**.

### 6.3 No design system — **Medium**

`globals.css` is 122 lines of shadcn defaults. There is:
- ❌ No brand color tokens (every component hardcodes `emerald-500/15`, `teal-500`, `cyan-500`, `amber-500`, `rose-500` inline)
- ❌ No typography scale
- ❌ No spacing system
- ❌ No icon sizing convention
- ❌ No motion/animation tokens (framer-motion is used ad-hoc)

The visual style is "emerald-tinted dark dashboard" — consistent within `page.tsx` but not reusable.

### 6.4 QR code is a fake SVG — **Medium**

```ts
// src/app/page.tsx:269
function QrVisual({ payload, size = 200 }: ...) {
  // Deterministic QR-like SVG visual. Hashes the encoded payload into a 21x21 grid.
  ...
}
```

The "QR code" rendered in the Checkout tab is a **decorative SVG that hashes the payload into a 21×21 grid**. It is **not a scannable QR code**. A real fintech would use `qrcode` or `react-qr-code`.

### 6.5 Hosted checkout / payment links are fake URLs — **Medium**

```ts
const hostedUrl = `https://checkout.payswap.io/${m.id}/${generated?.id ?? 'preview'}`;
const linkUrl = `https://pay.payswap.io/p/${m.id}/${generated?.id ?? 'preview'}`;
```

These URLs are displayed to the user with a "Copy link" button, but **no such routes exist** in the app. Clicking them would 404.

---

## 7. Missing Backend APIs

### 7.1 What exists (29 routes)

| Category | Routes |
|----------|--------|
| Merchant | `onboard`, `state`, `payout`, `qr` |
| Ledger | `trial-balance`, `reconciliation` |
| Ops | `health`, `overview`, `metrics` |
| Persistence | `status`, `events`, `snapshots`, `rebuild` |
| Compliance | `status` (counts only) |
| Treasury | `status` (v1), `status` (v2) |
| Resilience | `health` |
| DR | `status` |
| Developer | `sandbox` |
| Simulation | `simulate`, `scenarios`, `regress`, `fuzz`, `validation`, `protocol`, `supply-chain`, `infrastructure` |

### 7.2 What is missing for a real product

| Endpoint group | Missing routes | Severity |
|----------------|----------------|----------|
| **Auth** | `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/2fa/setup`, `POST /auth/2fa/verify` | **Critical** |
| **Merchant onboarding** | `POST /onboarding/start`, `POST /onboarding/kyc/upload`, `POST /onboarding/business/verify`, `POST /onboarding/bank-account/link`, `POST /onboarding/complete` | **Critical** |
| **Payments** | `POST /payments` (create intent), `GET /payments/:id`, `POST /payments/:id/capture`, `POST /payments/:id/cancel`, `GET /payments` (list with filters) | **Critical** |
| **Checkout** | `POST /checkout/sessions`, `GET /checkout/sessions/:id`, `POST /checkout/confirm` | **Critical** |
| **Customers** | `GET/POST/PATCH/DELETE /customers`, `GET /customers/:id/payments` | High |
| **Subscriptions** | `GET/POST/PATCH/DELETE /subscriptions`, `POST /subscriptions/:id/pause`, `POST /subscriptions/:id/resume` | High |
| **Invoices** | `GET/POST/PATCH /invoices`, `POST /invoices/:id/send`, `POST /invoices/:id/reminder`, `GET /invoices/:id/pdf` | High |
| **Refunds** | `POST /refunds`, `GET /refunds`, `GET /refunds/:id` | High |
| **Disputes** | `GET /disputes`, `POST /disputes/:id/respond`, `POST /disputes/:id/accept` | High |
| **Payouts (proper)** | `GET /payouts` (with pagination), `GET /payouts/:id`, `GET /payouts/:id/events` — current `/api/merchant/payout` uses an `action` dispatcher anti-pattern | Medium |
| **Wallets** | `GET /wallets`, `POST /wallets/addresses`, `GET /wallets/:id/transactions` | High |
| **Bank accounts** | `GET/POST/DELETE /bank-accounts`, `POST /bank-accounts/verify` (micro-deposits) | High |
| **Cards** | `POST /cards/issue`, `GET /cards/:id`, `POST /cards/:id/freeze` | Medium |
| **Reports** | `GET /reports/transactions.csv`, `GET /reports/1099.json`, `GET /reports/statement.pdf` | High |
| **Webhooks (proper)** | `POST /webhooks/endpoints`, `GET/DELETE /webhooks/endpoints/:id`, `POST /webhooks/:id/test`, `POST /webhooks/deliveries/:id/replay` | Medium |
| **API keys (proper)** | `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/:id`, `POST /api-keys/:id/rotate` | High |
| **Team** | `GET/POST /team`, `PATCH/DELETE /team/:id`, `POST /team/invite/accept` | High |
| **Compliance** | `POST /compliance/kyc/submit`, `GET /compliance/kyc/status`, `POST /compliance/sanctions/screen` | High |
| **KYC document upload** | `POST /uploads/kyc` (multipart) | High |
| **Pagination / filtering** | Every list endpoint currently returns the full array. No `?cursor=`, `?limit=`, `?from=`, `?to=`, `?status=` | High |
| **Idempotency** | No `Idempotency-Key` header support anywhere | High |
| **Rate limiting** | No middleware | High |
| **Health (deep)** | `/api/ops/health` returns counts; no `/health/live`, `/health/ready`, `/health/startup` distinction | Medium |
| **Versioning** | No `/v1/` prefix, no `Accept: application/vnd.payswap.v1+json` | Medium |

### 7.3 The "action dispatcher" anti-pattern — **Medium**

```ts
// src/app/api/merchant/onboard/route.ts
export async function POST(req: NextRequest) {
  const action = body?.action as string;
  switch (action) {
    case 'onboard': ...
    case 'verify': ...
    case 'create_api_key': ...
    case 'setup_webhook': ...
    case 'create_product': ...
    case 'create_invoice': ...
    case 'send_invoice': ...
    case 'pay_invoice': ...
    case 'create_customer': ...
    case 'create_refund': ...
    case 'process_refund': ...
    case 'invite_team': ...
    case 'suspend': ...
    case 'analytics': ...
    case 'list_webhooks': ...
  }
}
```

A single `POST /api/merchant/onboard` endpoint dispatches 15 unrelated actions. This is not REST — it is RPC disguised as a URL. It makes OpenAPI generation, caching, rate-limiting, and authorization impossible to do correctly.

---

## 8. Missing Database Models

### 8.1 What exists (8 models, all for simulation)

| Model | Purpose |
|-------|---------|
| `SimulationRun` | Persisted kernel simulation results |
| `LedgerEntryRecord` | Ledger entries from a simulation run |
| `TwinTokenRecord` | Twin token mints/burns from a simulation run |
| `PlanAmendmentRecord` | Planner amendments from a simulation run |
| `AuditLog` | Audit entries from a simulation run |
| `SavedScenarioRecord` | Saved simulation scenarios |
| `User` | Stub — `id, email, name, timestamps`. No password, no role, no merchant link. Never written to. |
| `EventRecord` | Persisted event stream (the only "real" persistence) |
| `LedgerSnapshotRecord` | Ledger snapshot for fast replay |
| `CheckpointRecord` | Projection checkpoint |

**Every model except `EventRecord`/`LedgerSnapshotRecord`/`CheckpointRecord` is for the simulation engine, not for the product.**

### 8.2 What is missing for a real product

| Model | Purpose | Severity |
|-------|---------|----------|
| `Account` / `User` (real) | Email, password_hash, role, mfa_secret, last_login_at, email_verified_at | **Critical** |
| `Session` | Next-auth or custom session store | **Critical** |
| `Organization` | Multi-merchant org, billing entity | **Critical** |
| `OrganizationMember` | User ↔ Org link with role (owner/admin/developer/analyst/viewer) | **Critical** |
| `Merchant` (persisted) | Replace the in-memory `MerchantAccount` | **Critical** |
| `ApiKey` (persisted) | Replace the in-memory `ApiKey[]` | **Critical** |
| `Product` (persisted) | Replace the in-memory `Map` | **Critical** |
| `Customer` (persisted) | Replace the in-memory `Map` | **Critical** |
| `Invoice` + `InvoiceItem` (persisted) | Replace the in-memory `Map` | **Critical** |
| `Payment` / `PaymentIntent` | Does not exist at all | **Critical** |
| `Charge` | Does not exist | **Critical** |
| `Refund` (persisted) | Replace the in-memory `Map` | **Critical** |
| `Subscription` + `SubscriptionItem` | `merchant-v2/subscriptions.ts` exists but no model | High |
| `Payout` (persisted) | Replace the in-memory `Map` | **Critical** |
| `Wallet` + `WalletTransaction` | `wallets/wallet-service.ts` is in-memory only | **Critical** |
| `BankAccount` | Does not exist | High |
| `Card` | Does not exist | Medium |
| `WebhookEndpoint` (persisted) | Replace the in-memory array | **Critical** |
| `WebhookDelivery` (persisted) | Replace the in-memory array | High |
| `QrCode` (persisted) | Replace the in-memory map | High |
| `KycDocument` + `KycDossier` | `compliance/kyc.ts` is in-memory only | **Critical** |
| `SanctionsHit` | `compliance/sanctions.ts` is in-memory only | High |
| `AmlAlert` + `AmlCase` | `compliance/aml.ts`/`case-management.ts` in-memory only | High |
| `TreasuryPosition` + `TreasuryRecommendation` | `treasury.ts` in-memory only | High |
| `LiquidityPool` + `LpStake` | Does not exist as a model | High |
| `TwinTokenAsset` + `TwinTokenBalance` + `TwinTokenOperation` | `twin-token/engine.ts` in-memory only | **Critical** |
| `ConnectorInvocation` | For audit/retry of provider calls | High |
| `IdempotencyRecord` | For safe retries | High |
| `AuditEvent` (domain-level, not simulation) | Currently `AuditLog` is simulation-scoped | High |
| `Notification` + `NotificationPreference` | Does not exist | Medium |
| `Report` + `Statement` | Does not exist | Medium |
| `FeatureFlag` | `deployment/feature-flags.ts` is in-memory | Medium |

**The database has ~3 production-grade models and needs ~30.**

---

## 9. Missing Permissions / Authentication / RBAC — **CRITICAL**

### 9.1 Authentication: zero

- `next-auth` is in `package.json` but **never imported anywhere** in `src/`.
- No `middleware.ts` exists.
- No `getServerSession`, `useSession`, `signIn`, `signOut` calls anywhere.
- No `Authorization` header parsing in any API route.
- No cookie-based session.
- No JWT issuance or verification.

**Any client can call any API route.** The `merchantId` is taken directly from the request body or query string with zero verification that the caller owns that merchant.

### 9.2 Authorization: the SEC-016 Critical vulnerability

From the project's own security review (`certification/results/security-review.md`):

> **SEC-016 — Cross-merchant access: read another merchant's data — ❌ FAIL — Critical**
> `getApiKeys(alice.id)` returned 1 keys. `getAnalytics` returned data. The platform does NOT verify caller identity or merchant membership.

Every `GET /api/merchant/state?merchantId=X` returns the full state of merchant X regardless of who is asking. If you know a merchant ID, you own it.

### 9.3 RBAC: dead code

`merchant-v2/team.ts` (274 LOC) defines roles (`owner`, `admin`, `developer`, `analyst`) and `inviteTeamMember`. **It is never imported by any API route.** The `merchant/platform.ts` (v1) version of `inviteTeamMember` accepts any role with no caller verification — SEC-017 (High).

### 9.4 API key scopes: advisory only

`ApiKey.scopes` is a `string[]` like `['payments:write', 'payments:read']`. **No code anywhere checks scopes.** SEC-015 (High): a read-only key can perform writes.

### 9.5 What is needed

| Layer | Requirement | Status |
|-------|-------------|--------|
| **Session auth** | Email/password + OAuth (Google/GitHub) + 2FA | ❌ None |
| **API key auth** | `Authorization: Bearer psk_live_...` parsed on every request | ❌ None |
| **Middleware** | Next.js `middleware.ts` protecting `/api/*` and `/dashboard/*` | ❌ None |
| **Tenant isolation** | Every query scoped by `merchantId` derived from auth, not from request body | ❌ None |
| **RBAC** | Role-based scopes enforced per endpoint | ❌ Dead code only |
| **Audit** | Every state-changing API call writes an `AuditEvent` with caller identity | ❌ None |
| **Rate limiting** | Per-key and per-IP limits | ❌ None |
| **IP allowlisting** | For admin endpoints | ❌ None |

---

## 10. Missing Navigation — **Critical**

### 10.1 There is no navigation

- One page: `/` (`src/app/page.tsx`).
- No `/login`, `/signup`, `/dashboard`, `/payments`, `/payouts`, `/customers`, `/settings`, `/api-keys`, `/webhooks`, `/developers`, `/reports`, `/admin` routes.
- The "navigation" is a single `<Tabs>` with 7 tabs: Overview, Checkout, Payouts, Catalog, API & Webhooks, Events, Infra.
- The header has two buttons: `Refresh` and `Reset` (the latter re-bootstraps the demo).

### 10.2 What a real fintech nav looks like

```
Sidebar:
  Dashboard
  Payments
  Payouts
  Customers
  Subscriptions
  Invoices
  Disputes
  Reports
  Developers (API keys, webhooks, sandbox, logs)
  Settings (profile, business, team, security, notifications)

Top bar:
  Merchant switcher
  Search
  Notifications bell
  User menu (profile, logout)
```

None of this exists.

### 10.3 The shadcn `sidebar.tsx` (726 LOC) is installed but never imported.

---

## 11. Missing Mobile Layouts — **High**

### 11.1 What exists

`page.tsx` uses Tailwind responsive prefixes in 33 places (`sm:`, `md:`, `lg:`, `xl:`). The layout is "desktop-first with some grid collapses":

- KPI cards: `grid md:grid-cols-4` → stacks on mobile ✅
- Tabs: wrapped in `<ScrollArea className="w-full whitespace-nowrap">` → horizontal scroll on mobile ⚠️
- Header: hides the "Available balance" on `< md`, hides button labels on `< sm` ⚠️
- Payout form: `lg:grid-cols-3` → stacks on smaller screens ✅
- QR visual: 220px fixed — fine on mobile ✅

### 11.2 What is missing

- ❌ No bottom navigation bar (mobile fintech standard)
- ❌ No mobile-specific layouts (drawers, sheets, bottom sheets)
- ❌ No touch-optimized form controls
- ❌ No mobile onboarding flow
- ❌ No PWA / installable web app manifest
- ❌ No safe-area insets for notched phones
- ❌ Tab labels hidden on mobile (icons only) — but the tabs themselves scroll horizontally, which is awkward with 7 tabs
- ❌ The "Reset" and "Refresh" buttons in the header are tiny on mobile
- ❌ No mobile gesture support (pull-to-refresh, swipe between tabs)

`src/hooks/use-mobile.ts` exists but is **never used** in `page.tsx`.

---

## 12. Missing Error Handling — **High**

### 12.1 API layer

| Issue | Severity |
|-------|----------|
| Routes catch errors and return `{ error: 'server_error', message: err.message }` with status 500 — but `err.message` leaks internal details | Medium |
| No error code taxonomy (e.g., `MERCHANT_NOT_FOUND`, `INSUFFICIENT_BALANCE`, `RATE_LIMITED`) — just strings | High |
| No structured error response (no `code`, `docs_url`, `request_id`) | High |
| No `try/catch` around `merchantPlatform.onboard()` etc. in some paths | Medium |
| No 401/403 responses (because there is no auth) | **Critical** |
| No 429 rate-limit responses | High |
| No 422 validation-error responses with field-level details (just `missing_fields` + array) | Medium |
| No request ID / correlation ID in responses | Medium |
| No global `app/error.tsx` or API error handler | High |

### 12.2 UI layer

- ❌ No `app/error.tsx` (Next.js error boundary)
- ❌ No `app/not-found.tsx`
- ❌ No `app/global-error.tsx`
- ❌ No `Suspense` boundaries
- ❌ `fetch()` calls in `page.tsx` use `.catch(() => null)` in the InfraTab — **silently swallows errors and renders `null`**, making failures invisible
- ❌ The bootstrap `useEffect` shows a `toast.error` on failure but the UI stays in the `LoadingDashboard` skeleton forever (no retry button, no error state)
- ⚠️ `toast.error` is used in ~10 places — decent for action feedback, but not a substitute for inline error states

---

## 13. Missing Loading States — **Medium**

### 13.1 What exists

- `LoadingDashboard` (skeleton block) — shown on initial mount
- `InfraTab` shows 4 skeleton cards while fetching
- `Loader2` spinner icon in buttons (Refresh, Reset, Generate QR, Withdraw, Quote)
- `Skeleton` component imported and used in 2 places

### 13.2 What is missing

- ❌ No `app/loading.tsx` for route-level suspense
- ❌ No skeleton for the Overview, Checkout, Payouts, Catalog, API, Events tabs — they render `null` while `state` is loading
- ❌ No suspense boundaries around async data
- ❌ No progressive loading (skeleton → partial data → full data)
- ❌ No optimistic updates (every mutation calls `refresh()` which re-fetches the entire dashboard)
- ❌ No `useTransition` / `useDeferredValue` for input-heavy forms
- ❌ No stale-while-revalidate (TanStack Query is installed but **never used** — all data fetching is raw `fetch()` in `useEffect`)

---

## 14. Missing Empty States — **Low** (best-in-class section)

### 14.1 What exists

The `EmptyState` component is used in 8+ places:
- No balances yet
- No operations yet
- No customers yet
- No payouts yet
- No API keys
- No webhooks configured
- No deliveries yet
- No QR generated yet
- No events yet
- No active alerts

This is genuinely the best-handled section of the UI.

### 14.2 What is missing

- ❌ No empty state for "no merchant selected" (because there's only ever one hardcoded merchant)
- ❌ No empty state for the Catalog tab when there are zero products
- ❌ No illustrations (just an icon in a circle)
- ❌ No "create your first X" CTA buttons in the empty states (the hint text tells the user what to do, but there's no button)

---

## 15. Missing Onboarding — **Critical**

### 15.1 What exists

```ts
// src/app/page.tsx:461
const bootstrap = useCallback(async (): Promise<string> => {
  const name = 'Acme Ghana Market';
  const email = 'ops@acme-gh.example';
  const country = 'Ghana';
  const currency = 'GHS';
  const onb = await fetch('/api/merchant/onboard', {
    method: 'POST', ...
    body: JSON.stringify({ action: 'onboard', name, email, country, currency }),
  });
  ...
  await fetch('/api/merchant/onboard', { ... action: 'verify', merchantId: id, bond: 5000 });
  await fetch('/api/merchant/onboard', { ... action: 'setup_webhook', ... });
  await fetch('/api/merchant/onboard', { ... action: 'create_api_key', ... });
  await fetch('/api/merchant/onboard', { ... action: 'create_product', ... });
  ...
}, []);
```

The "onboarding" is a **hardcoded bootstrap that creates a fictional "Acme Ghana Market" merchant with a 5,000 GHS bond, a webhook, an API key, two products, two customers, and 25,000 TWINGHS seeded into the balance** — all on first page load, with no user input.

### 15.2 What is missing

| Step | Real fintech | PaySwap |
|------|--------------|---------|
| Account creation (email/password) | ✅ | ❌ |
| Email verification | ✅ | ❌ |
| Business type selection (individual / LLC / corp) | ✅ | ❌ |
| Business details (legal name, registration #, tax ID, address) | ✅ | ❌ |
| Beneficial owner disclosure | ✅ | ❌ |
| KYC document upload (ID + address proof) | ✅ | ❌ |
| KYB business document upload | ✅ | ❌ |
| Bank account linking | ✅ | ❌ |
| Payout method setup | ✅ | ❌ |
| Terms of service / privacy policy acceptance | ✅ | ❌ |
| Risk assessment / underwriting | ✅ | ❌ |
| Approval / activation | ✅ | ❌ |
| First-product / first-payment guided tour | ✅ | ❌ |

There is no signup form. There is no login. The `POST /api/merchant/onboard` endpoint accepts `name, email, country, currency` and immediately creates an active merchant with no verification. A real merchant cannot use this system because there is no way for them to get a `merchantId` that isn't "Acme Ghana Market".

---

## 16. Missing Production Integrations — **Critical**

### 16.1 What is simulated vs real

| Integration | Code exists? | Real API calls? | Env vars? | Status |
|-------------|--------------|------------------|-----------|--------|
| **Stellar (Horizon)** | ✅ `chains/stellar/adapter.ts` (1,637 LOC) | ❌ Defaults to `mode: 'simulation'` | ❌ No `STELLAR_SECRET` | Simulated |
| **M-Pesa** | ✅ `providers/` + `connectors-v2/mpesa.ts` | ❌ `__PAYSWAP_CONNECTORS__` never set | ❌ No `MPESA_CONSUMER_KEY` | Simulated |
| **MTN MoMo** | ✅ `providers/mtn-momo.ts` (303 LOC) | ❌ Never called from API route | ❌ No credentials | Dead code |
| **Airtel Money** | ✅ `providers/airtel-money.ts` (259 LOC) | ❌ Never called | ❌ No credentials | Dead code |
| **Stripe** | ✅ `providers/stripe.ts` (355 LOC) | ❌ Never called | ❌ No `STRIPE_SECRET_KEY` | Dead code |
| **Flutterwave** | ✅ `providers/flutterwave.ts` (351 LOC) | ❌ Never called | ❌ No credentials | Dead code |
| **Paystack** | ✅ `providers/paystack.ts` (369 LOC) | ❌ Never called | ❌ No `PAYSTACK_SECRET_KEY` | Dead code |
| **Fireblocks** | ✅ `providers/fireblocks.ts` (395 LOC) | ❌ Never called | ❌ No credentials | Dead code |
| **Chainalysis** | ✅ `providers/chainalysis.ts` (326 LOC) | ❌ Never called | ❌ No `CHAINALYSIS_API_KEY` | Dead code |
| **TRM Labs** | ✅ `providers/trm-labs.ts` (345 LOC) | ❌ Never called | ❌ No `TRM_API_KEY` | Dead code |
| **Open Banking (PSD2)** | ✅ `providers/open-banking.ts` (360 LOC) | ❌ Never called | ❌ No credentials | Dead code |
| **Ethereum RPC** | ✅ `providers/ethereum-rpc.ts` | ❌ Never called | ❌ No `ETH_RPC_URL` | Dead code |
| **Polygon RPC** | ✅ `providers/polygon-rpc.ts` | ❌ Never called | ❌ No credentials | Dead code |
| **Base RPC** | ✅ `providers/base-rpc.ts` | ❌ Never called | ❌ No credentials | Dead code |
| **SMTP / email** | ❌ No code | ❌ | ❌ No `SMTP_URL` | Missing |
| **SMS (Twilio)** | ❌ No code | ❌ | ❌ No `TWILIO_AUTH_TOKEN` | Missing |
| **Push notifications** | ❌ No code | ❌ | ❌ | Missing |
| **Sentry / error tracking** | ❌ No code | ❌ | ❌ No `SENTRY_DSN` | Missing |
| **Datadog / metrics** | ❌ No code | ❌ | ❌ No `DATADOG_API_KEY` | Missing |
| **S3 / file storage** | ❌ No code (Terraform file exists) | ❌ | ❌ No AWS creds | Missing |
| **Redis / cache** | ❌ No code | ❌ | ❌ No `REDIS_URL` | Missing |
| **KMS / HSM** | ❌ No code | ❌ | ❌ | Missing |
| **Plaid / bank linking** | ❌ No code | ❌ | ❌ No `PLAID_CLIENT_ID` | Missing |
| **Onfido / Jumio / Persona (KYC)** | ❌ No code | ❌ | ❌ | Missing |

### 16.2 The honest truth

**Zero real production integrations are wired.** Every external call falls back to `simulatedEvidence()`. The `PRODUCTION-4-VERIFICATION-REPORT.md` claims "✅ Ready" for "Real Stellar Integration" and "Integrating with real banking providers" — but the verification is that the *code exists and the endpoints return 200 on simulated data*, not that a single real dollar has ever moved.

---

## 17. Severity Summary — Top 10 Critical Issues

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | **No authentication** — any client can call any API route as any merchant | **Critical** | System is unsafe to deploy. SEC-016. |
| 2 | **No persistent domain state** — merchants, payouts, wallets, API keys, webhooks all live in process-memory `Map`s; restart loses everything | **Critical** | System is a demo, not a product. |
| 3 | **No merchant signup / onboarding** — the UI hardcodes "Acme Ghana Market" on first load | **Critical** | No real merchant can use the system. |
| 4 | **SQLite, not PostgreSQL** — no migrations, `--accept-data-loss` in scripts, file-local DB | **Critical** | Cannot scale, cannot support concurrent writers, not production-grade. |
| 5 | **Single-page UI with no routing or navigation** — 1,719-LOC `page.tsx` with 7 tabs; no `/login`, `/payments`, `/settings`, etc. | **Critical** | Not a real product surface. |
| 6 | **Zero real integrations** — 16 provider adapters exist as dead code; `__PAYSWAP_CONNECTORS__` global is never populated; no env vars for Stripe/M-Pesa/Stellar/etc. | **Critical** | No real money has ever moved. |
| 7 | **~21,000 LOC of duplicate v1/v2 modules** — `treasury` vs `treasury-v2`, `wallets` vs `wallets-v2`, `merchant` vs `merchant-v2`, `connectors-v2` vs `providers`, `chains` vs `blockchains` — and the v2 versions are mostly dead code | **High** | Unmaintainable. New contributors cannot tell which is canonical. |
| 8 | **No tests** — `tests/` contains shell scripts; no Jest/Vitest/Playwright; `next.config.ts` sets `ignoreBuildErrors: true` | **High** | No safety net for changes. Type errors are silently swallowed. |
| 9 | **13 known security vulnerabilities (1 Critical, 7 High, 5 Medium) unfixed** — documented in the project's own security review but not remediated | **High** | Even the project's self-audit says it is not safe. |
| 10 | **Self-authored "certification" reports grade the system "Ready" while admitting the Critical auth gap** — the `production-acceptance.md` marks 7/13 subsystems "Ready" but lists "add authentication" as a P0 remediation in the same document | **High** | The reports are not a reliable signal of readiness. |

---

## 18. Answers to Key Questions

| Question | Answer |
|----------|--------|
| Is this a real product or a demo? | **Demo.** A single-page dashboard that auto-bootstraps a fictional "Acme Ghana Market" merchant on first load. |
| Can a merchant actually sign up and use it? | **No.** There is no signup form, no login, no onboarding flow. |
| Is there authentication? | **No.** `next-auth` is installed but never imported. No middleware. No session. No API key validation. |
| Is there PostgreSQL or just SQLite? | **SQLite.** `DATABASE_URL=file:./db/custom.db`. The Terraform `rds.tf` is not wired to the app. |
| Are there multiple pages or just one? | **One.** `src/app/page.tsx` (1,719 LOC). No other routes exist. |
| Is there real navigation or just tabs? | **Just tabs.** 7 tabs in a `<Tabs>` component. No sidebar, no top nav, no route-based navigation. |
| Does data survive restart? | **No.** All domain state is in-memory `Map`s. Only the event audit log and simulation runs are persisted (and even those are not replayed to rebuild domain state). |
| Is there proper error handling? | **No.** API routes return generic 500s; UI silently swallows errors with `.catch(() => null)`; no error boundaries; no `error.tsx`. |
| Are there loading/empty states? | **Partial.** Empty states are well-handled (8+ `EmptyState` uses). Loading states exist only for the initial dashboard and the InfraTab — all other tabs render `null` while loading. |
| Does it work on mobile? | **Barely.** 33 responsive class usages make the layout stack, but there is no bottom nav, no mobile forms, no PWA, no touch optimization. |

---

## 19. Recommended Rebuild Priorities

If this codebase is to become a real product, the work must be done in this order — features below are meaningless until the foundations are fixed.

1. **Auth + multi-tenancy** (P0) — NextAuth.js, session, middleware, `merchantId` derived from auth, not request body.
2. **PostgreSQL + Prisma migrations** (P0) — switch datasource, write real migrations, drop `--accept-data-loss`.
3. **Persist every domain aggregate** (P0) — `Merchant`, `ApiKey`, `Product`, `Customer`, `Invoice`, `Payment`, `Payout`, `Wallet`, `WebhookEndpoint`, `WebhookDelivery`, `QrCode`, `Refund`, `Subscription` as Prisma models. Replace every in-memory `Map` with DB queries.
4. **Delete dead code** (P0) — remove `wallets-v2/`, `merchant-v2/`, `connectors-v2/`, `treasury-v2/` (or merge into the v1 and delete v1), `blockchains/`, all 22 simulator components, all unused shadcn primitives, the `supply-chain`/`infrastructure`/`fuzz`/`validation`/`protocol`/`scenarios` API routes that serve the dead simulator.
5. **REST API redesign** (P0) — replace the `action` dispatcher with proper resource routes. Add pagination, idempotency, rate limiting, error taxonomy.
6. **Multi-page app shell** (P1) — sidebar, top nav, route-per-feature (`/dashboard`, `/payments`, `/payouts`, `/customers`, `/settings`). Use the installed shadcn `sidebar.tsx`.
7. **Real onboarding flow** (P1) — signup → email verify → business details → KYC upload → bank link → activation.
8. **One real integration, end-to-end** (P1) — pick ONE (Stellar or M-Pesa) and wire it with real credentials, real error handling, real retries. Prove a real transaction can happen.
9. **Test suite** (P1) — Vitest for unit, Playwright for e2e, remove `ignoreBuildErrors: true`.
10. **Then** build features (subscriptions, disputes, reports, cards, etc.) on the stable foundation.

---

## 20. Conclusion

PaySwap is **not a product**. It is a **research artifact** — an elaborate exploration of a "Global Liquidity Operating System" kernel with a thin merchant dashboard bolted on top. The kernel is over-engineered (50 files, 7 "primitives", 43 "constitutional invariants") for a system that has never processed a real payment. The protocol layer is a graveyard of duplicate implementations where the `v2` versions were written but never wired in. The UI is a single page that auto-creates a fake merchant.

The certification reports are the most misleading part of the repository. They grade subsystems "Ready" based on self-authored checks that pass on simulated data, while the same reports admit a Critical authentication vulnerability that means **no API can be exposed publicly**. A system with no auth, no persistence, and no real integrations is not "Ready" by any honest definition.

**The rebuild plan should start from the foundations (auth, Postgres, persistence, one real integration) and treat the existing protocol layer as a reference implementation to cherry-pick from — not a codebase to build on top of.**

---

*End of audit report.*
