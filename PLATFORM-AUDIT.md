# PaySwap — Platform Audit (Still-Fake / Broken / Placeholder Inventory)

**Auditor:** General-purpose sub-agent
**Scope:** `src/app/**`, `src/app/api/**`, `src/components/**`, `src/lib/**`, `src/middleware.ts`, `prisma/schema.prisma`
**Method:** Read every `page.tsx` (60) and every `route.ts` (55); traced every fetch; checked every page for `getEnvironment()` / `requireMerchant()` / `requireAdmin()`; grepped for `placeholder|mock|fake|TODO|coming soon`; cross-referenced every `Authorization: Bearer` example against actual route handlers.
**Comparison baseline:** `PRODUCT-AUDIT.md` (prior audit). Several of its Critical findings have since been fixed — those are noted as RESOLVED so the reader can see what remains.

**Headline:** The platform has been substantially repaired since the prior audit — the hosted checkout is real, merchant create-action buttons work and write to PostgreSQL, the waitlist → merchant provisioning loop is wired, the shells have been unified, and an EnvSwitcher + sandbox/live filtering exists. **What is still fake is concentrated in (a) an entire parallel in-memory "protocol" API surface that nothing user-facing reads from, (b) every non-merchant role workspace being read-only, (c) a handful of demo-brochure pages (reports, extensions, sandbox, docs, QR), and (d) two genuinely critical security holes that survived the cleanup.**

---

## 0. What has been fixed since `PRODUCT-AUDIT.md` (context only)

For honesty — these were Critical in the prior audit and are now resolved:

- ✅ Hosted checkout `/pay/[paymentId]` is real. Server component reads `db.payment.findUnique({ include: { merchant: true } })`; `CheckoutForm` POSTs to `/api/payments/[id]/pay` which writes `status: COMPLETED`, `settledAt`, and bumps the `CustomerRecord` totals inside a transaction. (`src/app/pay/[paymentId]/page.tsx`, `src/app/pay/[paymentId]/checkout-form.tsx`, `src/app/api/payments/[id]/pay/route.ts`)
- ✅ Waitlist approval now provisions a real merchant workspace. `PATCH /api/admin/waitlist` runs a `$transaction` that upserts a `User`, creates `Account(MERCHANT)`, `UserRole(MERCHANT)`, `Merchant(PENDING/UNVERIFIED)`, and a default `Wallet`. Admin auth required. (`src/app/api/admin/waitlist/route.ts`)
- ✅ Merchant create-action buttons work end-to-end. `CreatePaymentDialog`, `CreateInvoiceDialog`, `CreateCustomerDialog`, `CreateProductDialog`, `CreateRefundDialog`, `CreatePayoutDialog`, `CreateApiKeyDialog`, `CreateWebhookDialog`, `CreatePaymentLinkDialog`, `EditSettingsForm` all POST to DB-backed routes that use `requireSession` + `requireMerchantId` + `getEnvironment`.
- ✅ DB-backed API routes added: `/api/payments/create`, `/api/payouts/create`, `/api/invoices/create`, `/api/customers/create`, `/api/products/create`, `/api/refunds/create`, `/api/api-keys/create`, `/api/webhooks/create`, `/api/payment-links/create`, `/api/merchant/settings`, `/api/webhooks/test`, `/api/activity`. All use `requireSession` + `requireMerchantId` + `getEnvironment` and write to PostgreSQL.
- ✅ Two parallel shells (`app-shell.tsx` + `role-shell.tsx`) are now thin wrappers around a single `UnifiedShell` (`src/components/unified-shell.tsx`).
- ✅ `EnvSwitcher` is integrated into the shell (`src/components/unified-shell.tsx:137`); `getEnvironment()` reads the `payswap-env-mode` cookie; merchant list pages filter by `environment`.
- ✅ `error.tsx` files now exist at every role-group root (9 of them).
- ✅ Header search icon opens a real `CommandPalette` (Cmd+K).
- ✅ Webhook tester (`/developers/webhooks`) actually delivers to the URL via `fetch()` with HMAC signing and persists `WebhookDelivery` rows.
- ✅ API explorer (`/developers/explorer`) actually fires real `fetch()` requests against the live API.
- ✅ Admin `PATCH /api/admin/waitlist` now requires `requireAdminSession()` (was previously any session).

---

## 1. Findings — Critical

### C1. `/api/treasury/freeze` is unauthenticated
**File:** `src/app/api/treasury/freeze/route.ts`
**What's wrong:** The POST handler accepts `{ scope, target, reason, initiatedBy, durationMs }` and calls `emergencyFreezeEngine.freezeAccount|freezeAsset|freezeCorridor(...)` with **no session check, no role check, no ownership check**. The source comment literally says `admin only in production` but nothing enforces it. Anyone on the internet can freeze any account, asset, or corridor in the in-memory treasury engine. The GET handler that lists active freezes is likewise open.
**Fix:** Add `requireAdminSession()` and return 403 if not admin. Better: delete the route (it operates on an in-memory engine that has no production meaning — see C4).

### C2. Created payment links return URLs that 404 at the hosted checkout
**Files:** `src/app/api/payment-links/create/route.ts:15,75`; `src/app/pay/[paymentId]/page.tsx:24`
**What's wrong:** `LINK_BASE_URL = 'https://payswap2.vercel.app/pay/'`. The create route inserts a `PaymentLink` row and returns `{ url: '.../pay/{paymentLinkId}' }`. But the hosted checkout page does `db.payment.findUnique({ where: { id: paymentId } })` — and `paymentLinkId` is not a `Payment` ID. So a customer clicking any merchant-created payment link lands on "Payment not found". The merchant dashboard even renders the link as a clickable `<a href={l.url}>` (`/dashboard/payment-links/page.tsx:131`), so this dead-end is one click away from every payment link.
**Fix:** Either (a) when a `PaymentLink` is created, also create a `Payment` row in `PENDING` state and use its ID in the URL; or (b) change the hosted checkout to look up a `PaymentLink` by ID and create the `Payment` lazily on "Pay". Either way, also remove the hardcoded `payswap2.vercel.app` host (use `process.env.NEXT_PUBLIC_APP_URL` or relative `/pay/`).

### C3. API keys are stored but never validated anywhere
**Files:** `src/app/api/api-keys/create/route.ts` (stores `keyHash`); `src/protocol/security/auth.ts:296-318` and `src/protocol/security/middleware.ts:172` (the only files that read an `x-api-key` / `Authorization: Bearer` header)
**What's wrong:** A grep for `apiKey.findUnique|apiKey.findFirst|keyHash|x-api-key|Authorization.*Bearer` against `src/app/api` returns **zero matches**. The security middleware in `src/protocol/security/**` is never imported by any actual route handler. So:
- A merchant creates an API key (`psk_live_…`) → it is hashed and stored in the `ApiKey` table.
- The merchant sends `Authorization: Bearer psk_live_…` to `/api/payments/create` (or any other route) → the route calls `requireSession()` which only checks the NextAuth session cookie, ignoring the bearer token entirely.
- The curl example on `/developers` (`-H "Authorization: Bearer psk_live_xxx"`) and the `@payswap/sdk` TypeScript example are **demonstrably non-functional** — there is no route in the codebase that authenticates a request via API key.
**Fix:** Implement an API-key auth middleware that runs before `requireSession`, looks up the bearer token in `ApiKey.keyHash`, enforces scopes, updates `lastUsedAt`, and resolves the merchantId. Wire it as a Next.js middleware or as a shared helper at the top of every API route.

### C4. Hardcoded shared temp password for every approved merchant
**Files:** `src/app/api/admin/waitlist/route.ts:17` (`const TEMP_PASSWORD = 'Payswap123456';`); `src/components/admin/waitlist-actions.tsx:8` (same constant)
**What's wrong:** Every waitlist-approved merchant gets the literal password `Payswap123456`. The admin UI surfaces this in a toast (`Login: ${email} / ${TEMP_PASSWORD}`, duration 6s) — meaning anyone shoulder-surfing the admin's screen, or reading the admin's notification history, gets the password for every merchant on the platform. The password is the same for everyone, never rotated, never expires, and the merchant has no forced-password-change flow on first login. Combined with the fact that `emailVerified` is set to `now()` on approval, a leaked password grants immediate login.
**Fix:** Generate a cryptographically-random per-merchant temp password (e.g. `randomBytes(12).toString('base64url')`), return it in the API response (once), show it once in the admin UI, and force a password reset on first login (add a `mustChangePassword` flag on `User`).

### C5. Parallel in-memory "protocol" API surface — disconnected from the DB the dashboards read from
**Files:** `src/app/api/payments/route.ts`, `src/app/api/payment-links/route.ts`, `src/app/api/merchant/payout/route.ts`, `src/app/api/merchant/state/route.ts`, `src/app/api/merchant/onboard/route.ts`, `src/app/api/wallets/route.ts`, `src/app/api/webhooks/route.ts`, `src/app/api/treasury/freeze/route.ts`, `src/app/api/treasury/status/route.ts`, `src/app/api/ledger/balance-sheet/route.ts`, `src/app/api/ledger/trial-balance/route.ts`, `src/app/api/ledger/reconciliation/route.ts`
**What's wrong:** Each of these routes imports a module from `@/protocol/**` that holds state in module-level `Map`s and arrays. None of them write to PostgreSQL. They are NOT the routes the merchant UI calls (the UI calls the `*/create` variants) — but they are still deployed and reachable. Specifically:
- `POST /api/payments` uses `transactionEngine`, `liquidityMarketplace`, `lpLifecycle` — all in-memory. The merchant dashboard reads `db.payment.findMany`. A payment created via this API will never appear in the dashboard.
- `POST /api/payment-links` returns `https://pay.payswap.com/pay/{intent.id}` — the `pay.payswap.com` host does not exist and `intent.id` is an in-memory key, not a DB ID.
- `GET /api/merchant/state?merchantId=X` returns the in-memory `merchantPlatform` state (apiKeys, payouts, webhooks, twinToken balance, etc.) that has nothing to do with the merchant's actual DB rows.
- `POST /api/wallets` action `create_account` fabricates a Stellar address `G${account.id...padEnd(56,'X')}` and "funds" it via `stellarAdapter.fundAccount` (in-memory).
- `POST /api/webhooks` action `emit` calls `webhookEngine.emit()` which records a fake "delivery" without making any HTTP request (the real `/api/webhooks/test` route, by contrast, does actually `fetch()` the URL).
- `/api/ledger/*` rebuilds a ledger from `eventEngine.read()` — an in-memory event log, not the DB.
**Fix:** Delete these routes. They are confusing, they look like real endpoints in the URL space, they contradict the DB-backed routes the UI uses, and they will mislead any developer integrating against the platform. If any of them are needed for the admin kernel simulator, scope them under `/api/admin/simulate/*` (which is already admin-gated and DB-writing for the `payment`/`payout`/`aml` variants).

### C6. `/api/payments` and `/api/payment-links` reset shared in-memory state on every call
**Files:** `src/app/api/payments/route.ts:40-41`; `src/app/api/payment-links/route.ts:38-39`
**What's wrong:** Both routes call `liquidityMarketplace.reset(); lpLifecycle.reset();` at the top of the POST handler. Under concurrent requests this means request B wipes request A's LP registration mid-execution. Even in a single-process Next.js dev server this is a race; in production with multiple pods each pod has its own state and there is no shared cache.
**Fix:** Delete the routes (see C5). If kept, isolate state per-request instead of using module-level singletons.

### C7. `/api/admin/simulate/*` writes simulated rows with no `environment` field — they default to `live`
**Files:** `src/app/api/admin/simulate/payment/route.ts:37-51`; (also `/payout` and `/aml` siblings)
**What's wrong:** The Prisma schema default for `Payment.environment` is `'live'` (`prisma/schema.prisma:259`). The simulate routes create `Payment`/`Payout`/`AMLAlert` rows without setting `environment`, so simulated test data appears in Live mode on every dashboard that filters by env. A merchant toggling to "Sandbox" expecting to see only simulated data will see nothing; toggling back to "Live" will see the admin's test payments mixed with real ones.
**Fix:** Either (a) pass `environment: 'sandbox'` on every simulate route, or (b) accept an `environment` field in the request body and default to `'sandbox'`.

---

## 2. Findings — High

### H1. Developer docs reference endpoints that don't exist
**File:** `src/app/(developer)/developers/docs/page.tsx:23-54`
**What's wrong:** The docs page lists `/v1/payments`, `/v1/payments/{id}`, `/v1/payments/{id}/refund`, `/v1/payouts`, `/v1/wallets`, `/v1/wallets/{id}/transactions`, `/v1/webhook-endpoints`. **None of these routes exist in the codebase.** The real routes are `/api/payments/create`, `/api/payments/[id]/pay`, `/api/payouts/create`, `/api/webhooks/create`, etc. There is no `/v1/` namespace. A developer reading these docs and trying the endpoints will get 404s.
**Fix:** Replace the hardcoded `endpoints` array with the real route paths (`/api/payments/create`, etc.) and align each entry's description with what the route actually does.

### H2. Developer sandbox page is 100% hardcoded fixtures
**File:** `src/app/(developer)/developers/sandbox/page.tsx:16-44`
**What's wrong:** `sandboxAccounts` and `testCards` are static `const` arrays. There is no DB read, no API call. The "Webhook inspector" card is a permanent empty state ("No deliveries yet — Trigger a sandbox event (e.g. complete a payment) to see webhook deliveries here") but nothing on the page can trigger a sandbox event. The page says "use the demo secret key `psk_test_demo`" — but no route accepts it (see C3). The whole page is a brochure.
**Fix:** Wire `sandboxAccounts` to the actual `Wallet` rows for the merchant's sandbox environment; wire the webhook inspector to the same `WebhookDelivery` data that `/developers/webhooks` already shows; remove or implement the `psk_test_demo` reference.

### H3. Reports page — every button is dead, "Saved reports" is a placeholder
**File:** `src/app/(merchant)/dashboard/reports/page.tsx`
**What's wrong:** 4 "Generate report" buttons (line 136-141), 3 export buttons `CSV/Excel/PDF` (line 107-112), and a "Saved reports" card with the literal comment `{/* Saved reports placeholder */}` (line 147). Zero `onClick` handlers. No `/api/reports/*` route exists. The date-range inputs have `defaultValue`s but no form.
**Fix:** Implement at least a CSV export backed by a real `GET /api/reports/export?type=…&from=…&to=…&format=csv` route that streams from the DB. Hide the "Saved reports" card until saved reports exist.

### H4. Extensions page — hardcoded list, all "Install" buttons dead, filters labeled "non-functional visual"
**File:** `src/app/(merchant)/dashboard/extensions/page.tsx`
**What's wrong:** `EXTENSIONS` is a hardcoded array of 6 cards (quickbooks, mailchimp, slack, zapier, shopify, woocommerce). None of these integrations exist in the codebase. The "Install" buttons have no `onClick`. The category filter chips are explicitly labeled `{/* Category filter chips (non-functional visual) */}` (line 128). The "QuickBooks installed" state is a hardcoded `true` flag.
**Fix:** Either remove the page entirely (it's pure marketing decoration) or back it with an `Extension` table and a real install/uninstall API. At minimum, make the filter chips actually filter.

### H5. Checkout builder — "Save configuration" dead, hardcodes `merchant_001`
**File:** `src/app/(merchant)/dashboard/checkout/page.tsx:60,89-91,243`
**What's wrong:** The "Save configuration" button has no `onClick`. There is no `/api/checkout-config` route. The generated embed snippet hardcodes `data-merchant="merchant_001"` regardless of who's logged in. The preview browser chrome shows `checkout.payswap.io/pay/merchant_001` — a URL that doesn't resolve to anything in the app.
**Fix:** Wire Save to a `PATCH /api/merchant/settings` (or a new `checkout-config` route) that persists `{ amount, currency, title, description, buttonText, themeColor }` on the `Merchant`. Substitute the real merchant ID into the embed snippet. Either implement the embed script or remove the embed-code card.

### H6. QR page — fake QR encoding, dead "Download PNG", not persisted
**File:** `src/app/(merchant)/dashboard/qr/page.tsx:60-108,297-299`
**What's wrong:** `buildQrMatrix(payload)` places three real finder patterns and timing patterns, then fills the entire data area with `rand() > 0.5` bits from a `mulberry32` PRNG seeded by the payload hash. This is **not a valid QR code** — no phone camera will decode it. The "Download PNG" button (line 297) has no `onClick`. The "generated QR codes" history is `useState` — gone on refresh, never written to DB.
**Fix:** Use the `qrcode` npm package (or a server endpoint that returns a PNG). Persist generated QR codes to a `QrCode` table or to `PaymentLink`. Wire the Download button to a canvas-to-PNG export.

### H7. Support quick search is a `setTimeout` no-op
**Files:** `src/components/support/quick-search.tsx:12-18`; `src/app/(support)/support/page.tsx:70`
**What's wrong:** `QuickSearch.onSubmit` does `setLoading(true); setTimeout(() => setLoading(false), 600);` — no `fetch`, no query, no results. The page itself renders a banner that literally says `Search is a placeholder in this build. Connect it to your search index to enable.`
**Fix:** Either wire it to `/api/activity?type=all&…` plus a free-text filter, or remove the component and the misleading banner.

### H8. Support `/support/search` page is not a search — it just lists recent rows
**File:** `src/app/(support)/support/search/page.tsx:33-49`
**What's wrong:** The page is titled "Search" but has no search input. The comment on line 33 says `// Recent entities as "search results" placeholder`. It just renders three tables of recent users, merchants, and payments (`take: 10` each). No query, no filter, no click-through.
**Fix:** Add a search input that queries users/merchants/payments by free-text (email, name, reference, ID) and renders matching rows. Or rename the page to "Recent activity" and stop calling it search.

### H9. Customer portal is entirely read-only — customer cannot do anything
**Files:** `src/app/(customer)/portal/invoices/page.tsx`, `src/app/(customer)/portal/payments/page.tsx`, `src/app/(customer)/portal/wallet/page.tsx`, `src/app/(customer)/portal/profile/page.tsx`
**What's wrong:** Zero `<Button>` components across all four customer pages. Invoices list has no "Pay now" (and no link to `/pay/[paymentId]`). Wallet page has no "Top up" / "Withdraw". Profile page has no "Edit". The whole portal is a museum.
**Fix:** At minimum, add a "Pay now" `<Link>` on each SENT/OVERDUE invoice row that points to its corresponding `/pay/[paymentId]` (this requires the invoice to have an associated `Payment` row — currently invoices and payments are not linked).

### H10. Compliance workspace is read-only — officer cannot act on any alert/case/KYC/sanctions hit
**Files:** `src/app/(compliance)/compliance/alerts/page.tsx`, `cases/page.tsx`, `kyc/page.tsx`, `sanctions/page.tsx`
**What's wrong:** All four pages render KPI cards + a read-only `<Table>`. Zero `<Button>` components. No "Close alert", "Escalate to SAR", "Assign", "Mark false positive", "Approve/Reject KYC", "Clear/Block sanctions hit". No `/api/compliance/*` action routes exist.
**Fix:** Add at least one action per page (Close alert, Approve KYC, File SAR, Block hit) backed by a new `PATCH /api/compliance/{resource}/{id}` route that updates status and writes an `AuditLog`.

### H11. LP workspace is read-only — LP cannot fulfill, settle, top up, or withdraw
**Files:** `src/app/(lp)/lp/positions/page.tsx`, `settlements/page.tsx`, `profitability/page.tsx`, `settings/page.tsx`
**What's wrong:** Zero `<Button>` components across all four LP pages. No "Fulfill", "Reject", "Settle", "Top up stake", "Withdraw collateral". No `/api/lp/*` action routes.
**Fix:** Add at minimum "Fulfill" / "Reject" on `/lp/positions` (the most operationally important action) backed by a real `POST /api/lp/positions/{id}/fulfill` route.

### H12. Treasury workspace has no actions — freeze/rebalance/open-corridor buttons don't exist
**Files:** `src/app/(treasury)/treasury/page.tsx`, `reserves/page.tsx`, `corridors/page.tsx`, `reports/page.tsx`
**What's wrong:** Treasury overview, reserves, corridors, reports — all read-only. The `/api/treasury/freeze` route exists (see C1) but no UI calls it. There is no "Freeze", "Rebalance", "Open corridor", "Close corridor", "Generate report", "Export" button anywhere in the treasury UI.
**Fix:** Add a "Freeze" action menu on `/treasury/reserves` rows that calls `/api/treasury/freeze` (after fixing C1). Add "Open/Close corridor" toggles on `/treasury/corridors`.

### H13. Ops pages display in-memory mock data as "production telemetry"
**Files:** `src/app/(ops)/ops/page.tsx`, `connectors/page.tsx`, `metrics/page.tsx`, `health/page.tsx`; `src/protocol/connectors-v2/registry.ts:37-58`
**What's wrong:** All four ops pages source their data from `productionConnectorRegistry`, `metricsRegistry`, `sloManager` — singletons in `src/protocol/ops/**` and `src/protocol/connectors-v2/**`. The "production" connectors have hardcoded `SIMULATED_SECRETS` (e.g. `apiKey: 'ob_prod_bearer_2c8f1a9e4b7d6038'`). Health probes are deterministic stubs. The SLO status table and the connector status list look like real telemetry but are fabricated. An ops engineer looking at `/ops` would believe the platform is being monitored when it isn't.
**Fix:** Either wire these to real production telemetry (Prometheus, health-check endpoints against real downstream APIs) or relabel the page as "Connector simulator" and put it behind the admin role rather than the ops role.

### H14. ~20 orphaned API routes that no UI calls
**Files:** (none of these are referenced from any `fetch()` in `src/components/**` or `src/app/**/page.tsx` other than the admin kernel simulator's use of `/api/simulate` + `/api/scenarios`)
`/api/admin/stats`, `/api/treasury/status`, `/api/infrastructure`, `/api/supply-chain`, `/api/metrics`, `/api/fuzz`, `/api/validation`, `/api/protocol`, `/api/protocol/health`, `/api/resilience/health`, `/api/resilience/dlq`, `/api/ledger/balance-sheet`, `/api/ledger/trial-balance`, `/api/ledger/reconciliation`, `/api/ops/overview`, `/api/ops/metrics`, `/api/ops/health`, `/api/ops/dashboards/lp`, `/api/ops/dashboards/treasury`, `/api/ops/dashboards/connectors`, `/api/ops/dashboards/settlement`, `/api/blockchain`, plus the in-memory ones listed in C5.
**What's wrong:** Each route is deployed, returns in-memory mock data, and is not reachable from any button or page in the app. They inflate the API surface, confuse API discovery, and most have no auth check at all (e.g. `/api/treasury/status`, `/api/blockchain` POST, `/api/ledger/*`, `/api/ops/*`).
**Fix:** Delete them, or gate them behind `/api/admin/*` with `requireAdminSession()` and label them clearly as simulator endpoints.

### H15. Treasury dashboard "backing" is a hardcoded 85% multiplier
**File:** `src/app/(treasury)/treasury/page.tsx:69`
**What's wrong:** `backing: Math.max(0, (w._sum.balance ?? 0) * 0.85)`. The "Backing ratio" KPI and the per-currency "Coverage" progress bar are computed from this fabricated 85% number, not from any real collateral / reserve ratio. The displayed percentage is always 85% (plus bonds + LP collateral added on top in the total).
**Fix:** Compute real backing from `Merchant.bond` + `LPProfile.collateral` + `Wallet.balance` per currency, or remove the "Backing" column and "Backing ratio" KPI until real data is available.

### H16. Admin "Processed volume" sums across currencies and formats as GHS
**File:** `src/app/(admin)/admin/page.tsx:39-55`
**What's wrong:** `db.payment.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } })` sums amounts across GHS, KES, NGN, USD, EUR, ZAR, etc., then formats the total as GHS. Adding 1000 GHS + 1000 USD + 1000 KES = 3000 (displayed as "GHS 3,000") is meaningless.
**Fix:** Group by currency (`_sum` per currency) and render a small table, or normalize via FX rates to a single reporting currency (clearly labeled).

---

## 3. Findings — Medium

### M1. Merchant dashboard "Revenue" computed over only the last 10 payments
**File:** `src/app/(merchant)/dashboard/page.tsx:25,31,44-45,49`
**What's wrong:** `db.payment.findMany({ ..., take: 10 })` then `revenue = payments.filter(p => p.status === 'COMPLETED').reduce(...)`. The KPI card label says "Revenue" with subtitle `{payments.length} payments` — but `payments.length` is ≤10. The "Transactions" KPI card literally says "All-time" while showing ≤10.
**Fix:** Use `db.payment.aggregate({ where: { merchantId, environment, status: 'COMPLETED' }, _sum: { amount: true }, _count: true })` for revenue + transaction count. Keep the `take: 10` only for the "Recent Payments" table.

### M2. Team page "Invite member" button is dead; query doesn't filter by environment
**File:** `src/app/(merchant)/dashboard/settings/team/page.tsx:36-39,53-55`
**What's wrong:** `<Button>Invite member</Button>` has no `onClick` (no `CreateTeamMemberDialog` exists). `db.teamMember.findMany({ where: { merchantId } })` — no `environment` filter (team members are global to the merchant, but the page is shown in both sandbox and live with the same rows).
**Fix:** Add a `CreateTeamMemberDialog` that POSTs to a new `/api/team/create` route. Decide whether team members are env-scoped or merchant-scoped and be consistent.

### M3. Subscriptions page "Create plan" button is dead; query doesn't filter by environment
**File:** `src/app/(merchant)/dashboard/subscriptions/page.tsx:31-35,67-69`
**What's wrong:** `<Button>Create plan</Button>` has no `onClick`. `db.subscription.findMany({ where: { merchantId } })` — no `environment` filter.
**Fix:** Add a `CreateSubscriptionPlanDialog` and an `/api/subscriptions/create` route. Filter by env (subscriptions should be sandbox/live-scoped).

### M4. Customer portal pages don't filter by environment
**Files:** `src/app/(customer)/portal/page.tsx:48`; `src/app/(customer)/portal/wallet/page.tsx:36`; `src/app/(customer)/portal/payments/page.tsx`; `src/app/(customer)/portal/invoices/page.tsx:44`
**What's wrong:** All customer queries use `where: { customerId: customer.id }` (or `userId`) with no `environment: env` clause. A customer sees both sandbox and live payments/invoices/wallets mixed together. The customer has no EnvSwitcher in their shell either, so they can't even tell which environment they're looking at.
**Fix:** Add `environment: await getEnvironment()` to every customer query, or decide that customers only ever see Live and filter explicitly to `environment: 'live'`.

### M5. Admin Merchants/Users pages don't filter by environment
**Files:** `src/app/(admin)/admin/merchants/page.tsx:27`; `src/app/(admin)/admin/users/page.tsx:27`
**What's wrong:** Both list queries omit `environment`. Admin sees sandbox + live merchants/users mixed. The admin shell does have an EnvSwitcher, so the omission is a real bug, not a design choice.
**Fix:** Add `environment: await getEnvironment()` to the `where` clause.

### M6. Compliance / LP / Treasury / Ops / Support pages don't filter by environment
**Files:** All list pages under `(compliance)`, `(lp)`, `(treasury)`, `(ops)`, `(support)`
**What's wrong:** None of these role pages call `getEnvironment()` or filter by it. The EnvSwitcher toggle in the shell is decorative for these roles — toggling sandbox/live changes nothing on the page. AuditLog has no `environment` column at all (`prisma/schema.prisma`).
**Fix:** Either add `environment` filtering to every list query (and an `environment` column to `AuditLog`), or hide the EnvSwitcher for roles that don't support it.

### M7. Bell icon pretends a notification system exists
**File:** `src/components/unified-shell.tsx:247-256`
**What's wrong:** `onClick={() => toast.info('No new notifications')}` plus a permanent `<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />` unread dot. There is no `Notification` table, no notification feed, no unread counter. Every user, on every page, sees a red dot that never goes away and a toast that always says "No new notifications" when clicked.
**Fix:** Either remove the bell + red dot, or implement a `Notification` model and a real notification center. The current state is worse than no bell.

### M8. Command palette navigates only — no global search
**File:** `src/components/command-palette.tsx` (used in `unified-shell.tsx:262`)
**What's wrong:** The Cmd+K palette opens but only lists nav items. Typing a payment reference, customer email, or merchant name returns nothing. The header button is labeled "Search…" which sets the wrong expectation.
**Fix:** Either rename the button to "Navigate…" / "Jump to…", or wire the palette to a real search across payments/customers/merchants.

### M9. Header search/bell take space on mobile with limited function
**File:** `src/components/unified-shell.tsx:226-256`
**What's wrong:** On mobile the search button collapses to an icon (good), but the bell still shows. Tapping it pops a "No new notifications" toast — useless on a phone. There is no breadcrumb or page title in the header to use that space instead.
**Fix:** Hide the bell on `< sm`. Add a page title or breadcrumb to the header on mobile.

### M10. Footer year is wrong
**File:** `src/app/page.tsx:106`
**What's wrong:** `<div>© 2026 PaySwap. All rights reserved.</div>` — the year is hardcoded. (Was flagged in the prior audit; still present.)
**Fix:** `{new Date().getFullYear()}`.

### M11. `/api/simulate` GET is unauthenticated
**File:** `src/app/api/simulate/route.ts:22-31`
**What's wrong:** GET returns the default scenario + library scenarios + country options + engine metadata with no session check. POST correctly requires session. Inconsistent.
**Fix:** Add `requireSession()` to the GET handler.

### M12. Developer role routes are not in middleware matcher
**File:** `src/middleware.ts:9-27`
**What's wrong:** The `routeRoles` map and the `matcher` array cover `/dashboard`, `/admin`, `/treasury`, `/compliance`, `/lp`, `/support`, `/ops`, `/portal` — but NOT `/developers`. The `(developer)/layout.tsx` does its own `getServerSession` + role check, so security is fine, but the middleware is unaware of the route group, which is incoherent.
**Fix:** Add `/developers: ['DEVELOPER', 'ADMIN', 'SUPER_ADMIN', 'MERCHANT', 'MERCHANT_STAFF']` to `routeRoles` and `/developers/:path*` to the matcher. (Note: the developer layout intentionally allows merchant roles too, since merchants use the developer portal to manage their own API keys.)

### M13. `@payswap/sdk` referenced in code examples but doesn't exist
**File:** `src/app/(developer)/developers/page.tsx:58-79`
**What's wrong:** The TypeScript quick-start imports `import { PaySwap } from '@payswap/sdk';`. No such package exists in `package.json` or on npm. A developer copying this example gets a module-not-found error.
**Fix:** Either publish an `@payswap/sdk` package, or replace the example with raw `fetch()` calls against the real `/api/*` routes.

### M14. Reports page date-range inputs are non-functional
**File:** `src/app/(merchant)/dashboard/reports/page.tsx:95,101`
**What's wrong:** `<Input id="from" type="date" defaultValue={monthAgo} />` and `<Input id="to" type="date" defaultValue={today} />` — no `<form>`, no `onChange`, no state. The dates are purely cosmetic; nothing consumes them.
**Fix:** Wrap in a `<form>` with a submit button (or controlled state with a debounced re-fetch), and pass `from`/`to` to the (yet-to-be-built) report generation API.

### M15. Sandbox page advertises `psk_test_demo` as a usable key
**File:** `src/app/(developer)/developers/sandbox/page.tsx:64`
**What's wrong:** `Use the credentials below with the demo secret key psk_test_demo.` — no route accepts this key (see C3). A developer will try it, get a 401 (or worse, get through because nothing checks), and be confused.
**Fix:** Remove the reference until API-key auth is implemented (C3).

### M16. Admin Users page shows only the first role per user
**File:** `src/app/(admin)/admin/users/page.tsx:78`
**What's wrong:** `const role = u.roles[0]?.role || '—';` — a user with multiple roles (e.g. `MERCHANT` + `ADMIN`) only sees their first role. The `include: { roles: true }` fetches all roles but only the first is rendered.
**Fix:** Render all roles as a list of badges.

### M17. Payouts dashboard KPI "Payouts" shows `payouts.length` with `take: 5`
**File:** `src/app/(merchant)/dashboard/page.tsx:26,59`
**What's wrong:** The "Payouts" KPI card displays `payouts.length` which is capped at 5 by `take: 5` on the query. Labeled with "{products} products" as the hint, which is also off-topic.
**Fix:** Use `db.payout.count({ where: { merchantId, environment } })` for the KPI; keep `take: 5` only for a recent-payouts list (which the dashboard doesn't currently render).

### M18. Landing page stats are fabricated
**File:** `src/app/page.tsx:87-91`
**What's wrong:** The "Stats" section shows `7 Frozen kernel primitives`, `20+ Protocol modules`, `13 Provider connectors`, `99.9% Settlement SLA target`. The "13 Provider connectors" is presented as a real number but only 5 connectors exist in `productionConnectorRegistry` (`open_banking`, `mpesa`, `ethereum_rpc`, `fx_rate`, `stellar_horizon`). "99.9% Settlement SLA target" is unverified marketing.
**Fix:** Either fetch real counts from the DB/registry, or relabel as marketing claims.

### M19. Two create-* dialog components exist for some entities but no detail/edit dialog
**Files:** `src/components/merchant/create-*.tsx` (9 dialogs); no `edit-*.tsx` or `*-detail.tsx`
**What's wrong:** Merchants can create payments, payouts, invoices, products, customers, refunds, API keys, webhooks, payment links — but cannot edit any of them, cannot revoke an API key, cannot delete a webhook endpoint, cannot mark an invoice as void, cannot cancel a payout, cannot refund against a specific payment from the payments list (only from the refunds dialog). List rows are not clickable to a detail view.
**Fix:** Add row click-through to a detail page (or sheet) for at least payments, payouts, customers, and invoices. Add edit/revoke/cancel actions.

### M20. `Field` display component duplicated inline in 3 settings pages
**Files:** `src/app/(merchant)/dashboard/settings/page.tsx:25-47` (`ReadOnlyField`); `src/app/(customer)/portal/profile/page.tsx`; `src/app/(lp)/lp/settings/page.tsx`
**What's wrong:** Same icon+label+value display component copy-pasted three times. (Flagged in prior audit; still present.)
**Fix:** Extract to `src/components/role-ui.tsx` as `<DisplayField>` and import everywhere.

---

## 4. Findings — Low

### L1. Landing page footer year (M10) — also `© 2026` appears once.
### L2. Sandbox page hardcodes "Sandbox mode" banner text even when EnvSwitcher is set to Live.
### L3. Checkout builder preview URL hardcodes `merchant_001` (H5 root cause).
### L4. API explorer's `/api/merchant/state` example substitutes the user's merchantId but the route itself returns in-memory data (C5) — the explorer "works" but returns nonsense.
### L5. The `Take` limits on list pages are inconsistent: payments 100, payouts 100, customers 100, invoices 100, products 100, payment-links 100, refunds 100, subscriptions 100, audit 100, AML alerts 100, but merchant dashboard recent payments 10, recent payouts 5, support recent 10. No pagination UI on any list page.
### L6. Status badges for `payment.status` use a different rendering path on the merchant dashboard (`<Badge variant={p.status === 'COMPLETED' ? 'default' : 'secondary'}>`) vs. list pages (`<StatusBadge status={p.status} />`). Two ways to render the same status.
### L7. `bg-emerald-600 text-white hover:bg-emerald-700` is repeated as a literal className on ~20 buttons across merchant pages. No `variant="primary"` on the Button component.
### L8. The merchant dashboard "No payments yet" empty state is a plain `<div>` (line 67) instead of the shared `<EmptyState>` component used on every other page.
### L9. Empty states across the app still have no CTA button (the `EmptyState` component doesn't accept an `action` prop). Was flagged in prior audit; still present.
### L10. `fmt`/`fmtDate` helpers are redefined at the top of nearly every merchant page even though `role-ui.tsx` exports `fmtCurrency`/`fmtDate`/`fmtDateShort`. Some merchant pages now use the shared helpers, but the dashboard, payments, and analytics pages still inline their own.
### L11. Loading skeletons: `(merchant)/dashboard/loading.tsx` inlines its own skeleton JSX; everyone else uses `<LoadingScreen>` from `role-ui.tsx`. Two patterns.
### L12. Inconsistent terminology: payment "method" values are `mobile_money`, `bank`, `card`, `qr` in `CreatePaymentDialog` but `MOBILE_MONEY`, `CARD`, `BANK_TRANSFER` in `/api/admin/simulate/payment`. Same field, two casings.
### L13. Inconsistent terminology: "Payout" vs "Withdrawal" — the API comment says "Payout / Withdrawal lifecycle" but the UI consistently says "Payout". Pick one.
### L14. Inconsistent terminology: "Customer" vs "Payer" — `/portal` calls them "Customer", the merchant analytics page calls them "Payer" (`Avg order value`/`Payer cohort` report description).
### L15. `/api/payment-links/create/route.ts:70` inserts with `url: '${LINK_BASE_URL}pending'` then immediately updates — a workaround for the `url` column being `@unique` + required. Should be a deferred constraint or a nullable-then-fill pattern; the current approach leaves a window where a failed update would leave a row with a `pending` URL.

---

## 5. Inconsistent naming / terminology

| Concept | Terms used | Files |
|---|---|---|
| Payment method enum | `mobile_money`, `bank`, `card`, `qr` (lowercase) in create dialog; `MOBILE_MONEY`, `CARD`, `BANK_TRANSFER` (uppercase) in admin simulate route | `create-payment-dialog.tsx:28-33`; `api/admin/simulate/payment/route.ts:34` |
| Payout / Withdrawal | "Payout" everywhere in UI; "Payout / Withdrawal" in API comment | `api/merchant/payout/route.ts:18` |
| Customer / Payer | "Customer" in portal + dashboard; "Payer" in analytics descriptions | `dashboard/analytics/page.tsx:54`; `dashboard/reports/page.tsx:51` |
| Sandbox / Test | "Sandbox" in env switcher; "Test" in `testCards`; "Demo" in `psk_test_demo`; "Sandbox mode" banner | `developers/sandbox/page.tsx` |
| Live / Production | "Live" in env switcher; "production" in API comments and `productionConnectorRegistry` | `lib/environment.ts`; `protocol/connectors-v2/registry.ts` |
| API key prefix | `psk_live_` (api-keys/create), `psk_test_demo` (sandbox page text), `psk_live_xxx` (developer docs example) | three different files |
| Base URL | `https://api.payswap.io` (developer page), `https://payswap2.vercel.app/pay/` (payment-links create), `https://pay.payswap.com/qr/` (merchant/qr API), `https://pay.payswap.com/pay/` (legacy payment-links POST), `https://checkout.payswap.io/pay/merchant_001` (checkout builder preview) | five different hostnames for the same app |

---

## 6. Disconnected workflows (dead-ends a user can actually hit)

| # | Workflow | Where it dead-ends |
|---|---|---|
| DW1 | Merchant creates payment link → customer clicks link | Customer sees "Payment not found" because `PaymentLink.id` ≠ `Payment.id` (C2) |
| DW2 | Merchant creates payment → customer wants to pay it | No "Pay" button on `/dashboard/payments`; the payment ID must be manually pasted into `/pay/{id}` |
| DW3 | Merchant creates invoice → customer wants to pay it | No "Pay now" on `/portal/invoices`; invoices are not linked to payments at all |
| DW4 | Customer receives invoice → wants to pay | Same as DW3 — invoices have no payment link |
| DW5 | Admin simulates payment → merchant sees it in sandbox | Simulated payments default to `environment: 'live'` (C7) → merchant in sandbox sees nothing, merchant in live sees test data |
| DW6 | Compliance officer sees AML alert → wants to act | Read-only page, no Close/Escalate/Assign (H10) |
| DW7 | LP sees open position → wants to fulfill | Read-only page, no Fulfill/Reject (H11) |
| DW8 | Treasury sees degraded reserve → wants to freeze | No Freeze button in UI; the `/api/treasury/freeze` route exists but is unauthenticated (C1) and uncalled (H12) |
| DW9 | Support agent wants to find a payment by reference | Quick search is a `setTimeout` no-op (H7); `/support/search` has no search input (H8) |
| DW10 | Developer wants to test API key auth | No route validates API keys (C3); the docs reference `/v1/*` endpoints that don't exist (H1) |
| DW11 | Merchant generates QR code | QR is fake (won't scan), not persisted, can't be downloaded (H6) |
| DW12 | Merchant builds checkout config | "Save configuration" does nothing; embed code hardcodes `merchant_001` (H5) |
| DW13 | Merchant wants a CSV/Excel/PDF report | All export buttons are dead (H3) |
| DW14 | Merchant installs an extension | All Install buttons are dead; the extensions list is hardcoded (H4) |
| DW15 | Merchant invites a teammate | "Invite member" button has no onClick (M2) |
| DW16 | Merchant creates a subscription plan | "Create plan" button has no onClick (M3) |
| DW17 | Customer wants to top up / withdraw from wallet | No buttons on `/portal/wallet` (H9) |
| DW18 | Customer wants to edit profile | No edit button on `/portal/profile` (H9) |

---

## 7. Pages that aren't linked anywhere (orphaned routes)

Cross-referencing every route in `src/app/**/page.tsx` against every `<Link>` and `href` in the codebase:

- All 60 `page.tsx` files are reachable from at least one nav config (`nav-config.tsx`) or shell. No fully orphaned pages found.
- However, **`/dashboard/reports`**, **`/dashboard/extensions`**, **`/dashboard/checkout`**, and **`/dashboard/qr`** are linked from the merchant sidebar but are essentially dead-ends (every button on them is non-functional — see H3, H4, H5, H6).
- **`/developers/sandbox`** and **`/developers/docs`** are linked from the developer sidebar but contain fabricated content (H1, H2).
- **`/support/search`** is linked but is not actually a search (H8).

---

## 8. Routes that don't respect permissions

| Route | Issue |
|---|---|
| `/api/treasury/freeze` (POST/GET) | No auth at all (C1) |
| `/api/treasury/status` (GET) | No auth |
| `/api/blockchain` (GET/POST) | No auth |
| `/api/ledger/balance-sheet`, `/api/ledger/trial-balance`, `/api/ledger/reconciliation` | No auth |
| `/api/ops/overview`, `/api/ops/metrics`, `/api/ops/health`, `/api/ops/dashboards/*` | No auth |
| `/api/protocol`, `/api/protocol/health` | GET no auth; POST requires session |
| `/api/resilience/health`, `/api/resilience/dlq` | No auth |
| `/api/infrastructure`, `/api/supply-chain` | No auth |
| `/api/metrics` | No auth |
| `/api/simulate` | GET no auth (M11) |
| `/developers/*` | Not in middleware matcher (M12) — layout does its own check, security OK but architecture incoherent |
| `/api/merchant/state?merchantId=X` | Has ownership check now ✓ |
| `/api/merchant/payout` | Has ownership check now ✓ |
| `/api/merchant/qr` | Has ownership check now ✓ |
| `/api/admin/waitlist` PATCH | Now requires `requireAdminSession()` ✓ |
| `/api/admin/stats`, `/api/admin/simulate/*` | Now require admin ✓ |

---

## 9. Routes that don't respect Sandbox / Live

| Route / Page | Issue |
|---|---|
| `/api/admin/simulate/payment`, `/payout`, `/aml` | Don't set `environment` → defaults to `live` (C7) |
| `/dashboard` (merchant dashboard KPIs) | Uses `getEnvironment()` ✓ |
| `/dashboard/payments`, `payouts`, `payment-links`, `customers`, `invoices`, `products`, `refunds`, `activity`, `settings/api-keys`, `settings/webhooks` | Use `getEnvironment()` ✓ |
| `/dashboard/settings`, `settings/team`, `subscriptions`, `analytics`, `reports`, `extensions`, `checkout`, `qr` | Do NOT filter by env (some have no DB query to filter; team and subscriptions do) |
| `/portal/*` (all customer pages) | Do NOT filter by env (M4) |
| `/admin/merchants`, `/admin/users`, `/admin/audit` | Do NOT filter by env (M5) |
| `/admin` (admin dashboard) | Does NOT filter by env |
| `/compliance/*` | Do NOT filter by env (M6) |
| `/lp/*` | Do NOT filter by env (M6) |
| `/treasury/*` | Do NOT filter by env (M6) |
| `/ops/*` | Do NOT filter by env (M6) — and read from in-memory registry anyway |
| `/support/*` | Do NOT filter by env (M6) |
| `/developers/*` | N/A (no DB reads) |

---

## 10. Top 10 findings (one line each)

1. **[C1]** `/api/treasury/freeze` has zero auth — anyone on the internet can freeze any account/asset/corridor.
2. **[C2]** Created payment links return `https://payswap2.vercel.app/pay/{linkId}` but the hosted checkout looks up by `Payment.id` → every payment link 404s.
3. **[C3]** API keys are stored (`ApiKey.keyHash`) but never validated — no route reads `Authorization: Bearer`; the `@payswap/sdk` and curl examples are non-functional.
4. **[C4]** Every waitlist-approved merchant gets the same hardcoded temp password `Payswap123456`, surfaced in an admin toast.
5. **[C5]** ~13 API routes (`/api/payments`, `/api/payment-links`, `/api/merchant/payout`, `/api/merchant/state`, `/api/merchant/onboard`, `/api/wallets`, `/api/webhooks`, `/api/treasury/*`, `/api/ledger/*`) write to in-memory `Map`s, not PostgreSQL — disconnected from every dashboard.
6. **[C7]** Admin simulate routes create `Payment`/`Payout`/`AMLAlert` rows with no `environment` field → test data leaks into Live mode.
7. **[H1]** Developer docs list `/v1/payments`, `/v1/payouts`, `/v1/wallets`, `/v1/webhook-endpoints` — none of these routes exist.
8. **[H9–H12]** Customer, Compliance, LP, Treasury, and Ops workspaces are 100% read-only — zero action buttons across ~20 pages.
9. **[H13]** Ops dashboards present hardcoded in-memory `productionConnectorRegistry` data (with hardcoded `SIMULATED_SECRETS`) as production telemetry.
10. **[H3–H6]** Reports, Extensions, Checkout builder, and QR pages are still demo-brochures — every button is dead, every list is hardcoded, the QR is a PRNG-filled grid that no phone can scan.

---

## 11. Verdict

PaySwap has graduated from "beautiful showroom with no engine" (prior audit) to "merchant workspace works end-to-end, everything else is still a brochure" — the hosted checkout, payment/payout/invoice/customer/product/refund/API-key/webhook/payment-link create flows, settings editing, and webhook testing are real, but the platform still has two critical security holes (unauthenticated treasury freeze, shared temp password), a disconnected in-memory protocol API surface that contradicts the DB-backed one, entirely read-only customer/compliance/LP/treasury/ops workspaces, four dead-button merchant pages (reports/extensions/checkout/QR), and developer docs that reference endpoints which don't exist.

---

**End of audit.**
