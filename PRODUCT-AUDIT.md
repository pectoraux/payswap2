# PaySwap — Product & UX Audit

**Auditor:** Product Architect + UX Architect
**Scope:** Entire user-facing application (`src/app/**`, `src/components/**`, `src/middleware.ts`, `src/lib/auth-guards.ts`, `src/app/api/**`)
**Method:** Read every page, every API route, both shells, the middleware, and the auth-guards. Traced every `fetch()` call from the client. Traced every "Create" / "New" / "Save" / "Approve" button to a real handler.
**Verdict up front:** PaySwap is a polished-looking **read-only demo** dressed up as a fintech platform. It cannot be used to run a real business. Every primary action a merchant, customer, compliance officer, LP, or support agent would need to perform is either missing, fake, decorative, or unauthenticated. The platform is also riddled with critical security holes (unauthenticated money-movement APIs).

---

## 0. TL;DR — The Honest One-Line Verdict

> **PaySwap today is a beautiful showroom with no engine: every list page renders real PostgreSQL data, but almost no button on any screen actually does anything, the hosted checkout is hardcoded, the payout API has zero auth, and there is no end-to-end money flow that a real merchant could complete.**

---

## 1. Information Architecture

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 1.1 | **High** | The sitemap is fragmented across **9 route groups** (`(admin)`, `(merchant)`, `(customer)`, `(treasury)`, `(compliance)`, `(lp)`, `(ops)`, `(support)`, `(developer)`), each with its own `layout.tsx` and its own hand-rolled nav config. There is no central sitemap, no shared nav registry, no role→nav resolver. Adding a new page requires editing one of 9 layout files. |
| 1.2 | **High** | Two competing shell components coexist (`src/components/app-shell.tsx` for merchant+admin, `src/components/role-shell.tsx` for everyone else). They are 90% duplicate markup. See §13. |
| 1.3 | **Medium** | The `developer` role has a sidebar of its own but is **not in the middleware routeRoles map** (`src/middleware.ts:9-18`). A logged-in developer hits `/developers/*` and is allowed through middleware, but middleware doesn't actually know about `/developers`. The `(developer)/layout.tsx` does the role check itself — so security is fine, but the architecture is incoherent. |
| 1.4 | **Medium** | There is no global layout system: no shared `PageHeader` usage in merchant pages (each merchant page inlines its own `<h1 className="text-2xl font-bold tracking-tight">`), while role-shell pages use `<PageHeader>` from `role-ui.tsx`. Result: visually similar but implemented twice. |
| 1.5 | **Medium** | No breadcrumbs anywhere. Users navigating to `/dashboard/payments` have no breadcrumb back to `/dashboard`. The sidebar shows current section, but deep pages feel unanchored. |
| 1.6 | **Low** | Landing page (`src/app/page.tsx`) is a separate one-off design with no shared header/footer component. The footer says "© 2026 PaySwap" — wrong year. |

### Verdict
IA is **mediocre**: route groups exist and roughly map to roles, but there is no shared layout system, no central nav config, and two parallel shell implementations. A user can tell *which role-area* they are in, but not where they are inside it.

---

## 2. Navigation

### Files read
- `src/components/app-shell.tsx` (142 lines)
- `src/components/role-shell.tsx` (181 lines)
- All 9 `(role)/layout.tsx` files

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 2.1 | **High** | **Two different shell components exist for the same job.** `AppShell` (merchant + admin) hardcodes two nav arrays (`merchantNav`, `adminNav`) and selects via a `role="admin" \| "merchant"` prop. `RoleShell` (customer, treasury, compliance, ops, lp, support, developer) accepts nav config as props. They produce near-identical DOM. There is no reason for both. |
| 2.2 | **High** | The header in **both** shells has a `Search` icon button (`<Search className="h-4 w-4" />`) and a `Bell` icon button. **Neither has an `onClick`.** They are pure decoration. There is no global search, no command palette, no notification center. |
| 2.3 | **High** | No breadcrumbs. No "Back" affordance. The `RoleShell` user dropdown links "Dashboard" to `rootPath` — that's the only navigation aid outside the sidebar. |
| 2.4 | **Medium** | The merchant sidebar's "active" detection (`app-shell.tsx:101`) special-cases `/dashboard` and `/admin` so they're only active on exact match — fine. But it uses `pathname.startsWith(item.href)` for everything else, so `/dashboard/payment-links` also highlights the (non-existent) `/dashboard/payments`-style match. Mostly works, but fragile. |
| 2.5 | **Medium** | The `RoleShell` user dropdown's only item is "Dashboard" (links to rootPath) and "Sign out". There is **no "Settings" link, no "Profile" link, no role switcher, no organization switcher**. The `AppShell` user dropdown at least has "Settings". The two shells are inconsistent. |
| 2.6 | **Medium** | On mobile: the sidebar slides in via a state toggle. But the search/bell icons remain in the header on mobile too — they take up screen space and do nothing when tapped. |
| 2.7 | **Low** | The sidebar logo in both shells is just a "P" gradient box. No way to switch organizations, no way to switch roles, no way to switch between Live and Sandbox mode from the sidebar. |

### Verdict
Navigation is **superficial**: sidebar works, but the entire top-right of the app (search, notifications, settings, role switcher, sandbox toggle) is **non-functional**. This is the single most visible piece of "demo-ness" — every page literally shows two buttons that do nothing.

---

## 3. Permissions & RBAC

### Files read
- `src/middleware.ts`
- `src/lib/auth-guards.ts`
- All `src/app/api/**/route.ts` (40 routes)
- All `(role)/layout.tsx` files

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 3.1 | **Critical** | **Most money-movement and configuration APIs have NO authentication at all.** Confirmed unauthenticated routes: `/api/payments` (POST), `/api/payment-links` (POST), `/api/merchant/payout` (POST — request/process/cancel/seed/balance), `/api/merchant/onboard` (POST — onboard/verify/create_api_key/setup_webhook/create_product/create_invoice/create_customer), `/api/merchant/qr` (POST), `/api/merchant/state` (GET — leaks full merchant dashboard state including API keys, payouts, webhooks), `/api/wallets` (POST — create_account/get_balance/list_wallets/transactions), `/api/webhooks` (POST — register/emit/list_deliveries/verify). Anyone on the internet can call these. |
| 3.2 | **Critical** | `/api/admin/waitlist` PATCH (`src/app/api/admin/waitlist/route.ts:17-24`) checks only that a session exists — **it does NOT verify the user is ADMIN**. Any logged-in CUSTOMER can approve or reject waitlist entries. |
| 3.3 | **Critical** | `/api/merchant/payout` action `seed` (`src/app/api/merchant/payout/route.ts:111-131`) lets anyone credit any merchant with arbitrary Twin Tokens. Combined with `process`, anyone can move "money" out of any merchant account. |
| 3.4 | **Critical** | `/api/webhooks` action `emit` (`src/app/api/webhooks/route.ts`) lets anyone trigger arbitrary webhook deliveries to any merchant's registered endpoints with any payload. This is a forgery / SSRF vector. |
| 3.5 | **Critical** | `/api/merchant/state?merchantId=X` returns the **complete dashboard state** of any merchant — including their `apiKeys`, `payouts`, `webhookEndpoints`, and recent `events` — to any anonymous caller. |
| 3.6 | **High** | The middleware (`src/middleware.ts:9-18`) only protects a fixed list of route prefixes. **The entire `/api/**` surface is unprotected by middleware.** Each route must self-guard, and most don't. |
| 3.7 | **High** | Field-level / row-level authorization is **non-existent**. The merchant pages use `requireMerchant()` which returns the *current user's* merchantId — good. But the merchant list pages do `db.payment.findMany({ where: { merchantId } })` correctly. The problem is the *API* layer doesn't enforce this: `/api/merchant/payout` accepts `merchantId` from the request body with no check that the caller owns it. |
| 3.8 | **High** | `requireAdmin()` (`src/lib/auth-guards.ts:45-53`) exists but is **only used by 2 of the 5 admin pages** (`admin/audit`, `admin/runtime`). The other 3 admin pages (`admin/page.tsx`, `admin/users`, `admin/merchants`, `admin/waitlist`) call `getServerSession()` and then trust the layout's role check. Since the `(admin)/layout.tsx` already redirects non-admins, this works for page rendering — but it's defense-in-depth failure. |
| 3.9 | **Medium** | No API-key validation middleware exists. The `ApiKey` Prisma model has `keyPrefix`, `scopes`, `lastUsedAt` — but no API route actually validates an incoming bearer token against this table. The "API keys" feature is decorative. |
| 3.10 | **Medium** | `NEXTAUTH_SECRET` has a hardcoded fallback (`src/lib/auth.ts:40`): `process.env.NEXTAUTH_SECRET \|\| 'payswap-dev-secret-change-in-production'`. If the env var is missing in prod, JWTs are signed with a publicly-known secret. |
| 3.11 | **Medium** | The middleware `authorized: ({ token }) => !!token` callback means anyone with *any* valid token passes the matcher. Role checks happen inside the function. The check is correct but the structure is fragile. |

### Verdict
RBAC is **route-prefix-only at the page level, and almost completely absent at the API level**. This is a production-blocking security disaster. Any logged-in user — or, for most routes, any anonymous user — can read or mutate any merchant's data.

---

## 4. User Journeys — End-to-End Walkthrough

I traced each primary journey from entry to expected outcome. Here is what actually happens.

### 4.1 Guest → Merchant signup
| Step | Reality |
|---|---|
| Land on `/` | OK — marketing page. |
| Click "Get Started" → `/waitlist` | OK. |
| Fill form, submit | **Works** — `POST /api/waitlist` writes to `WaitlistEntry`. Shows "You're on the waitlist!" |
| Admin reviews | Admin sees entry at `/admin/waitlist`. **Works** — page reads from DB. |
| Admin clicks ✓ Approve | **`WaitlistActions` calls `PATCH /api/admin/waitlist`** which updates `status` to `APPROVED`. **But: no User is created, no Merchant is created, no password is set, no email is sent.** The approved applicant has no way to log in. The journey is dead here. |
| Approved merchant logs in | **Impossible.** No credentials exist for them. |

**Severity: Critical.** The waitlist → merchant onboarding loop is open in the middle. No admin action actually creates a login-able merchant.

### 4.2 Merchant creates a payment
- `/dashboard/payments` has a green **"New payment link"** button (`src/app/(merchant)/dashboard/payments/page.tsx:61-63`). It is a `<Button>` with **no `onClick`, no `asChild`, no `href`**. Clicking does nothing.
- `/api/payments` POST exists but writes to in-memory `transactionEngine`, not the DB. The merchant dashboard reads from `db.payment` — so even if you called the API, the dashboard would not show it.
- `/api/payment-links` POST returns a `pay.payswap.com/pay/{id}` URL — but the actual `/pay/[paymentId]` page is **100% fake** (see §12.1).

**Severity: Critical.** A merchant cannot create a real payment through the UI. Even via API, the data doesn't reach the dashboard's data source.

### 4.3 Merchant creates a payout
- `/dashboard/payouts` has **no "New payout" button at all** — the header just has a title and description, no action (`src/app/(merchant)/dashboard/payouts/page.tsx:53-60`).
- `/api/merchant/payout` exists with `request`/`process` actions, but no UI calls it.

**Severity: Critical.** Payouts cannot be initiated from the UI.

### 4.4 Customer pays an invoice
- `/portal/invoices` lists invoices (`src/app/(customer)/portal/invoices/page.tsx`). The table has columns: Number, Total, Status, Due date, Issued. **There is no "Pay" button.** No row action. No link to `/pay/[paymentId]`. No "Pay now" CTA.
- `/portal/payments` is also read-only.
- The hosted checkout `/pay/[paymentId]` is fake (see §12.1).

**Severity: Critical.** Customers cannot pay anything. The whole "accept payments" promise of the marketing page is unfulfilled.

### 4.5 Admin approves waitlist entry
- Covered in §4.1. The button works at the API level (changes status), but the downstream effect (creating a usable merchant login) does not exist.

**Severity: Critical (business loop broken).**

### 4.6 Compliance officer works an AML alert
- `/compliance/alerts` lists alerts. The table has columns: Severity, Type, Entity, Score, Status, Raised, Closed. **No "Assign", "Close", "Escalate to SAR", "Mark false positive", "Add note" actions.** Read-only.
- Same for `/compliance/cases`, `/compliance/kyc`, `/compliance/sanctions`.

**Severity: High.** Compliance cannot do their job. They can see alerts but not act on them.

### 4.7 LP fulfills a settlement
- `/lp/positions` lists open positions. **No "Fulfill", "Reject", "Settle", "Top up stake", "Withdraw collateral" actions.** Read-only.

**Severity: High.** LPs are passive viewers.

### 4.8 Support agent investigates a payment
- `/support/search` has a `QuickSearch` component (`src/components/support/quick-search.tsx`). The form's `onSubmit` literally does `setTimeout(() => setLoading(false), 600)` — **no fetch, no query, no results**. The page itself says "Search is a placeholder in this build."
- `/support/audit` lists audit logs read-only.

**Severity: High.** Support has no actual search capability.

### 4.9 Merchant edits settings
- `/dashboard/settings` is entirely read-only (`src/components/ui/card` rows with no inputs). 0 `Button` components in the file. Same for `/portal/profile` and `/lp/settings`.

**Severity: Critical.** Settings cannot be edited.

### 4.10 Merchant generates an API key
- `/dashboard/settings/api-keys` has a **"Create key"** button with no `onClick`. Read-only list.

**Severity: Critical.**

### 4.11 Merchant adds a webhook endpoint
- `/dashboard/settings/webhooks` has an **"Add endpoint"** button with no `onClick`. Read-only list.

**Severity: Critical.**

### 4.12 Merchant invites a team member
- `/dashboard/settings/team` has an **"Invite member"** button with no `onClick`. Read-only list.

**Severity: Critical.**

### 4.13 Merchant creates a payment link
- `/dashboard/payment-links` has a **"Create payment link"** button with no `onClick`. Read-only list.

**Severity: Critical.**

### 4.14 Merchant adds a product
- `/dashboard/products` has an **"Add product"** button with no `onClick`. Read-only grid.

**Severity: Critical.**

### 4.15 Merchant creates an invoice
- `/dashboard/invoices` has a **"Create invoice"** button (`<Plus />`) with no `onClick`. Read-only table.

**Severity: Critical.**

### 4.16 Merchant issues a refund
- `/dashboard/refunds` has a **"New refund"** button with no `onClick`. Read-only table.

**Severity: Critical.**

### 4.17 Merchant generates a report
- `/dashboard/reports` has "Generate report" buttons on 4 report-type cards, plus CSV/Excel/PDF export buttons. **None have `onClick`.** The page is a static mockup of a reports UI.

**Severity: Critical.**

### 4.18 Merchant installs an extension
- `/dashboard/extensions` has "Install" buttons on 6 extension cards. **None have `onClick`.** The category filter chips are explicitly labeled `/* Category filter chips (non-functional visual) */`. The extensions list is hardcoded — not from the DB.

**Severity: High.**

### 4.19 Developer tries an API call
- `/developers/explorer` lists 6 endpoints as buttons. Clicking does nothing. The page literally says: *"Interactive request execution is coming soon. For now, copy the curl example from the overview page to make live requests against the sandbox."* But the curl example targets `https://api.payswap.io/v1/payments` — a route that does **not exist** in the codebase. The only payment route is `/api/payments` (no `/v1/`).

**Severity: Critical.** The developer portal is a static brochure.

### 4.20 Developer uses the sandbox
- `/developers/sandbox` shows 3 hardcoded "sandbox accounts" with hardcoded balances. No way to reset, no way to trigger events, no way to copy a real key. The "Webhook inspector" card is an empty state with no mechanism to populate it.

**Severity: High.**

### Verdict
**Zero of the ~20 primary user journeys are complete end-to-end.** The only functional journey is "guest joins waitlist" — and even that dead-ends because approval doesn't provision a login.

---

## 5. Onboarding

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 5.1 | **Critical** | There is **no merchant onboarding flow**. A merchant cannot sign up on their own (the waitlist form doesn't create a User). An admin cannot onboard a merchant through the UI (approving waitlist only flips a status flag). The only way to create a real merchant+user in the DB is to run the seed script. |
| 5.2 | **Critical** | No KYC submission UI. The `ComplianceReview` model exists, the `/compliance/kyc` page lists reviews, but **no page lets a merchant submit KYC documents**. The merchant settings page shows a `kycLevel` field, read-only. |
| 5.3 | **Critical** | No setup wizard. A new merchant lands on `/dashboard` and sees KPIs (likely zeros) and a "Recent Payments" empty state. No checklist, no "first, do this" prompts, no completion meter. |
| 5.4 | **High** | No "complete your profile" prompt. A merchant with `name=null`, `country=null`, `currency=null` would just see `—` everywhere. |
| 5.5 | **High** | No business-document upload. No bank-account-linking step. No bond deposit flow (the `bond` field is shown but not deposit-able). |

### Verdict
Onboarding is **nonexistent**. There is no path from "I'm a new merchant" to "I can accept my first payment".

---

## 6. Dashboards

### Files read
- `src/app/(merchant)/dashboard/page.tsx`
- `src/app/(admin)/admin/page.tsx`
- `src/app/(treasury)/treasury/page.tsx`
- `src/app/(compliance)/compliance/page.tsx`
- `src/app/(ops)/ops/page.tsx`
- `src/app/(lp)/lp/page.tsx`
- `src/app/(support)/support/page.tsx`

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 6.1 | **Medium** | Merchant dashboard (`/dashboard/page.tsx`) KPIs are **real** (computed from `db.payment`, `db.payout`, `db.customerRecord`, `db.product`). But: "Revenue" is computed as `payments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0)` over only the **last 10 payments** (`take: 10`). So "Revenue" is the sum of the last 10 completed payments, not all-time revenue. **Misleading.** |
| 6.2 | **Medium** | "Transactions" KPI shows `payments.length` (which is ≤10 because of the take). Labeled "All-time" — false. |
| 6.3 | **Medium** | Admin dashboard KPIs are real (counts from DB). Volume is correctly aggregated. Recent waitlist table is real. **This is the best dashboard in the app.** |
| 6.4 | **Low** | Treasury dashboard (`/treasury/page.tsx`) computes "reserves" as a proxy: `wallet.balance` aggregated by currency, with "backing" as a hardcoded `0.85 * balance`. The 85% is a magic number, not a real backing ratio. KPIs are otherwise real. |
| 6.5 | **Medium** | No dashboard has any **chart component**. The merchant `/analytics` page draws a 14-day bar chart using `<div>`s with inline `height` style — works, but is the only "chart" in the entire app. Admin overview has no chart at all, just KPI cards. |
| 6.6 | **Medium** | No real-time updates. Everything is `export const dynamic = 'force-dynamic'` so it re-renders on navigation, but there is no WebSocket, no polling, no `revalidate`. |
| 6.7 | **Low** | No date-range picker on any dashboard. You see "all-time" numbers, period. |
| 6.8 | **Low** | No comparison vs. previous period. No "↑ 12% vs last week" anywhere. |

### Verdict
Dashboards are **real but shallow**. The data is from the DB, but the KPIs are subtly wrong (the "Revenue = last 10 payments" bug is the worst), there are no real charts, no time ranges, and no real-time updates.

---

## 7. Empty States

### Findings

I checked every list page. Empty states are actually **consistently good** — this is one of the few areas the app does well.

| Page | Empty state quality |
|---|---|
| `/dashboard/payments` | ✓ Icon, title, description |
| `/dashboard/payouts` | ✓ Icon, title, description |
| `/dashboard/payment-links` | ✓ Icon, title, description |
| `/dashboard/customers` | ✓ (inline) |
| `/dashboard/products` | ✓ Icon, title, description |
| `/dashboard/invoices` | ✓ |
| `/dashboard/subscriptions` | ✓ |
| `/dashboard/refunds` | ✓ |
| `/admin/waitlist` | ✓ |
| `/admin/merchants` | ✓ |
| `/admin/users` | ✓ |
| `/compliance/alerts`, `/kyc`, `/cases`, `/sanctions` | ✓ via `<EmptyState>` |
| `/lp/*` | ✓ via `<EmptyState>` |
| `/treasury/*` | ✓ via `<EmptyState>` |
| `/support/*` | ✓ via `<EmptyState>` |
| `/portal/*` | ✓ via `<EmptyState>` |

| # | Severity | Finding |
|---|----------|---------|
| 7.1 | **High** | Almost **no empty state has a CTA button**. They say "X will appear here when Y" — but no "Create your first payment" / "Add your first product" / "Invite a teammate" button. The few pages with header buttons (e.g. `/dashboard/payments` "New payment link") have the button *in the header*, not in the empty state. And those header buttons don't work anyway. |
| 7.2 | **Medium** | The `<EmptyState>` component (`src/components/role-ui.tsx:47-64`) **doesn't even accept an `action` prop**. So even if you wanted to add a CTA, you'd have to bypass the component. |
| 7.3 | **Low** | The merchant dashboard's "No payments yet" message (`/dashboard/page.tsx:64`) is a plain `<div>` with muted text — not the nicer `<EmptyState>` component. Inconsistent. |

### Verdict
Empty states are **visually consistent but lack CTAs**. They are inert illustrations, not conversion drivers.

---

## 8. Loading & Error States

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 8.1 | **High** | **Zero `error.tsx` files exist in the entire codebase.** `find src/app -name "error.tsx"` returns nothing. If any server component throws (DB timeout, Prisma error, bad ID), the user sees Next.js's default red error page. |
| 8.2 | **Medium** | `loading.tsx` files exist at 9 locations — one per role group (`(admin)/admin/loading.tsx`, `(customer)/loading.tsx`, etc.) plus `(merchant)/dashboard/loading.tsx`. **No `loading.tsx` for sub-routes** like `/dashboard/payments`, `/dashboard/payouts`, etc. They inherit the parent's, which is fine, but means the loading skeleton doesn't match the page's actual layout (KPI count is wrong, table shape is wrong). |
| 8.3 | **Medium** | Skeletons are used in `loading.tsx` (good), but the patterns are inconsistent: `(merchant)/dashboard/loading.tsx` inlines its own skeleton JSX; everyone else uses `<LoadingScreen>` from `role-ui.tsx`. Two patterns, same job. |
| 8.4 | **Low** | No suspense boundaries inside pages. No progressive loading. No skeleton for individual cards. |

### Verdict
Loading states are **partial**; error states are **completely missing**.

---

## 9. Settings (Merchant)

### Files read
- `src/app/(merchant)/dashboard/settings/page.tsx`
- `src/app/(merchant)/dashboard/settings/api-keys/page.tsx`
- `src/app/(merchant)/dashboard/settings/webhooks/page.tsx`
- `src/app/(merchant)/dashboard/settings/team/page.tsx`

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 9.1 | **Critical** | The main settings page is **entirely read-only**. It renders merchant fields as `<Field>` display components (icon + label + value). No `<Input>`, no `<form>`, no save button. The file contains **0 occurrences of the word "Button"**. |
| 9.2 | **Critical** | API Keys page: "Create key" button has no `onClick`. The list of keys is read from DB. No create, no revoke, no rotate, no scope-edit. |
| 9.3 | **Critical** | Webhooks page: "Add endpoint" button has no `onClick`. List is read-only. No edit, no delete, no test-send, no delivery-history drill-down. |
| 9.4 | **Critical** | Team page: "Invite member" button has no `onClick`. List is read-only. No role-change, no remove, no resend-invite. |
| 9.5 | **High** | No "Sandbox / Live" toggle anywhere in settings. The `merchant.tier` and `merchant.kycLevel` are displayed but not upgradable. The `merchant.bond` is shown but not deposit-able. |
| 9.6 | **Medium** | No "Danger zone" / deactivate account / delete merchant. No data export. No 2FA enrollment flow (the `mfaEnabled` field exists on User but no UI touches it). |

### Verdict
Settings is a **museum exhibit**. A merchant can see their config but cannot change a single field.

---

## 10. Developer Experience

### Files read
- `src/app/(developer)/developers/page.tsx`
- `src/app/(developer)/developers/docs/page.tsx`
- `src/app/(developer)/developers/explorer/page.tsx`
- `src/app/(developer)/developers/sandbox/page.tsx`

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 10.1 | **Critical** | API Explorer endpoint buttons are `<button>` elements with **no onClick**. They don't even visually select. The response panel is a hardcoded JSON blob. |
| 10.2 | **Critical** | Sandbox page is 100% hardcoded constants (`sandboxAccounts`, `testCards`). No way to reset state, no way to fund a wallet, no way to trigger a sandbox event. The "Webhook inspector" is a permanent empty state. |
| 10.3 | **Critical** | The curl example in `/developers` references `https://api.payswap.io/v1/payments` — this route does **not exist**. The real route is `/api/payments`. The SDK example references `@payswap/sdk` — this package does **not exist** in the project. |
| 10.4 | **High** | No way to create extensions. The `/dashboard/extensions` page is a hardcoded list of 6 fake extensions; there is no developer surface for building or publishing one. The `src/extensions/platform/index.ts` file exists but is not exposed via any UI. |
| 10.5 | **High** | Docs page is a static sidebar + hardcoded content. No search, no version selector, no "try it" widget. |
| 10.6 | **Medium** | No API key shown in the developer portal. The `/developers` page tries to look up the user's merchant API keys — but if the user is a pure DEVELOPER role (no merchant), they see "No active API keys found" with no way to create one. |

### Verdict
The developer portal is a **brochure, not a tool**. A developer cannot make a single real API call from inside the app, and the examples reference endpoints and packages that don't exist.

---

## 11. Broken Buttons & Dead Routes — Exhaustive Inventory

I clicked through every sidebar link in every role and every primary button on every page. Here is the full inventory of non-functional affordances.

### Merchant role (`/dashboard/*`)
| Location | Button | Status |
|---|---|---|
| `/dashboard/payments` | "New payment link" | **Dead** — no onClick |
| `/dashboard/checkout` | "Save configuration" | **Dead** — no onClick |
| `/dashboard/payment-links` | "Create payment link" | **Dead** — no onClick |
| `/dashboard/qr` | "Generate QR code" | Works (client-only, not persisted) |
| `/dashboard/qr` | "Download PNG" | **Dead** — no onClick |
| `/dashboard/products` | "Add product" | **Dead** — no onClick |
| `/dashboard/invoices` | "Create invoice" (Plus icon) | **Dead** — no onClick |
| `/dashboard/subscriptions` | "New subscription" | **Dead** — no onClick |
| `/dashboard/refunds` | "New refund" | **Dead** — no onClick |
| `/dashboard/payouts` | (no button at all) | N/A |
| `/dashboard/reports` | "Generate report" × 4 | **Dead** — no onClick |
| `/dashboard/reports` | "CSV" / "Excel" / "PDF" export | **Dead** — no onClick |
| `/dashboard/extensions` | "Install" × 6 | **Dead** — no onClick |
| `/dashboard/extensions` | Category filter chips | **Dead** — explicitly labeled "non-functional visual" |
| `/dashboard/settings` | (no buttons at all) | Read-only |
| `/dashboard/settings/api-keys` | "Create key" | **Dead** — no onClick |
| `/dashboard/settings/webhooks` | "Add endpoint" | **Dead** — no onClick |
| `/dashboard/settings/team` | "Invite member" | **Dead** — no onClick |

### Admin role (`/admin/*`)
| Location | Button | Status |
|---|---|---|
| `/admin/waitlist` | ✓ / ✗ approve / reject | **Works** (but doesn't provision a login) |
| `/admin/users` | (no actions) | Read-only |
| `/admin/merchants` | (no actions) | Read-only |
| `/admin/runtime` | Simulator console | Works (kernel simulator, in-memory) |

### Customer role (`/portal/*`)
| Location | Button | Status |
|---|---|---|
| `/portal/invoices` | "Pay now" | **Does not exist** |
| `/portal/payments` | (no actions) | Read-only |
| `/portal/wallet` | "Top up" / "Withdraw" | **Do not exist** |
| `/portal/profile` | "Edit" | **Does not exist** |

### Compliance role (`/compliance/*`)
| Location | Button | Status |
|---|---|---|
| `/compliance/alerts` | "Close" / "Escalate" / "Assign" | **Do not exist** |
| `/compliance/cases` | "Open case" / "File SAR" | **Do not exist** |
| `/compliance/kyc` | "Approve" / "Reject" KYC | **Do not exist** |
| `/compliance/sanctions` | "Clear" / "Block" hit | **Do not exist** |

### LP role (`/lp/*`)
| Location | Button | Status |
|---|---|---|
| `/lp/positions` | "Fulfill" / "Reject" / "Settle" | **Do not exist** |
| `/lp/settlements` | (no actions) | Read-only |
| `/lp/profitability` | (no actions) | Read-only |
| `/lp/settings` | "Edit" / "Top up stake" / "Withdraw" | **Do not exist** |

### Treasury role (`/treasury/*`)
| Location | Button | Status |
|---|---|---|
| `/treasury/reserves` | "Rebalance" / "Freeze" | **Do not exist** |
| `/treasury/corridors` | "Open" / "Close" corridor | **Do not exist** |
| `/treasury/reports` | "Generate" / "Export" | **Do not exist** |

### Ops role (`/ops/*`)
| Location | Button | Status |
|---|---|---|
| `/ops/health` | (no actions) | Read-only |
| `/ops/connectors` | "Enable" / "Disable" / "Retry" | **Do not exist** |
| `/ops/metrics` | (no actions) | Read-only |

### Support role (`/support/*`)
| Location | Button | Status |
|---|---|---|
| `/support` | "Quick search" input | **Dead** — `setTimeout`, no fetch |
| `/support/search` | (no search input at all) | Just lists recent records |
| `/support/audit` | (no actions) | Read-only |

### Developer role (`/developers/*`)
| Location | Button | Status |
|---|---|---|
| `/developers/explorer` | Endpoint buttons | **Dead** — no onClick |
| `/developers/sandbox` | (no actions) | Static hardcoded cards |

### Global (every role shell)
| Location | Button | Status |
|---|---|---|
| Header search icon | All shells | **Dead** — no onClick |
| Header bell icon | All shells | **Dead** — no onClick |
| User dropdown | "Settings" link (AppShell only) | Works (navigates) |
| User dropdown | "Dashboard" link (RoleShell only) | Works (navigates) |

### Verdict
**~40 distinct buttons across the app are non-functional.** The only working buttons are: login, waitlist submit, admin waitlist approve/reject (broken downstream), and the admin kernel simulator. That's it.

---

## 12. Fake Data & Placeholder APIs

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 12.1 | **Critical** | `/pay/[paymentId]/page.tsx` — the hosted checkout — is **100% fake**. The comment in the source literally says: `// In production: fetch payment status from API // For now: simulate a completed payment`. It uses `setTimeout` to fake a 1-second delay, then `setData({ paymentId, state: 'settled', settled: true, merchant: 'merchant_1', amount: 500, currency: 'GHS', ... })`. The amount is always 500. The merchant is always `'merchant_1'`. **No DB call. No real payment.** |
| 12.2 | **Critical** | `/api/payments` POST does not write to PostgreSQL. It calls `transactionEngine.createIntent()` and `transactionEngine.execute()` — both in-memory. The merchant dashboard reads from `db.payment.findMany()`. **The API and the dashboard read from different sources.** |
| 12.3 | **Critical** | `/api/merchant/payout` POST uses `payoutService` from `@/protocol/payouts/payout-service` — in-memory. The `/dashboard/payouts` page reads from `db.payout.findMany()`. Same disconnect. |
| 12.4 | **Critical** | `/api/merchant/onboard` POST uses `merchantPlatform` from `@/protocol/merchant/platform` — in-memory. The `/admin/merchants` page reads from `db.merchant.findMany()`. Same disconnect. |
| 12.5 | **Critical** | `/api/wallets` uses `walletService` — in-memory. The `/portal/wallet` page reads from `db.wallet.findMany()`. Same disconnect. |
| 12.6 | **Critical** | `/api/webhooks` uses `webhookEngine` — in-memory. The `/dashboard/settings/webhooks` page reads from `db.webhookEndpoint.findMany()`. Same disconnect. |
| 12.7 | **Critical** | `/api/merchant/qr` returns `qrUrl: 'https://pay.payswap.com/qr/${qr.id}'` and a comment `// In production: generate actual QR image`. The QR service is in-memory; the QR URL is unresolvable. |
| 12.8 | **High** | `/dashboard/qr/page.tsx` builds the QR matrix with a custom `buildQrMatrix()` function that uses `mulberry32` PRNG to fill the data area with random bits. **This is not a real QR code.** No phone camera will decode it. It just *looks* like one. |
| 12.9 | **High** | `/dashboard/extensions` has a hardcoded `EXTENSIONS` array (`quickbooks`, `mailchimp`, `slack`, `zapier`, `shopify`, `woocommerce`). None of these integrations exist. The "installed" flag on QuickBooks is hardcoded `true`. |
| 12.10 | **High** | `/developers/sandbox` has hardcoded `sandboxAccounts` and `testCards` arrays. No DB, no API. |
| 12.11 | **High** | `/developers/explorer` has a hardcoded `endpoints` array and a hardcoded JSON response example. |
| 12.12 | **High** | `/api/payments` resets shared in-memory state on every call: `liquidityMarketplace.reset(); lpLifecycle.reset();`. So if two requests come in concurrently, **one will wipe the other's state mid-execution**. This is a concurrency disaster even within a single server instance. |
| 12.13 | **High** | The "blockchain evidence" in `/api/payments` (`src/app/api/payments/route.ts:109-116`) is fabricated: `txHash: '0x' + intent.id.slice(-8)`, `contractAddress: '0xPaySwapEscrow'`, `confirmed: true`. No chain interaction. |
| 12.14 | **Medium** | The `MpesaConnector`, `OpenBankingConnector`, `EthereumConnector`, `ExchangeRateConnector` in `@/protocol/connectors/adapters` all return simulated evidence. Multiple source comments confirm: `// In production: ...`. |
| 12.15 | **Medium** | The `kernel/fx.ts` file's rates are reproducible/simulated (`// in production these would be sourced from a live feed`). |
| 12.16 | **Low** | `merchant_001` is hardcoded as `data-merchant` in the checkout embed snippet (`/dashboard/checkout/page.tsx:60`). |

### Verdict
**The app has two parallel data layers that do not talk to each other**: a real PostgreSQL layer (read by all the dashboard pages) and an in-memory "protocol" layer (written by the APIs). Creating a payment via API does not make it appear in the dashboard. This is the single most damaging architectural finding in the audit.

---

## 13. Duplicate Components

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 13.1 | **High** | `src/components/app-shell.tsx` (142 lines) and `src/components/role-shell.tsx` (181 lines) are **~85% identical**. Same structure: `flex min-h-screen` → overlay → `<aside>` with logo + nav + user dropdown → `<header>` with menu + search + bell → `<main>`. Same breakpoint logic (`lg:static lg:translate-x-0`). Same avatar/initials logic. Same user dropdown. The only meaningful difference: `AppShell` has hardcoded `merchantNav`/`adminNav`; `RoleShell` accepts `navGroups` as props. **`AppShell` should be deleted and merchant/admin should use `RoleShell`.** |
| 13.2 | **Medium** | `LoadingScreen` (`role-ui.tsx`) and the inline skeleton in `(merchant)/dashboard/loading.tsx` and `(admin)/admin/loading.tsx` all build the same KPI-card-skeleton + table-skeleton pattern, but with different code. Three implementations of the same skeleton. |
| 13.3 | **Medium** | The `Field` component (icon + label + value display) is **defined inline in 3 separate page files**: `src/app/(merchant)/dashboard/settings/page.tsx:24-46`, `src/app/(customer)/portal/profile/page.tsx:24-46`, `src/app/(lp)/lp/settings/page.tsx:25-47`. Identical code, copy-pasted. Should be a shared `<DisplayField>` in `role-ui.tsx`. |
| 13.4 | **Medium** | The merchant auth-lookup pattern is duplicated in **6 merchant pages**: `getServerSession` → `db.userRole.findFirst({ where: { userId, role: { in: ['MERCHANT', 'MERCHANT_STAFF'] } } })` → `if (!merchantId) redirect('/unauthorized')`. Some pages use `requireMerchant()` from auth-guards, others inline the lookup. Should be 100% `requireMerchant()`. |
| 13.5 | **Medium** | The `fmt` / `fmtDate` currency-formatting closures are redefined at the top of nearly every merchant page. `role-ui.tsx` already exports `fmtCurrency`, `fmtDate`, `fmtDateShort` — but merchant pages don't use them. |
| 13.6 | **Low** | `PageHeader` exists in `role-ui.tsx` but merchant pages (which use `AppShell`, not `RoleShell`) inline their own `<div className="flex flex-col gap-2 ..."><h1 className="text-2xl font-bold tracking-tight">...</h1></div>`. |

### Verdict
There are **two parallel shell implementations, three parallel Field components, three parallel loading skeletons, and two parallel formatting helpers**. The codebase is full of "I'll just copy this" patterns.

---

## 14. Visual Consistency

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 14.1 | **Medium** | Spacing is *mostly* consistent (`space-y-6`, `gap-4`, `p-5`) but the merchant dashboard's KPI cards use `p-5` while `KpiCard` in `role-ui.tsx` also uses `p-5` — good. However the merchant dashboard inlines its own KPI markup instead of using `<KpiCard>`, so any future change to `<KpiCard>` won't propagate. |
| 14.2 | **Medium** | Button color is `bg-emerald-600 text-white hover:bg-emerald-700` — repeated as a literal string on ~15 buttons across merchant pages. Should be a `variant="primary"` on the Button component. |
| 14.3 | **Low** | Status badges: the merchant dashboard uses `<Badge variant={p.status === 'COMPLETED' ? 'default' : 'secondary'}>` while list pages use `<StatusBadge status={p.status} />`. Two different ways to render the same status. |
| 14.4 | **Low** | Typography: most pages use `text-2xl font-bold tracking-tight` for h1. The `PageHeader` component uses the same. Consistent. |
| 14.5 | **Low** | Card styling is consistent — all pages use the same `<Card><CardContent className="p-5">` pattern. |
| 14.6 | **Low** | The emerald/teal gradient logo box appears in 3 different sizes across the app: 32×32 (sidebar), 40×40 (login), 48×48 (landing). Acceptable but could be unified. |

### Verdict
Visual consistency is **surprisingly good** — the design system is mostly adhered to. The problems are in *implementation duplication*, not *visual divergence*.

---

## 15. Mobile Experience

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 15.1 | **High** | The sidebar slides in on mobile via `useState` — works. But there is **no swipe-to-close, no escape-key handling, no route-change auto-close in `AppShell`** (the `RoleShell` does call `setSidebarOpen(false)` on link click, but `AppShell` does not). Inconsistent. |
| 15.2 | **High** | **Tables do not work on mobile.** Every list page uses `<Table>` with 5-7 columns. On a 375px screen, the table overflows horizontally with no `overflow-x-auto` wrapper. Try `/dashboard/payments` on mobile — the table just clips. |
| 15.3 | **Medium** | Forms (where they exist — login, waitlist) are usable on mobile. The checkout builder's two-column grid collapses to single column. OK. |
| 15.4 | **Medium** | The KPI card grids use `sm:grid-cols-2 lg:grid-cols-4` — collapses to 1 column on mobile. Fine. But 4 KPI cards stacked is a lot of scroll. |
| 15.5 | **Medium** | The header on mobile still shows the search and bell icons (which do nothing). They take space that could be used for a page title or breadcrumbs. |
| 15.6 | **Low** | The hosted checkout `/pay/[paymentId]` is mobile-friendly (centered max-w-md card). Pity it's fake. |

### Verdict
Mobile is **broken for the primary use case** (merchants checking payments on their phone). Tables overflow, no horizontal scroll, no responsive card alternative.

---

## 16. Missing Features

Direct comparison against the reference platforms (Stripe, Shopify, Mercury, Linear):

| Feature | Status |
|---|---|
| Sandbox / Live mode toggle | **Missing** — no toggle anywhere. The developer sandbox page just says "Sandbox mode" in a static banner. |
| Organization switching | **Missing** — a user belongs to one merchant. No switcher. |
| Role switching (multi-role users) | **Missing** — a user with both MERCHANT and ADMIN roles must manually navigate to `/admin` or `/dashboard`. No switcher in the shell. |
| Notification center | **Missing** — the bell icon is decorative. No `Notification` table, no toast feed, no unread counter. |
| Global search | **Missing** — the search icon is decorative. The `/support/search` page is a static list. |
| Command palette (⌘K) | **Missing** — no `Command`/`cmdk` integration despite the `command.tsx` UI primitive existing. |
| Real-time updates | **Missing** — no WebSocket, no SSE, no polling. Pages only refresh on navigation. |
| Dark/light mode toggle | **Missing** — `ThemeProvider` is hardcoded `defaultTheme="dark" enableSystem={false}` (`src/app/layout.tsx:20`). A `ThemeToggle` component exists in `simulator/theme-toggle.tsx` but is **never used in any shell**. |
| Breadcrumbs | **Missing** |
| Filters / search on list pages | **Missing** — no list page has a search input, date filter, status filter, or column sort. |
| Pagination | **Missing** — every list page uses `take: 100` and renders all rows. No `<Pagination>` component used (despite existing in `ui/pagination.tsx`). |
| Bulk actions | **Missing** |
| CSV / PDF export | **Missing** — the reports page has buttons, none work. |
| 2FA enrollment | **Missing** — `User.mfaEnabled` field exists, no UI. |
| Audit log detail view | **Missing** — `/admin/audit` and `/support/audit` list logs but clicking a row does nothing. |
| Activity feed | **Missing** |
| Onboarding checklist | **Missing** |
| In-app guides / tooltips | **Missing** |
| Webhook delivery retry | **Missing** — no UI for it. |
| API key rotation | **Missing** |
| Refund against a specific payment | **Missing** — the "New refund" button doesn't even exist functionally. |
| Invoice preview / PDF | **Missing** |
| Customer detail view | **Missing** — `/dashboard/customers` is a flat table, no click-through. |
| Payment detail view | **Missing** — `/dashboard/payments` rows are not clickable. |
| Payout detail view | **Missing** |

### Verdict
Compared to Stripe, **PaySwap is missing ~20 features that merchants consider table-stakes**. The app has the *page real estate* for many of these (e.g. the bell icon is there) but the functionality behind them is absent.

---

## 17. Database & Persistence

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 17.1 | **Critical** | **The entire `src/protocol/**` tree (~150 files) is in-memory.** `transactionEngine`, `payoutService`, `merchantPlatform`, `walletService`, `webhookEngine`, `twinTokenEngine`, `qrService`, `liquidityMarketplace`, `lpLifecycle`, `eventEngine`, `connectors-v2/*` — all hold state in module-level `Map`s and arrays. **None of them write to PostgreSQL.** |
| 17.2 | **Critical** | The DB-backed pages (`/dashboard/payments`, `/dashboard/payouts`, `/admin/merchants`, `/portal/wallet`, etc.) read from PostgreSQL. The protocol-backed APIs (`/api/payments`, `/api/merchant/payout`, `/api/merchant/onboard`, `/api/wallets`, `/api/webhooks`) write to in-memory. **The two halves of the app are disconnected.** A merchant who calls the API to create a payment will never see it in their dashboard. |
| 17.3 | **Critical** | In-memory state is **per-process**. On Next.js dev with HMR, every file change wipes the protocol state. In production with multiple pods, each pod has its own state. There is no Redis, no shared cache, no persistence layer. |
| 17.4 | **High** | The admin "Simulate payment" / "Simulate payout" / "Simulate AML alert" endpoints (`/api/admin/simulate/*`) **do** write to PostgreSQL. So the dashboards *can* show data — but only data that an admin manually simulated. Real payment creation (via `/api/payments`) does not. |
| 17.5 | **High** | Orphaned protocol modules: `src/kernel/**` (43 files), `src/protocol/**` (~150 files), `src/extensions/**`, `src/domains/**` — a huge amount of code that is not connected to the DB and only exercised by the admin kernel simulator. From a product perspective, this code is dead weight: it does not power any user-facing feature. |
| 17.6 | **Medium** | No database migrations beyond the initial schema. No seed data script that creates a working merchant+customer+payment end-to-end (the existing seed creates demo logins but not a full payment flow). |
| 17.7 | **Medium** | The Prisma schema (614 lines) is rich — `Payment`, `Payout`, `Refund`, `Invoice`, `Subscription`, `Product`, `CustomerRecord`, `Wallet`, `WalletTransaction`, `ApiKey`, `WebhookEndpoint`, `TeamMember`, `AMLAlert`, `ComplianceReview`, `SAR`, `AuditLog`, `LPProfile`, `Merchant`, `Account`, `User`, `UserRole`, `WaitlistEntry`. **The schema is ready for production; the code that should write to it isn't.** |

### Verdict
The database is **fully modeled but barely written to**. ~95% of the protocol code is in-memory theater. The pages that *read* from the DB work; the APIs that *write* don't.

---

## 18. Missing Backend Functionality

### Findings

| # | Severity | Finding |
|---|----------|---------|
| 18.1 | **Critical** | **Cannot create a payment via the UI.** No button. The API exists but writes to in-memory, not DB. |
| 18.2 | **Critical** | **Cannot create a payout via the UI.** No button. The API exists but writes to in-memory. |
| 18.3 | **Critical** | **Customers cannot pay invoices.** No "Pay" button on `/portal/invoices`. The hosted checkout `/pay/[paymentId]` is fake. |
| 18.4 | **Critical** | **Webhooks are not actually delivered.** The `/api/webhooks` `emit` action calls `webhookEngine.emit()` which is in-memory and **does not make HTTP requests to the registered URL** (it just records a fake "delivery" object). The source: `src/protocol/webhooks/engine.ts`. |
| 18.5 | **Critical** | **API keys are not validated.** No middleware or route handler reads `Authorization: Bearer ...` and looks up the `ApiKey` table. The `ApiKey` rows exist but are decorative. |
| 18.6 | **Critical** | **No payment status webhook fired.** Even if a payment were created, no `payment.completed` event would be delivered to any merchant endpoint. |
| 18.7 | **Critical** | **No KYC submission endpoint.** The `ComplianceReview` table can only be populated by direct DB writes — no API or UI creates one. |
| 18.8 | **Critical** | **No refund execution.** The refund API doesn't exist. The "New refund" button doesn't exist. |
| 18.9 | **Critical** | **No invoice creation.** No API, no UI button. |
| 18.10 | **Critical** | **No product creation.** No API (the `merchantPlatform.createProduct` is in-memory), no UI button. |
| 18.11 | **Critical** | **No team member invitation.** No API, no UI button. The `TeamMember` table has an `invitedAt` field — never written to. |
| 18.12 | **High** | **No merchant onboarding API that writes to DB.** `/api/merchant/onboard` uses in-memory `merchantPlatform`. The only way to create a real `Merchant` row is the seed script. |
| 18.13 | **High** | **No LP fulfillment API.** LPs cannot settle a payment. No endpoint exists. |
| 18.14 | **High** | **No compliance action API.** No endpoint to close an AML alert, approve KYC, file a SAR. |
| 18.15 | **High** | **No treasury action API.** No endpoint to freeze reserves, open/close a corridor, rebalance. `/api/treasury/freeze` exists but is a stub with a comment `// admin only in production`. |
| 18.16 | **High** | **No email sending.** No transactional email for waitlist confirmation, merchant approval, invoice issued, payout completed. The waitlist page tells the user "Check your email for confirmation" — no email is sent. |

### Verdict
**The backend is missing every money-movement and configuration endpoint that matters.** What exists is a mix of (a) in-memory simulators that don't persist and (b) read-only DB queries. There is no write path from "user clicks button" → "DB row created" → "downstream effect happens" for any primary action.

---

## 19. Prioritized Fix List

Ordered by impact × urgency. Each item is a concrete workstream.

### P0 — Blockers (must fix before any user touches this)

1. **Wire every money-movement API to PostgreSQL.** Replace `transactionEngine` / `payoutService` / `merchantPlatform` / `walletService` / `webhookEngine` with DB-backed implementations (or persistence adapters). Today the API and the dashboard read different sources. **(§12.2–12.6, §17.1–17.3)**
2. **Add authentication to every `/api/**` route.** Specifically: `/api/payments`, `/api/payment-links`, `/api/merchant/payout`, `/api/merchant/onboard`, `/api/merchant/qr`, `/api/merchant/state`, `/api/wallets`, `/api/webhooks`. Use `requireMerchant()` / `requireAdmin()` from `auth-guards.ts`. **(§3.1, §3.3, §3.4, §3.5)**
3. **Fix `/api/admin/waitlist` PATCH to require ADMIN role** (not just any session). **(§3.2)**
4. **Make waitlist approval actually provision a merchant login.** When admin approves, create a `User` (with a random temp password or magic-link), a `Merchant`, a `UserRole(MERCHANT)`, and send an email. **(§4.1, §5.1)**
5. **Build the real hosted checkout at `/pay/[paymentId]`.** Fetch the payment from DB, render amount/merchant/reference, accept payment method selection, call a real `POST /api/payments/:id/confirm` endpoint, write the result back to DB. **(§4.4, §12.1)**
6. **Add a "Create payment" flow on `/dashboard/payments`.** Modal or page → amount, currency, customer, description → `POST /api/payments` (DB-backed) → redirect to the new payment or copy its `/pay/:id` link. **(§4.2, §11)**
7. **Add a "Create payout" flow on `/dashboard/payouts`.** Quote → confirm → execute → DB write. **(§4.3, §11)**
8. **Add `error.tsx` at the root and per role group.** Today any server error shows the raw Next.js error page. **(§8.1)**

### P1 — Critical UX gaps (fix before "launch")

9. **Make settings editable.** `/dashboard/settings` needs a form with save. `/dashboard/settings/api-keys` needs a real "Create key" modal that inserts an `ApiKey` row and shows the secret once. Same for webhooks and team. **(§9, §11)**
10. **Add "Pay now" to customer invoices** that links to the real `/pay/[paymentId]`. **(§4.4)**
11. **Add action buttons to compliance, LP, treasury, ops pages.** Close alert, fulfill position, freeze reserve, retry connector — even one action per page would transform these from dashboards into workspaces. **(§4.6, §4.7, §11)**
12. **Unify the shells.** Delete `app-shell.tsx`, move `merchantNav` and `adminNav` into the merchant and admin layout files, use `RoleShell` everywhere. **(§2.1, §13.1)**
13. **Make the header search and bell functional** or remove them. A decorative search icon on every page is worse than no search icon. **(§2.2)**
14. **Fix mobile tables.** Wrap every `<Table>` in `overflow-x-auto`, or switch to a card list on `<sm`. **(§15.2)**
15. **Add a dark/light theme toggle.** The component already exists — wire it into both shells. Stop hardcoding `defaultTheme="dark"`. **(§16)**
16. **Add a sandbox/live mode toggle** in the merchant header. Persist it in the session. Pass it as a header to every API call. **(§16)**

### P2 — Polish (fix before scaling)

17. **Add pagination to every list page** (`<Pagination>` component already exists). **(§16)**
18. **Add filters to list pages** (status, date range, search). **(§16)**
19. **Add a command palette (⌘K)** using the existing `command.tsx` primitive. **(§16)**
20. **Add a real notification center.** Persist notifications in a `Notification` table; show unread count on the bell. **(§16)**
21. **Add breadcrumbs.** **(§1.5)**
22. **Make the merchant dashboard KPIs correct.** "Revenue" should sum all completed payments, not the last 10. Add `db.payment.aggregate`. **(§6.1, §6.2)**
23. **Add a real chart library** (Recharts is already a dependency) to merchant analytics, admin overview, treasury. **(§6.5)**
24. **Add empty-state CTAs.** Extend the `EmptyState` component to accept an `action` prop. **(§7.1, §7.2)**
25. **Extract the shared `Field` / `DisplayField` component** and use it across the 3 settings pages. **(§13.3)**
26. **Make the QR code real.** Use `qrcode` npm package or a backend endpoint. The current `buildQrMatrix` is art, not a QR. **(§12.8)**
27. **Add a merchant onboarding wizard** (3-4 steps: business info → KYC → bank account → first product). **(§5)**
28. **Add a real developer API explorer** that executes requests against the sandbox. **(§10.1)**
29. **Send transactional emails** (waitlist confirmation, merchant approval, invoice issued, payout completed). **(§18.16)**
30. **Remove `NEXTAUTH_SECRET` hardcoded fallback.** Fail fast if the env var is missing. **(§3.10)**

### P3 — Hygiene

31. Delete the ~150 in-memory protocol files that aren't wired to anything user-facing, or wire them to the DB. They are dead weight today. **(§17.5)**
32. Consolidate `fmt`/`fmtDate` helpers into `role-ui.tsx` and import everywhere. **(§13.5)**
33. Replace inline KPI markup in merchant pages with `<KpiCard>`. **(§14.1)**
34. Add a `variant="primary"` to the Button component so `bg-emerald-600` isn't copy-pasted 15 times. **(§14.2)**
35. Fix the landing page footer year (says 2026). **(§1.6)**

---

## 20. The Key Question

> **"Would a real merchant be able to use this platform to run their business?"**

**No.** A real merchant logging into PaySwap today would find:

- A dashboard showing zero payments (because there's no way to create one).
- A "New payment link" button that does nothing when clicked.
- A "Payouts" page with no way to withdraw money.
- An "API Keys" page with no way to generate a key.
- A "Webhooks" page with no way to register an endpoint.
- A "Settings" page that doesn't let them edit a single field.
- A "Reports" page where none of the export buttons work.
- A "Checkout Builder" that doesn't save.
- A hosted checkout URL that always shows "Amount: 500 GHS, settled" no matter what.
- A customer portal where their customers cannot pay invoices.
- No way to onboard, no KYC, no setup wizard, no first-payment guidance.

The app **looks** like Stripe from 10 feet away. Up close, every button is a sticker.

---

## Appendix A — File Inventory

- **Pages:** 58 `page.tsx` files
- **API routes:** 40 `route.ts` files
- **Layouts:** 10 `layout.tsx` files (1 root + 9 role groups)
- **Loading states:** 9 `loading.tsx` files (at role-group level; none at sub-route level)
- **Error states:** 0 `error.tsx` files
- **Shells:** 2 (`app-shell.tsx`, `role-shell.tsx`)
- **Client-side pages (with `'use client'`):** 6 — landing, login, waitlist, qr, checkout-builder, hosted-checkout
- **Working client→API fetches from pages:** 2 (waitlist submit, admin waitlist approve/reject) + 3 in the admin kernel simulator
- **In-memory protocol modules (not DB-backed):** ~150 files in `src/protocol/**` + 43 in `src/kernel/**`
- **DB-backed pages:** ~45 (every dashboard and list page reads from PostgreSQL)
- **DB-backed APIs:** ~5 (`/api/waitlist`, `/api/admin/waitlist`, `/api/admin/stats`, `/api/admin/simulate/*`, `/api/admin/simulate/aml`)

## Appendix B — The Six Working Things

For honesty, here is the complete list of things in the app that actually work end-to-end:

1. **Login** (NextAuth credentials provider, bcrypt-checked against DB)
2. **Waitlist submission** (writes to `WaitlistEntry`)
3. **Admin waitlist approve/reject** (writes `status`/`reviewedBy`/`reviewedAt` — but does NOT provision a login)
4. **Admin simulate payment/payout/AML** (writes real rows to `Payment`/`Payout`/`AMLAlert` + `AuditLog`)
5. **Admin kernel simulator** (in-memory, but the UI is functional — run scenarios, replay, inspect)
6. **Logout**

That is the entire functional surface of PaySwap today. Everything else is either read-only, decorative, or fake.

---

**End of audit.**
