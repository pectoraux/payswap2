/**
 * PaySwap Protocol — Merchant Platform (v2) — Types.
 *
 * The v2 merchant platform expands the original MerchantPlatform with the
 * full surface area needed for production merchant operations:
 *
 *   - Subscription billing (plans, trials, past-due retry, cancel/pause/resume)
 *   - Refunds (full + partial, with approval threshold + per-payment tracking)
 *   - Invoices (sequential numbering, draft → sent → paid → overdue → void)
 *   - Catalogs (group products for organisation / store-front layout)
 *   - Payment requests (shareable pay-links with expiry)
 *   - Multi-user organisations (multiple merchants + team members)
 *   - Team management + RBAC (owner/admin/developer/analyst/viewer/support)
 *   - API key management (live + test keys, scopes, expiry, rotation, usage)
 *   - OAuth2 provider (authorisation-code flow with HMAC-SHA256 signed tokens)
 *   - Webhook replay (re-deliver past webhook deliveries after an outage)
 *
 * Design notes:
 *  - All identifiers are opaque strings (`merchantId`, `subscriptionId`, …).
 *  - Timestamps are epoch milliseconds (`Date.now()`).
 *  - All monetary amounts are plain numbers in the currency-native unit.
 *  - Status / state unions are string-literal types so the audit trail is
 *    self-describing.
 *
 * The kernel is FROZEN — this module imports only type definitions from
 * `@/kernel/types` (none today, but kept for future use). No kernel files
 * are modified.
 */

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/** Billing interval for a subscription plan. */
export type SubscriptionInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * A subscription plan is a billable template owned by a merchant.
 *
 *  - `amount`     — amount charged per interval (in `currency`).
 *  - `interval`   — billing cadence.
 *  - `trialDays`  — optional trial period (subscription enters 'trialing'
 *                   state until `trialEnd`, then 'active' on first charge).
 *  - `metadata`   — free-form merchant metadata (e.g. tier name, features).
 */
export interface SubscriptionPlan {
  id: string;
  merchantId: string;
  name: string;
  amount: number;
  currency: string;
  interval: SubscriptionInterval;
  trialDays?: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}

/** Subscription lifecycle states. */
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'paused';

/**
 * A subscription is a customer's active billing relationship with a plan.
 *
 *  - `currentPeriodStart` / `currentPeriodEnd` — the billing window the
 *    customer has paid for. `processBilling` advances these by one interval.
 *  - `cancelAt`    — if set, the subscription will be canceled at period end.
 *  - `canceledAt`  — set when cancellation takes effect (immediately or at
 *                    period end).
 *  - `trialEnd`    — set during the 'trialing' state.
 *  - `lastPaymentAt` — timestamp of the last successful charge.
 *  - `failedAttempts` — number of consecutive failed billing attempts (used
 *                    by the past-due retry schedule).
 */
export interface Subscription {
  id: string;
  planId: string;
  merchantId: string;
  customerId: string;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAt?: boolean;
  canceledAt?: number;
  trialEnd?: number;
  lastPaymentAt?: number;
  failedAttempts: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/** Refund type. */
export type RefundType = 'full' | 'partial';

/** Refund lifecycle states. */
export type RefundStatus =
  | 'pending'
  | 'approved'
  | 'processed'
  | 'rejected';

/**
 * A refund request against a previously captured payment.
 *
 *  - `type`     — `full` refunds the entire payment amount; `partial`
 *                 refunds a portion (the service tracks the total refunded
 *                 per payment so cumulative partials cannot exceed the
 *                 original amount).
 *  - `reason`   — merchant-supplied reason (e.g. 'customer_request').
 *  - `requestedBy` — id of the team member / API key that requested it.
 *  - `processedAt` — set when the refund transitions to `processed` /
 *                 `rejected`.
 */
export interface Refund {
  id: string;
  merchantId: string;
  paymentId: string;
  amount: number;
  currency: string;
  type: RefundType;
  reason: string;
  status: RefundStatus;
  requestedAt: number;
  processedAt?: number;
  requestedBy: string;
  approverId?: string;
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** A single line item on an invoice. */
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/** Invoice lifecycle states. */
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void';

/**
 * An invoice is a formal request for payment issued by a merchant to a
 * customer.
 *
 *  - `number`  — sequential per-merchant invoice number (`INV-0001`, …).
 *  - `subtotal` / `tax` / `total` — computed from `items`.
 *  - `dueDate` — when payment is due; invoices past `dueDate` and unpaid
 *                transition to `overdue`.
 *  - `sentAt` / `paidAt` — lifecycle timestamps.
 */
export interface Invoice {
  id: string;
  merchantId: string;
  customerId: string;
  number: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  dueDate: number;
  createdAt: number;
  sentAt?: number;
  paidAt?: number;
  paymentId?: string;
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/**
 * A catalog groups product IDs for organisational purposes (e.g. a merchant
 * might have a 'Retail' catalog and a 'Wholesale' catalog).
 */
export interface Catalog {
  id: string;
  merchantId: string;
  name: string;
  products: string[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Payment requests
// ---------------------------------------------------------------------------

/** Payment request lifecycle states. */
export type PaymentRequestStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'canceled';

/**
 * A payment request is a shareable pay-link a merchant issues to a customer.
 *
 *  - `customerId` — optional (anonymous pay-links are allowed).
 *  - `reference`  — merchant-supplied reference (e.g. order id).
 *  - `expiresAt`  — the link stops accepting payments after this timestamp.
 *  - `paymentId`  — set once a customer pays the request.
 */
export interface PaymentRequest {
  id: string;
  merchantId: string;
  customerId?: string;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  status: PaymentRequestStatus;
  expiresAt: number;
  createdAt: number;
  paidAt?: number;
  paymentId?: string;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * A multi-merchant organisation. Owners control the org; merchants are
 * linked to it; team members are invited per-org.
 */
export interface Organization {
  id: string;
  name: string;
  merchants: string[];
  owners: string[];
  billingEmail: string;
  taxId?: string;
  address: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/** Team member roles (RBAC). */
export type TeamRole =
  | 'owner'
  | 'admin'
  | 'developer'
  | 'analyst'
  | 'viewer'
  | 'support';

/** Team member lifecycle states. */
export type TeamMemberStatus = 'pending' | 'active' | 'suspended';

/**
 * A team member is a user invited to a merchant or organisation.
 *
 *  - `scope`       — either a `merchantId` or an `orgId` (the member is
 *                    attached to whichever scope was used at invite time).
 *  - `permissions` — derived from `role` via the permission matrix, but
 *                    stored explicitly so individual grants can be audited.
 */
export interface TeamMember {
  id: string;
  scope: string;           // merchantId or orgId
  scopeType: 'merchant' | 'org';
  email: string;
  role: TeamRole;
  permissions: string[];
  invitedAt: number;
  joinedAt?: number;
  status: TeamMemberStatus;
}

/**
 * An outstanding team invitation (not yet accepted).
 */
export interface TeamInvitation {
  id: string;
  scope: string;
  scopeType: 'merchant' | 'org';
  email: string;
  role: TeamRole;
  token: string;
  invitedAt: number;
  acceptedAt?: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

/** All scopes an API key can hold. */
export type ApiKeyScope =
  | 'payments:read'
  | 'payments:write'
  | 'payouts:read'
  | 'payouts:write'
  | 'webhooks:read'
  | 'webhooks:write'
  | 'merchant:read'
  | 'merchant:write';

/** Environment an API key belongs to. */
export type ApiKeyEnvironment = 'live' | 'test';

/**
 * An API key issued to a merchant.
 *
 *  - `key`       — the full secret (`psk_live_…` / `psk_test_…`), shown
 *                  ONCE at creation time.
 *  - `keyPrefix` — a display-safe prefix (`psk_live_xxxx****`).
 *  - `scopes`    — list of `ApiKeyScope` strings.
 *  - `expiresAt` — optional expiry; absent means non-expiring.
 *  - `rotatedFrom` — set when this key is a rotation of a prior key.
 *                    The prior key is kept active for a grace period.
 *  - `lastUsedAt` / `usageCount` — usage telemetry.
 */
export interface ApiKey {
  id: string;
  merchantId: string;
  label: string;
  key: string;
  keyPrefix: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  active: boolean;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  rotatedFrom?: string;
  lastUsedAt?: number;
  usageCount: number;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/**
 * A registered OAuth2 application (owned by a merchant).
 *
 *  - `clientId` / `clientSecret` — issued once at registration.
 *  - `redirectUris` — allowed callback URIs.
 *  - `scopes`       — scopes this app can request.
 */
export interface OAuthApp {
  id: string;
  merchantId: string;
  name: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  scopes: string[];
  createdAt: number;
}

/**
 * An OAuth2 token pair (access + refresh).
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
  merchantId: string;
}

/**
 * An outstanding authorisation code (short-lived, single-use).
 */
export interface OAuthAuthorizationCode {
  code: string;
  clientId: string;
  merchantId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  expiresAt: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Webhook replay
// ---------------------------------------------------------------------------

/** Webhook replay lifecycle states. */
export type WebhookReplayStatus = 'pending' | 'replayed' | 'failed';

/**
 * A request to re-deliver a past webhook delivery (after an endpoint outage).
 */
export interface WebhookReplayRequest {
  id: string;
  merchantId: string;
  deliveryId: string;
  status: WebhookReplayStatus;
  requestedAt: number;
  replayedAt?: number;
  error?: string;
  newDeliveryId?: string;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** A simple time range filter (epoch milliseconds). */
export interface TimeRange {
  from?: number;
  to?: number;
}

/** A refund list filter. */
export interface RefundFilter extends TimeRange {
  status?: RefundStatus;
  type?: RefundType;
  paymentId?: string;
}

/** An invoice list filter. */
export interface InvoiceFilter extends TimeRange {
  status?: InvoiceStatus;
  customerId?: string;
}

/** A payment-request list filter. */
export interface PaymentRequestFilter extends TimeRange {
  status?: PaymentRequestStatus;
  customerId?: string;
}

/** A webhook-replay list filter. */
export interface WebhookReplayFilter extends TimeRange {
  status?: WebhookReplayStatus;
}
