# PaySwap Evolution — Phase 1: Architecture Design

## 1. Current State Analysis

### What Works
- 77 pages, 97 API routes, 37 Prisma models
- Real PostgreSQL persistence (Neon)
- NextAuth authentication with role-based access
- Organization model with workspace switching
- Sandbox/Live environment scoping
- World simulator creates real DB records
- AI insights on 4 dashboards
- Extension marketplace with review workflow
- Incident management + SRE console
- Digital Twin with kernel simulation

### Critical Architectural Violations

#### Violation 1: No Application Service Layer
Every API route writes directly to Prisma. The world simulator has its own `protocolCreate*` functions that duplicate the API route logic. Business rules exist in 2+ places.

**Current flow:**
```
API Route → db.payment.create()     ← business logic here
Simulator → protocolCreatePayment() ← same business logic duplicated here
Admin Sim → db.payment.create()     ← different logic entirely
```

**Required flow:**
```
API Route → PaymentService.create() → Events → db.payment.create()
Simulator → PaymentService.create() → Events → db.payment.create()
Admin Sim → PaymentService.create() → Events → db.payment.create()
```

#### Violation 2: No Event Emission on State Changes
Creating a payment doesn't emit a domain event. The activity feed, audit log, and webhook delivery are all done inline in each API route (or simulator function), not through a central event system. Some routes do it, some don't.

#### Violation 3: No Resource Lifecycle
Resources don't have a consistent lifecycle. A payment can be created but there's no state machine. Refunds don't always link back. The "timeline" on detail pages is manually assembled from multiple queries.

#### Violation 4: No Protocol Inspector
There's no way to trace a payment through the full pipeline (validation → routing → LP selection → settlement → ledger → webhook). The kernel does this internally but the results aren't exposed per-payment.

---

## 2. Target Architecture

### Layer Structure

```
┌─────────────────────────────────────────────────────┐
│ UI (Next.js Server Components + Client Islands)     │
├─────────────────────────────────────────────────────┤
│ API Routes (thin HTTP adapters)                     │
│   - Validate request                               │
│   - Call Application Service                       │
│   - Format response                                │
├─────────────────────────────────────────────────────┤
│ Application Services (single source of truth)       │
│   - PaymentService                                 │
│   - PayoutService                                  │
│   - RefundService                                  │
│   - InvoiceService                                 │
│   - CustomerService                                │
│   - TreasuryService                                │
│   - ComplianceService                              │
│   - LPService                                      │
│   - ExtensionService                               │
│   - IncidentService                                │
├─────────────────────────────────────────────────────┤
│ Event Bus (in-process pub/sub)                      │
│   - Emits domain events                            │
│   - Projections subscribe                          │
├─────────────────────────────────────────────────────┤
│ Projections (event → side effects)                  │
│   - ActivityFeedProjection                         │
│   - AuditLogProjection                             │
│   - WebhookDeliveryProjection                      │
│   - AnalyticsProjection                            │
│   - NotificationProjection                         │
│   - LedgerProjection                               │
│   - SearchIndexProjection                          │
├─────────────────────────────────────────────────────┤
│ Database (Prisma → PostgreSQL)                     │
└─────────────────────────────────────────────────────┘
```

### Application Service Pattern

Every service follows the same pattern:

```typescript
// src/services/payment-service.ts
export class PaymentService {
  async create(params: CreatePaymentParams): Promise<Payment> {
    // 1. Validate
    // 2. Business rules (compliance check, fraud check, etc.)
    // 3. Write to DB
    // 4. Emit domain event
    // 5. Return result
  }

  async process(paymentId: string): Promise<Payment> {
    // State transition: PENDING → PROCESSING → COMPLETED
  }

  async refund(paymentId: string, amount: number): Promise<Refund> {
    // Create refund + emit event
  }
}
```

### Event Contracts

```typescript
// src/services/events.ts
interface DomainEvent {
  id: string;
  type: string;              // 'payment.created', 'payment.completed', etc.
  aggregateId: string;       // The resource ID
  aggregateType: string;     // 'Payment', 'Payout', 'Refund', etc.
  merchantId: string;
  environment: string;       // 'sandbox' | 'live'
  payload: Record<string, unknown>;
  timestamp: number;
  actorId?: string;          // Who triggered it
  correlationId?: string;    // For tracing
}
```

### Event Types

| Event | Emitted By | Consumed By |
|-------|-----------|-------------|
| `payment.created` | PaymentService | Activity, Audit, Webhook, Analytics, Notifications |
| `payment.completed` | PaymentService | Activity, Audit, Webhook, Analytics, Ledger, Treasury, Customer |
| `payment.failed` | PaymentService | Activity, Audit, Webhook, Notifications |
| `payout.created` | PayoutService | Activity, Audit, Webhook |
| `payout.completed` | PayoutService | Activity, Audit, Webhook, Analytics, Treasury |
| `refund.created` | RefundService | Activity, Audit, Webhook |
| `refund.processed` | RefundService | Activity, Audit, Webhook, Ledger |
| `invoice.created` | InvoiceService | Activity, Audit |
| `invoice.paid` | InvoiceService | Activity, Audit, Webhook |
| `customer.created` | CustomerService | Activity, Audit |
| `case.opened` | ComplianceService | Activity, Audit, Notifications |
| `case.assigned` | ComplianceService | Activity, Audit, Notifications |
| `case.resolved` | ComplianceService | Activity, Audit |
| `aml.alert.opened` | ComplianceService | Activity, Audit, Notifications |
| `reserve.adjusted` | TreasuryService | Activity, Audit, Analytics |
| `corridor.frozen` | TreasuryService | Activity, Audit, Notifications |
| `incident.created` | IncidentService | Activity, Audit, Notifications |
| `incident.resolved` | IncidentService | Activity, Audit |
| `extension.installed` | ExtensionService | Activity, Audit |
| `lp.capital.deposited` | LPService | Activity, Audit, Analytics |
| `lp.capital.withdrawn` | LPService | Activity, Audit |

### Protocol Inspector

Every payment stores a `protocolTrace` JSON field:

```json
{
  "stages": [
    { "name": "request", "status": "completed", "duration_ms": 2, "ts": "..." },
    { "name": "validation", "status": "completed", "duration_ms": 5, "ts": "..." },
    { "name": "fraud_check", "status": "passed", "duration_ms": 12, "ts": "..." },
    { "name": "routing", "status": "completed", "lp": "lp_1", "fee_bps": 80, "duration_ms": 8, "ts": "..." },
    { "name": "lp_selection", "status": "completed", "lp": "lp_1", "duration_ms": 3, "ts": "..." },
    { "name": "reserve_allocation", "status": "completed", "duration_ms": 4, "ts": "..." },
    { "name": "ledger", "status": "completed", "entries": 2, "duration_ms": 6, "ts": "..." },
    { "name": "settlement", "status": "completed", "tx_hash": "...", "duration_ms": 15, "ts": "..." },
    { "name": "webhook", "status": "delivered", "status_code": 200, "duration_ms": 45, "ts": "..." },
    { "name": "completed", "status": "completed", "total_duration_ms": 100, "ts": "..." }
  ]
}
```

---

## 3. Implementation Plan

### Step 1: Event Bus + Domain Events
- `src/services/event-bus.ts` — in-process pub/sub
- `src/services/events.ts` — DomainEvent type + helpers
- `src/services/projections/` — projection subscribers

### Step 2: Application Services
- `src/services/payment-service.ts` — replaces all direct db.payment.create calls
- `src/services/payout-service.ts` — replaces all direct db.payout.create calls
- `src/services/refund-service.ts` — replaces all direct db.refund.create calls
- `src/services/invoice-service.ts` — replaces all direct db.invoice.create calls
- `src/services/customer-service.ts` — replaces all direct db.customerRecord.create calls
- `src/services/treasury-service.ts` — replaces treasury actions
- `src/services/compliance-service.ts` — replaces compliance actions
- `src/services/lp-service.ts` — replaces LP actions
- `src/services/incident-service.ts` — replaces incident actions

### Step 3: Refactor API Routes
Each API route becomes a thin adapter:
```typescript
// Before: 60 lines of business logic + db writes
// After: 10 lines
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const merchantId = await requireMerchantId();
  if (!merchantId) return forbidden();
  const body = await req.json();
  const payment = await paymentService.create({ ...body, merchantId, environment: await getEnvironment() });
  return NextResponse.json({ payment });
}
```

### Step 4: Refactor World Simulator
The simulator calls the same services:
```typescript
// Before: protocolCreatePayment() with duplicated logic
// After:
await paymentService.create({ ...params, environment: 'sandbox' });
```

### Step 5: Protocol Inspector
- Add `protocolTrace` field to Payment model
- PaymentService.create() populates the trace
- Payment detail page shows the trace as a visual pipeline

### Step 6: Resource Timeline
- Add `ResourceTimeline` component
- Queries AuditLog + events for a resource
- Shows chronological timeline of everything that happened

### Step 7: Global Search
- `src/app/api/search/route.ts` — searches across all resource types
- `src/components/global-search.tsx` — search dialog with results grouped by type

---

## 4. Tradeoffs

### Single Source of Truth vs. Speed
**Tradeoff**: Adding a service layer slows down initial development but prevents bugs from duplicated logic.
**Decision**: Accept the overhead. The simulator MUST exercise the same code as production.

### Event Bus Complexity
**Tradeoff**: An in-process event bus adds complexity but ensures every state change updates all subsystems.
**Decision**: Use a simple synchronous event bus (not async/queue-based). Events fire within the same request. This keeps the system simple while ensuring consistency.

### Protocol Trace Storage
**Tradeoff**: Storing a JSON trace per payment increases storage but provides full explainability.
**Decision**: Store it. Storage is cheap; explainability is a competitive advantage.

---

## 5. What This Enables

1. **Simulator integrity**: The world simulator calls the exact same services as production. If it works in simulation, it works in production.

2. **Protocol Inspector**: Every payment shows its full execution trace — Chrome DevTools for financial transactions.

3. **Resource Timeline**: Every resource has a complete chronological history.

4. **Consistent side effects**: Creating a payment ALWAYS updates activity feed, audit log, webhooks, analytics, and notifications — because the projections handle it, not the API route.

5. **Explainability**: Every decision is traceable through events.

6. **Sandbox/Live isolation**: Events are environment-scoped. Sandbox events don't leak into Live.
