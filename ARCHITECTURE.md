# PaySwap — Product Architecture (Phase 1)

> **Principle**: Think like Stripe, Shopify, Mercury, Linear — not like a demo.
> **Constraint**: Kernel frozen. Everything above the kernel.

---

## 1. Personas

| # | Persona | Description | Landing Page | Key Actions |
|---|---------|-------------|--------------|-------------|
| 1 | **Guest** | Unauthenticated visitor | `/` (marketing) | Browse marketing, join waitlist, view docs |
| 2 | **Customer** | End user who pays merchants | `/portal` | Pay invoices, view payment history, download receipts, manage wallet |
| 3 | **Merchant** | Business owner accepting payments | `/dashboard` | View analytics, manage products, process payouts, configure checkout |
| 4 | **Merchant Staff** | Merchant team member | `/dashboard` | Role-limited merchant actions (developer: API keys; analyst: reports; support: refunds) |
| 5 | **LP** | Liquidity Provider | `/lp` | View capacity, settlement history, profitability, manage stake |
| 6 | **Treasury** | Treasury operator | `/treasury` | Monitor reserves, manage corridors, approve large payouts, run stress tests |
| 7 | **Compliance** | Compliance officer | `/compliance` | Review AML alerts, sanctions hits, KYC/KYB, file SARs, manage cases |
| 8 | **Support** | Customer support agent | `/support` | Search merchants/payments, process refunds, replay webhooks, view audit trail |
| 9 | **Developer** | External developer integrating API | `/developers` | API docs, API explorer, webhook tester, sandbox, SDK downloads |
| 10 | **Operations** | Ops engineer | `/ops` | System health, circuit breakers, connectors, DR status, deployment |
| 11 | **Admin** | Platform administrator | `/admin` | Approve waitlist, manage users, configure corridors, view all data |
| 12 | **Super Admin** | Full system access | `/admin` | Everything admin does + system config, feature flags, emergency freeze |

---

## 2. Sitemap (Complete Route Hierarchy)

```
/                                   → Marketing landing (guest)
/waitlist                           → Waitlist signup form
/login                              → Login page
/login/[role]                       → Role-specific login (demo quick-login buttons)

# === CUSTOMER PORTAL ===
/portal                             → Customer dashboard (recent payments, wallet balance)
/portal/payments                    → Payment history
/portal/payments/[id]               → Payment detail + receipt download
/portal/wallet                      → Wallet balance + Twin Token holdings
/portal/wallet/deposit              → Deposit funds
/portal/wallet/withdraw             → Withdraw funds
/portal/invoices                    → Outstanding invoices
/portal/invoices/[id]               → Pay invoice
/portal/payment-methods             → Saved payment methods
/portal/profile                     → Profile + security settings

# === MERCHANT DASHBOARD ===
/dashboard                          → Overview (revenue, volume, recent activity)
/dashboard/payments                 → Payments list
/dashboard/payments/[id]            → Payment detail
/dashboard/payouts                  → Payouts list
/dashboard/payouts/new              → Create payout
/dashboard/payouts/[id]             → Payout detail
/dashboard/customers                → Customers list
/dashboard/customers/[id]           → Customer detail (history, lifetime value)
/dashboard/products                 → Products list
/dashboard/products/new             → Create product
/dashboard/products/[id]            → Edit product
/dashboard/invoices                 → Invoices list
/dashboard/invoices/new             → Create invoice
/dashboard/invoices/[id]            → Invoice detail (send, mark paid, void)
/dashboard/subscriptions            → Subscriptions list
/dashboard/subscriptions/new        → Create subscription plan
/dashboard/subscriptions/[id]       → Subscription detail
/dashboard/refunds                  → Refunds list
/dashboard/refunds/new              → Create refund
/dashboard/checkout                 → Checkout builder (visual)
/dashboard/checkout/[id]            → Edit checkout config
/dashboard/payment-links            → Payment links list
/dashboard/payment-links/new        → Create payment link
/dashboard/qr                       → QR payments (generate, manage)
/dashboard/analytics                → Analytics dashboard (charts)
/dashboard/reports                  → Reports (financial, tax, settlement)
/dashboard/reports/[type]           → Generate specific report
/dashboard/extensions               → Extension marketplace
/dashboard/settings                 → Merchant settings (profile, branding, team)
/dashboard/settings/team            → Team management (invite, roles)
/dashboard/settings/api-keys        → API key management
/dashboard/settings/webhooks        → Webhook endpoints + deliveries
/dashboard/settings/branding        → Logo, colors, checkout theme

# === LP PORTAL ===
/lp                                 → LP overview (capacity, utilization, PnL)
/lp/positions                       → Active positions + collateral
/lp/settlements                     → Settlement history
/lp/profitability                   → Profitability analytics
/lp/stake                           → Manage stake (add/withdraw)
/lp/settings                        → LP settings

# === TREASURY ===
/treasury                           → Treasury overview (reserves, backing ratio)
/treasury/reserves                  → Reserve management
/treasury/corridors                 → Corridor funding + rebalancing
/treasury/limits                    → Mint/burn limits
/treasury/stress-tests              → Run stress tests
/treasury/reports                   → Daily treasury reports
/treasury/settings                  → Treasury settings

# === COMPLIANCE ===
/compliance                         → Compliance overview (alerts, cases, stats)
/compliance/alerts                  → AML alerts queue
/compliance/alerts/[id]             → Alert detail + investigation
/compliance/sanctions               → Sanctions hits
/compliance/sanctions/[id]          → Hit review (true positive / false positive)
/compliance/cases                   → Case management
/compliance/cases/[id]              → Case detail (escalate, file SAR)
/compliance/kyc                     → KYC review queue
/compliance/kyc/[id]                → Review KYC documents
/compliance/kyb                     → KYB review queue
/compliance/sar                     → SAR filings
/compliance/audit                   → Regulatory audit exports
/compliance/settings                → Compliance settings

# === SUPPORT ===
/support                            → Support overview (open tickets, search)
/support/search                     → Global search (merchants, payments, payouts)
/support/payments                   → Payment lookup + refund
/support/webhooks                   → Webhook replay
/support/audit                      → Audit trail viewer

# === DEVELOPER PORTAL ===
/developers                         → Developer overview
/developers/docs                    → API documentation
/developers/docs/[section]          → API doc section
/developers/explorer                → Interactive API explorer
/developers/webhooks                → Webhook tester
/developers/sandbox                 → Sandbox environment
/developers/sdk                     → SDK downloads (TS, Go, Python, Java, C#)
/developers/openapi                 → OpenAPI spec viewer
/developers/examples                → Example applications

# === OPERATIONS ===
/ops                                → Ops overview (system health, SLOs)
/ops/health                         → Detailed health check
/ops/connectors                     → Connector health + metrics
/ops/circuit-breakers               → Circuit breaker states
/ops/dr                             → Disaster recovery status
/ops/deployments                    → Deployment history
/ops/incidents                      → Incident management
/ops/metrics                        → Prometheus metrics viewer

# === ADMIN ===
/admin                              → Admin overview (platform stats)
/admin/waitlist                     → Waitlist management (approve/reject)
/admin/users                        → User management
/admin/users/[id]                   → User detail (roles, permissions)
/admin/merchants                    → All merchants
/admin/merchants/[id]               → Merchant detail (override, freeze)
/admin/corridors                    → Corridor configuration
/admin/feature-flags                → Feature flag management
/admin/emergency                    → Emergency freeze controls
/admin/audit                        → System-wide audit trail
/admin/settings                     → Platform settings
```

---

## 3. Role-Based Navigation Maps

### Guest Navigation
```
Logo → /            Docs → /developers/docs        Login → /login
Features → /#features   Pricing → /#pricing        Join Waitlist → /waitlist
```

### Customer Navigation (sidebar)
```
Home → /portal
Payments → /portal/payments
Wallet → /portal/wallet
Invoices → /portal/invoices
Payment Methods → /portal/payment-methods
Profile → /portal/profile
```

### Merchant Navigation (sidebar — collapsible groups)
```
── Overview ──
  Dashboard → /dashboard
  Analytics → /dashboard/analytics
  Reports → /dashboard/reports

── Accept Payments ──
  Payments → /dashboard/payments
  Checkout Builder → /dashboard/checkout
  Payment Links → /dashboard/payment-links
  QR Payments → /dashboard/qr

── Manage Business ──
  Customers → /dashboard/customers
  Products → /dashboard/products
  Invoices → /dashboard/invoices
  Subscriptions → /dashboard/subscriptions
  Refunds → /dashboard/refunds

── Payouts ──
  Payouts → /dashboard/payouts
  New Payout → /dashboard/payouts/new

── Extensions ──
  Marketplace → /dashboard/extensions

── Settings ──
  General → /dashboard/settings
  Team → /dashboard/settings/team
  API Keys → /dashboard/settings/api-keys
  Webhooks → /dashboard/settings/webhooks
  Branding → /dashboard/settings/branding
```

### LP Navigation (sidebar)
```
Overview → /lp
Positions → /lp/positions
Settlements → /lp/settlements
Profitability → /lp/profitability
Stake → /lp/stake
Settings → /lp/settings
```

### Treasury Navigation (sidebar)
```
Overview → /treasury
Reserves → /treasury/reserves
Corridors → /treasury/corridors
Limits → /treasury/limits
Stress Tests → /treasury/stress-tests
Reports → /treasury/reports
Settings → /treasury/settings
```

### Compliance Navigation (sidebar)
```
Overview → /compliance
AML Alerts → /compliance/alerts
Sanctions → /compliance/sanctions
Cases → /compliance/cases
KYC Review → /compliance/kyc
KYB Review → /compliance/kyb
SARs → /compliance/sar
Audit Exports → /compliance/audit
Settings → /compliance/settings
```

### Support Navigation (sidebar)
```
Overview → /support
Search → /support/search
Payments → /support/payments
Webhooks → /support/webhooks
Audit Trail → /support/audit
```

### Developer Navigation (sidebar — external developers)
```
Overview → /developers
API Docs → /developers/docs
API Explorer → /developers/explorer
Webhook Tester → /developers/webhooks
Sandbox → /developers/sandbox
SDKs → /developers/sdk
OpenAPI → /developers/openapi
Examples → /developers/examples
```

### Operations Navigation (sidebar)
```
Overview → /ops
Health → /ops/health
Connectors → /ops/connectors
Circuit Breakers → /ops/circuit-breakers
Disaster Recovery → /ops/dr
Deployments → /ops/deployments
Incidents → /ops/incidents
Metrics → /ops/metrics
```

### Admin Navigation (sidebar)
```
── Platform ──
  Overview → /admin
  Waitlist → /admin/waitlist
  Users → /admin/users
  Merchants → /admin/merchants
  Corridors → /admin/corridors

── System ──
  Feature Flags → /admin/feature-flags
  Emergency → /admin/emergency
  Audit Trail → /admin/audit
  Settings → /admin/settings
```

---

## 4. Permission Matrix

| Action | Customer | Merchant | Staff (Developer) | Staff (Analyst) | Staff (Support) | LP | Treasury | Compliance | Ops | Admin |
|--------|----------|----------|-------------------|-----------------|-----------------|-----|----------|------------|-----|-------|
| View own payments | ✅ | — | — | — | — | — | — | — | — | ✅ |
| Pay invoice | ✅ | — | — | — | — | — | — | — | — | — |
| View merchant dashboard | — | ✅ | ✅ | ✅ | ✅ | — | — | — | — | ✅ |
| Create payment | — | ✅ | ✅ | — | — | — | — | — | — | ✅ |
| Process payout | — | ✅ | — | — | — | — | — | — | — | ✅ |
| Approve large payout | — | — | — | — | — | — | ✅ | — | — | ✅ |
| Manage API keys | — | ✅ | ✅ | — | — | — | — | — | — | ✅ |
| Manage webhooks | — | ✅ | ✅ | — | — | — | — | — | — | ✅ |
| View analytics | — | ✅ | — | ✅ | — | — | — | — | — | ✅ |
| Process refund | — | ✅ | — | — | ✅ | — | — | — | — | ✅ |
| Manage team | — | ✅ | — | — | — | — | — | — | — | ✅ |
| View LP positions | — | — | — | — | — | ✅ | ✅ | — | — | ✅ |
| Manage reserves | — | — | — | — | — | — | ✅ | — | — | ✅ |
| Review AML alerts | — | — | — | — | — | — | — | ✅ | — | ✅ |
| File SAR | — | — | — | — | — | — | — | ✅ | — | ✅ |
| Approve waitlist | — | — | — | — | — | — | — | — | — | ✅ |
| Emergency freeze | — | — | — | — | — | — | ✅ | ✅ | — | ✅ |
| View system health | — | — | — | — | — | — | — | — | ✅ | ✅ |
| Manage feature flags | — | — | — | — | — | — | — | — | — | ✅ |
| Replay webhooks | — | ✅ | ✅ | — | ✅ | — | — | — | — | ✅ |

---

## 5. Database Schema Design

### Strategy
- **Provider**: PostgreSQL (Vercel Postgres / Neon in production; SQLite for local dev with PostgreSQL-compatible Prisma types)
- **ORM**: Prisma
- **Principles**: Normalized, soft deletes (`deletedAt`), audit fields (`createdAt`, `updatedAt`, `createdBy`), indexes on foreign keys + frequently queried fields, constraints (unique, check)

### Core Models

```
// === AUTH ===
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  passwordHash    String?
  name            String?
  phone           String?
  avatarUrl       String?
  status          UserStatus @default(PENDING) // PENDING, ACTIVE, SUSPENDED, FROZEN
  emailVerified   DateTime?
  lastLoginAt     DateTime?
  lastLoginIp     String?
  mfaEnabled      Boolean  @default(false)
  mfaSecret       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  roles           UserRole[]
  accounts        Account[]
  sessions        Session[]
  auditLogs       AuditLog[]
  
  @@index([status])
  @@index([email])
}

model UserRole {
  id          String   @id @default(cuid())
  userId      String
  role        Role     // CUSTOMER, MERCHANT, MERCHANT_STAFF, LP, TREASURY, COMPLIANCE, SUPPORT, DEVELOPER, OPERATIONS, ADMIN, SUPER_ADMIN
  merchantId  String?  // if role is MERCHANT or MERCHANT_STAFF
  permissions Json?    // granular permissions override
  createdAt   DateTime @default(now())
  
  user        User     @relation(fields: [userId], references: [id])
  
  @@unique([userId, role, merchantId])
  @@index([merchantId])
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  token        String   @unique
  expiresAt    DateTime
  ip           String?
  userAgent    String?
  createdAt    DateTime @default(now())
  
  user         User     @relation(fields: [userId], references: [id])
  
  @@index([userId])
  @@index([expiresAt])
}

model WaitlistEntry {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  company      String?
  phone        String?
  country      String
  businessType String?  // INDIVIDUAL, SMALL_BUSINESS, ENTERPRISE, STARTUP, NGO
  status       WaitlistStatus @default(PENDING) // PENDING, APPROVED, REJECTED, CONVERTED
  notes        String?
  reviewedBy   String?
  reviewedAt   DateTime?
  createdAt    DateTime @default(now())
  
  @@index([status])
  @@index([country])
}

// === ACCOUNTS & MERCHANTS ===
model Account {
  id            String   @id @default(cuid())
  userId        String
  type          AccountType // CUSTOMER, MERCHANT, LP
  status        AccountStatus @default(PENDING)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?
  
  user          User     @relation(fields: [userId], references: [id])
  merchant      Merchant?
  customer      Customer?
  lpProfile     LPProfile?
  wallets       Wallet[]
  
  @@index([userId])
  @@index([type, status])
}

model Merchant {
  id              String   @id @default(cuid())
  accountId       String   @unique
  name            String
  legalName       String?
  email           String   @unique
  phone           String?
  country         String
  currency        String   @default("GHS")
  website         String?
  logoUrl         String?
  description     String?
  businessType    String?
  registrationNumber String?
  taxId           String?
  address         Json?
  tier            MerchantTier @default(UNVERIFIED)
  bond            Float    @default(0)
  status          MerchantStatus @default(PENDING)
  kycLevel        Int      @default(0)
  settings        Json?    // checkout theme, auto-settle, etc.
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  
  account         Account  @relation(fields: [accountId], references: [id])
  products        Product[]
  customers       CustomerRecord[]
  invoices        Invoice[]
  payouts         Payout[]
  refunds         Refund[]
  subscriptions   Subscription[]
  paymentLinks    PaymentLink[]
  apiKeys         ApiKey[]
  webhookEndpoints WebhookEndpoint[]
  teamMembers     TeamMember[]
  
  @@index([status])
  @@index([tier])
  @@index([country])
}

model Customer {
  id              String   @id @default(cuid())
  accountId       String?  @unique  // null if guest checkout
  merchantId      String?  // merchant-scoped customer record
  name            String
  email           String
  phone           String?
  country         String?
  metadata        Json?
  totalSpent      Float    @default(0)
  transactionCount Int     @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  
  account         Account? @relation(fields: [accountId], references: [id])
  merchant        Merchant? @relation(fields: [merchantId], references: [id])
  payments        Payment[]
  invoices        Invoice[]
  
  @@index([merchantId])
  @@index([email])
}

model LPProfile {
  id              String   @id @default(cuid())
  accountId       String   @unique
  name            String
  country         String
  currencies      String[] // supported currencies
  tier            String   @default("verified")
  stake           Float    @default(0)
  collateral      Float    @default(0)
  capacity        Json?    // per-corridor capacity
  reputation      Float    @default(0.5)
  status          String   @default("pending")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  account         Account  @relation(fields: [accountId], references: [id])
  
  @@index([status])
}

// === WALLETS ===
model Wallet {
  id              String   @id @default(cuid())
  accountId       String
  name            String
  currency        String
  balance         Float    @default(0)
  pendingBalance  Float    @default(0)
  lockedBalance   Float    @default(0)
  isDefault       Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  account         Account  @relation(fields: [accountId], references: [id])
  transactions    WalletTransaction[]
  
  @@index([accountId])
  @@unique([accountId, currency])
}

model WalletTransaction {
  id              String   @id @default(cuid())
  walletId        String
  type            String   // CREDIT, DEBIT, LOCK, UNLOCK
  amount          Float
  currency        String
  counterparty    String?
  reference       String?
  txHash          String?
  createdAt       DateTime @default(now())
  
  wallet          Wallet   @relation(fields: [walletId], references: [id])
  
  @@index([walletId])
  @@index([createdAt])
}

// === PAYMENTS ===
model Payment {
  id              String   @id @default(cuid())
  merchantId      String
  customerId      String?
  amount          Float
  currency        String
  sourceCurrency  String?
  destinationCurrency String?
  status          PaymentStatus @default(PENDING)
  method          String?  // CARD, MOBILE_MONEY, BANK, QR, PAYMENT_LINK, CHECKOUT
  corridor        String?  // e.g. "GHS-KES"
  lpId            String?
  fee             Float    @default(0)
  netAmount       Float    @default(0)
  fxRate          Float    @default(1)
  txHash          String?
  evidence        Json?
  reference       String?
  description     String?
  metadata        Json?
  failureReason   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  settledAt       DateTime?
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  customer        Customer? @relation(fields: [customerId], references: [id])
  refunds         Refund[]
  
  @@index([merchantId, status])
  @@index([customerId])
  @@index([createdAt])
  @@index([corridor])
}

model Payout {
  id              String   @id @default(cuid())
  merchantId      String
  method          String   // BANK, MOBILE_MONEY, ONCHAIN
  sourceAmount    Float
  sourceAsset     String
  sourceCurrency  String
  destinationCurrency String
  destination     Json?    // bankAccount, phoneNumber, walletAddress
  fxRate          Float    @default(1)
  feeBps          Int      @default(50)
  fee             Float    @default(0)
  netAmount       Float    @default(0)
  status          PayoutStatus @default(REQUESTED)
  txHash          String?
  evidence        Json?
  reason          String?
  failureReason   String?
  approvedBy      String?
  approvedAt      DateTime?
  createdAt       DateTime @default(now())
  processedAt     DateTime?
  completedAt     DateTime?
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId, status])
  @@index([createdAt])
}

model Refund {
  id              String   @id @default(cuid())
  merchantId      String
  paymentId       String
  amount          Float
  type            String   // FULL, PARTIAL
  reason          String?
  status          String   @default("PENDING") // PENDING, APPROVED, PROCESSED, REJECTED
  requestedBy     String
  approvedBy      String?
  processedAt     DateTime?
  createdAt       DateTime @default(now())
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  payment         Payment  @relation(fields: [paymentId], references: [id])
  
  @@index([merchantId])
  @@index([paymentId])
}

// === PRODUCTS & INVOICES ===
model Product {
  id              String   @id @default(cuid())
  merchantId      String
  name            String
  description     String?
  price           Float
  currency        String
  type            String   @default("PHYSICAL") // PHYSICAL, DIGITAL, SERVICE
  imageUrl        String?
  metadata        Json?
  status          String   @default("ACTIVE") // ACTIVE, INACTIVE, ARCHIVED
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId, status])
}

model Invoice {
  id              String   @id @default(cuid())
  merchantId      String
  customerId      String?
  number          String   // INV-0001
  items           Json     // [{description, quantity, unitPrice, total}]
  subtotal        Float
  tax             Float    @default(0)
  total           Float
  currency        String
  status          String   @default("DRAFT") // DRAFT, SENT, PAID, OVERDUE, VOID
  dueDate         DateTime?
  sentAt          DateTime?
  paidAt          DateTime?
  paymentId       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  customer        Customer? @relation(fields: [customerId], references: [id])
  
  @@index([merchantId, status])
  @@index([customerId])
}

model Subscription {
  id              String   @id @default(cuid())
  merchantId      String
  customerId      String?
  planName        String
  amount          Float
  currency        String
  interval        String   // DAILY, WEEKLY, MONTHLY, YEARLY
  status          String   @default("ACTIVE") // ACTIVE, PAST_DUE, CANCELED, TRIALING, PAUSED
  currentPeriodStart DateTime?
  currentPeriodEnd   DateTime?
  trialEnd          DateTime?
  canceledAt        DateTime?
  lastPaymentAt     DateTime?
  failedAttempts    Int     @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId, status])
}

model PaymentLink {
  id              String   @id @default(cuid())
  merchantId      String
  amount          Float
  currency        String
  description     String?
  reference       String?
  status          String   @default("ACTIVE")
  url             String   @unique
  expiresAt       DateTime?
  paymentCount    Int      @default(0)
  totalCollected  Float    @default(0)
  createdAt       DateTime @default(now())
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId])
}

// === API & WEBHOOKS ===
model ApiKey {
  id              String   @id @default(cuid())
  merchantId      String
  label           String
  keyPrefix       String   // psk_live_xxx or psk_test_xxx
  keyHash         String   @unique // hashed full key
  scopes          String[] // payments:read, payments:write, etc.
  lastUsedAt      DateTime?
  lastUsedIp      String?
  status          String   @default("ACTIVE") // ACTIVE, REVOKED
  expiresAt       DateTime?
  createdAt       DateTime @default(now())
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId])
}

model WebhookEndpoint {
  id              String   @id @default(cuid())
  merchantId      String
  url             String
  secretHash      String   // hashed webhook secret
  events          String[] // subscribed event types
  status          String   @default("ACTIVE")
  createdAt       DateTime @default(now())
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  deliveries      WebhookDelivery[]
  
  @@index([merchantId])
}

model WebhookDelivery {
  id              String   @id @default(cuid())
  endpointId      String
  eventType       String
  payload         Json
  signature       String
  status          String   @default("PENDING") // PENDING, DELIVERED, FAILED, RETRYING
  attempts        Int      @default(0)
  responseStatus  Int?
  responseBody    String?
  nextRetryAt     DateTime?
  deliveredAt     DateTime?
  createdAt       DateTime @default(now())
  
  endpoint        WebhookEndpoint @relation(fields: [endpointId], references: [id])
  
  @@index([endpointId])
  @@index([status])
}

model TeamMember {
  id              String   @id @default(cuid())
  merchantId      String
  email           String
  role            String   // OWNER, ADMIN, DEVELOPER, ANALYST, VIEWER, SUPPORT
  status          String   @default("PENDING") // PENDING, ACTIVE, SUSPENDED
  invitedAt       DateTime @default(now())
  joinedAt        DateTime?
  userId          String?  // linked user once accepted
  
  merchant        Merchant @relation(fields: [merchantId], references: [id])
  
  @@index([merchantId])
  @@unique([merchantId, email])
}

// === COMPLIANCE ===
model ComplianceReview {
  id              String   @id @default(cuid())
  entityType      String   // MERCHANT, CUSTOMER, LP
  entityId        String
  type            String   // KYC, KYB, SANCTIONS, PEP, AML, RISK
  status          String   @default("PENDING") // PENDING, APPROVED, REJECTED, REVIEW
  data            Json?
  reviewerId      String?
  reviewedAt      DateTime?
  notes           String?
  createdAt       DateTime @default(now())
  
  @@index([entityType, entityId])
  @@index([status])
}

model AMLAlert {
  id              String   @id @default(cuid())
  entityType      String
  entityId        String
  alertType       String   // STRUCTURING, VELOCITY, HIGH_RISK_CORRIDOR, PEP, SANCTIONS_HIT
  severity        String   // LOW, MEDIUM, HIGH, CRITICAL
  score           Float
  details         Json?
  status          String   @default("OPEN") // OPEN, INVESTIGATING, ESCALATED, CLOSED, SAR_FILED
  assignedTo      String?
  createdAt       DateTime @default(now())
  closedAt        DateTime?
  
  @@index([status])
  @@index([entityId])
}

model SAR {
  id              String   @id @default(cuid())
  caseId          String?
  filedBy         String
  narrative       String
  amount          Float
  entities        String[]
  regulatoryRef   String?
  status          String   @default("DRAFT") // DRAFT, FILED, ACKNOWLEDGED
  filedAt         DateTime?
  createdAt       DateTime @default(now())
  
  @@index([status])
}

// === AUDIT ===
model AuditLog {
  id              String   @id @default(cuid())
  userId          String?
  action          String
  resourceType    String
  resourceId      String?
  result          String   // SUCCESS, DENIED, ERROR
  ip              String?
  userAgent       String?
  details         Json?
  createdAt       DateTime @default(now())
  
  user            User?    @relation(fields: [userId], references: [id])
  
  @@index([userId])
  @@index([action])
  @@index([resourceType, resourceId])
  @@index([createdAt])
}

// === ENUMS ===
enum UserStatus {
  PENDING
  ACTIVE
  SUSPENDED
  FROZEN
}

enum Role {
  CUSTOMER
  MERCHANT
  MERCHANT_STAFF
  LP
  TREASURY
  COMPLIANCE
  SUPPORT
  DEVELOPER
  OPERATIONS
  ADMIN
  SUPER_ADMIN
}

enum AccountType {
  CUSTOMER
  MERCHANT
  LP
}

enum AccountStatus {
  PENDING
  ACTIVE
  SUSPENDED
  CLOSED
}

enum MerchantTier {
  UNVERIFIED
  VERIFIED
  TRUSTED
  PREMIUM
}

enum MerchantStatus {
  PENDING
  VERIFIED
  ACTIVE
  SUSPENDED
  CLOSED
}

enum PaymentStatus {
  PENDING
  PROCESSING
  SETTLING
  COMPLETED
  FAILED
  CANCELLED
  REFUNDED
}

enum PayoutStatus {
  REQUESTED
  REVIEWING
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}

enum WaitlistStatus {
  PENDING
  APPROVED
  REJECTED
  CONVERTED
}
```

---

## 6. Authentication Flow

### Signup (Waitlist)
```
Guest → /waitlist → fills form (company, name, email, phone, country, business type)
  → WaitlistEntry created (status: PENDING)
  → Guest sees "You're on the waitlist" confirmation
  → Admin reviews at /admin/waitlist
  → Admin approves → status: APPROVED
  → User receives email with signup link
  → User sets password → User created (status: ACTIVE)
  → User assigned role based on business type
```

### Login
```
User → /login → enters email + password
  → NextAuth credentials provider verifies
  → If MFA enabled → prompts for TOTP code
  → Session created (JWT + database session)
  → Redirected to role-appropriate landing page
```

### Demo Quick-Login
```
/login page has buttons for each demo role:
  [Merchant] [Customer] [LP] [Treasury] [Compliance] [Support] [Developer] [Ops] [Admin]
  → Each button logs in as a seeded demo account with realistic data
  → Admin account: ekontetevi@gmail.com / Payswap123456
```

### Session Management
- NextAuth JWT + database sessions
- 24h session expiry
- Sliding window (refresh on activity)
- MFA support (TOTP)
- Device tracking (IP + user agent)

---

## 7. Design System

### Color Palette
- **Primary**: Emerald (financial, trustworthy) — `emerald-600`
- **Accent**: Teal — `teal-500`
- **Background**: `background` (white in light, `zinc-950` in dark)
- **Surface**: `card` (slightly elevated)
- **Border**: `border` (subtle)
- **Text**: `foreground` (primary), `muted-foreground` (secondary)
- **Status**: emerald (success), amber (warning), rose (error), sky (info)
- **NO indigo or blue**

### Typography
- Sans: Geist Sans (loaded in layout)
- Mono: Geist Mono (code, hashes, IDs)
- Sizes: `text-xs` (labels), `text-sm` (body), `text-lg` (headings), `text-2xl` (page titles), `text-4xl` (hero)

### Spacing
- Page padding: `p-6` (desktop), `p-4` (mobile)
- Card padding: `p-4` or `p-6`
- Section gap: `gap-6`
- Element gap: `gap-2` or `gap-3`

### Components (shadcn/ui — already installed)
- **Layout**: Sidebar (726 LOC, unused!), Card, Separator, ScrollArea
- **Navigation**: NavigationMenu, Breadcrumb, Tabs, Pagination
- **Forms**: Input, Textarea, Select, Checkbox, Switch, Slider, Label
- **Feedback**: Toast (sonner), Alert, Dialog, Progress, Skeleton
- **Data**: Table, Badge, Avatar, Tooltip
- **Actions**: Button, DropdownMenu, ContextMenu

### Loading States
- **Skeleton**: Use `<Skeleton>` for initial page load
- **Spinner**: Inline loading for button actions
- **Progress**: For multi-step operations
- **Suspense**: Route-level loading.tsx files

### Empty States
Every list view has a proper empty state:
- Icon (large, muted)
- Title (what's empty)
- Description (what to do)
- CTA button (primary action)

### Error States
- **API errors**: Toast notification + inline error message
- **404**: Custom not-found.tsx
- **500**: Custom error.tsx
- **Auth errors**: Redirect to /login

### Responsive Breakpoints
- `sm` (640px): Mobile → tablet
- `md` (768px): Tablet → desktop
- `lg` (1024px): Desktop → wide
- `xl` (1280px): Wide → ultrawide
- Sidebar collapses to drawer on mobile
- Tables become cards on mobile
- Forms stack vertically on mobile

---

## 8. Shared Component Inventory

| Component | Purpose | Used By |
|-----------|---------|---------|
| `AppShell` | Layout shell with sidebar + header | All authenticated pages |
| `Sidebar` | Role-based navigation | All authenticated pages |
| `PageHeader` | Page title + actions + breadcrumb | All pages |
| `DataTable` | Sortable, paginated table | All list views |
| `StatCard` | KPI card with label + value + trend | All dashboards |
| `StatusBadge` | Colored status badge | Payments, payouts, etc. |
| `AmountDisplay` | Currency-formatted amount | Everywhere money is shown |
| `EmptyState` | Standard empty state | All list views |
| `LoadingSkeleton` | Standard skeleton | All pages |
| `ErrorBoundary` | Route-level error handler | All routes |
| `ConfirmDialog` | Confirmation dialog | Destructive actions |
| `SearchInput` | Debounced search | All list views |
| `DateRangePicker` | Date filter | Analytics, reports |
| `FileUpload` | File upload (KYC docs, logos) | KYC, settings |
| `Toast` | Notification (sonner) | Everywhere |
| `Modal` | Dialog wrapper | Forms, confirmations |

---

## 9. Key Architecture Decisions

1. **NextAuth credentials provider** — not OAuth (users can't self-signup; waitlist flow)
2. **Database sessions** — not JWT-only (need to revoke sessions, track devices)
3. **Role-based routing** — each role has its own layout group (`/dashboard/*`, `/treasury/*`, etc.)
4. **Server Components by default** — client components only for interactive elements
5. **API routes use server-side auth** — every API route checks session + permissions
6. **Prisma for all data access** — no in-memory Maps for domain state
7. **Soft deletes** — `deletedAt` field on all major models
8. **Audit log** — every state-changing action logged to `AuditLog`
9. **Feature flags** — gate new features, enable per-merchant
10. **Design system** — consistent shadcn/ui usage, no custom CSS except theme tokens
