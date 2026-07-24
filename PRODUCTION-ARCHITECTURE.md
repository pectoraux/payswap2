# PaySwap End-to-End Production Execution — Architecture Design (Phase 1)

> **Status**: Phase 1 — Architecture only. No implementation code.
> **Kernel**: Frozen (7 primitives: Entity, Capability, Evidence, Proposal, Command, Transition, Event)
> **Goal**: Take a real user payment from intent creation to completed settlement using the production protocol runtime.

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Target Architecture](#2-target-architecture)
3. [Transaction Engine Design](#3-transaction-engine-design)
4. [Payment Service Interface](#4-payment-service-interface)
5. [Routing Service Interface](#5-routing-service-interface)
6. [Settlement Orchestrator Interface](#6-settlement-orchestrator-interface)
7. [Event Contracts](#7-event-contracts)
8. [Command Catalog](#8-command-catalog)
9. [Folder Structure](#9-folder-structure)
10. [Production Database Model](#10-production-database-model)
11. [Failure Scenario Design](#11-failure-scenario-design)
12. [Security Model](#12-security-model)
13. [Design Challenges & Weaknesses](#13-design-challenges--weaknesses)
14. [Proposed Improvements](#14-proposed-improvements)
15. [Success Criteria](#15-success-criteria)

---

## 1. Current State Assessment

### What exists (29 protocol files, 13 production modules)

| Module | File | State |
|--------|------|-------|
| Settlement Escrow | `settlement/escrow.ts` | ✅ Production |
| Collateral Vault | `settlement/collateral-vault.ts` | ✅ Production |
| Settlement Capacity Vault | `settlement/capacity-vault.ts` | ✅ Production |
| LP Lifecycle Manager | `lp-lifecycle-manager.ts` | ✅ Production |
| Dispute Resolution | `settlement/dispute-engine.ts` | ✅ Production |
| Manual Settlement | `settlement/manual-settlement.ts` | ✅ Production |
| Merchant Trust Tiers | `merchant-registry.ts` | ✅ Production |
| Treasury | `treasury.ts` | ✅ Production |
| Payment Lifecycle | `payments/lifecycle.ts` | ✅ Production |
| Liquidity Marketplace | `liquidity/marketplace.ts` | ✅ Production |
| Identity Service | `identity/service.ts` | ✅ Production |
| Governance Engine | `governance/engine.ts` | ✅ Production |
| Connector Architecture | `connectors/index.ts` | ✅ Production |

### What's missing (the gap between "modules exist" and "PaySwap works end-to-end")

1. **No transaction engine** — `payments/lifecycle.ts` defines the lifecycle states but doesn't orchestrate the full flow end-to-end
2. **No routing service** — `liquidity/marketplace.ts` quotes capacity but doesn't integrate with the planner to produce settlement plans
3. **No settlement orchestrator** — no component that coordinates escrow freeze → LP settlement → merchant confirmation → evidence → release
4. **No event-driven execution** — protocol modules mutate state directly instead of going through Command → Transition → Event
5. **No real connectors** — connectors exist as classes but aren't wired to produce evidence during actual transactions
6. **No production database** — everything is in-memory; no event store, no rebuildable projections
7. **No user-facing API** — the Digital Twin UI exists but there's no Consumer/Merchant/LP API
8. **No failure recovery** — the modules handle individual failures but don't coordinate recovery end-to-end

### Key insight

The 13 modules are **building blocks**. They need a **transaction engine** that orchestrates them into a complete payment flow. This is the difference between "we have an escrow module" and "a payment actually settles."

---

## 2. Target Architecture

```
User API (POST /api/payments)
        ↓
TransactionEngine
        ↓
    ┌───┴───┐
    │       │
    v       v
PaymentService    RoutingService
    │               │
    │               ├── LiquidityMarketplace (capacity quotes)
    │               ├── ConfidenceService (evidence → confidence)
    │               └── ConvergencePlanner (kernel planner)
    │
    v
SettlementOrchestrator
    │
    ├── Escrow freeze
    ├── LP proposal + acceptance
    ├── Resource reservation
    ├── Settlement execution
    ├── Merchant confirmation
    ├── Evidence verification
    ├── Escrow release
    └── Event emission
        ↓
    Event Store (database)
        ↓
    Projections (rebuildable)
```

### Three-layer separation

```
Layer 1: API Layer (src/app/api/payments/)
  - HTTP endpoints
  - Request validation
  - Response formatting
  - No business logic

Layer 2: Protocol Layer (src/protocol/payments/)
  - TransactionEngine (orchestrates full flow)
  - PaymentService (manages payment entity lifecycle)
  - RoutingService (selects LP + settlement path)
  - SettlementOrchestrator (coordinates escrow → settle → confirm → release)
  - No kernel access (uses kernel primitives via protocol modules)

Layer 3: Kernel Layer (src/kernel/) — FROZEN
  - Planner, Executor, Event Store, Projection Engine
  - 7 primitives
  - No PaySwap knowledge
```

---

## 3. Transaction Engine Design

The TransactionEngine is the **only entry point** for creating and executing payments. It orchestrates the full flow.

### Interface

```typescript
interface TransactionEngine {
  // Create a payment intent (user-facing)
  createIntent(request: PaymentRequest): Promise<PaymentIntent>;

  // Execute the payment end-to-end
  execute(paymentId: string): Promise<PaymentResult>;

  // Get current state (for tracking)
  getStatus(paymentId: string): PaymentStatus;

  // Cancel a pending payment
  cancel(paymentId: string, reason: string): Promise<PaymentResult>;
}

interface PaymentRequest {
  sourceAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  senderId: string;
  receiverId: string; // merchant ID
  priority: 'cheapest' | 'fastest' | 'safest' | 'balanced';
  constraints?: {
    maxCostPercent?: number;
    maxSettlementMs?: number;
    minConfidence?: number;
  };
}

interface PaymentResult {
  paymentId: string;
  state: PaymentState;
  settled: boolean;
  settlementTimeMs: number;
  cost: number;
  lpId: string | null;
  escrowId: string | null;
  events: string[]; // event IDs emitted during execution
  error?: string;
}
```

### Lifecycle orchestration

```
createIntent()
  → PaymentService.createPayment() → Payment Entity created
  → State: intent_created

execute()
  → RoutingService.findRoute() → SettlementPlan selected
  → State: planning → proposal_sent
  → LP receives proposal (via Proposal primitive)
  → State: proposal_accepted (if LP accepts)
  → SettlementOrchestrator.reserve() → exposure + capacity reserved
  → State: resources_reserved
  → SettlementOrchestrator.freezeEscrow() → Twin Tokens frozen
  → State: escrow_frozen
  → SettlementOrchestrator.settle() → LP fulfills external transfer
  → State: settling → merchant_confirming
  → Merchant confirms receipt
  → State: evidence_collecting
  → Evidence verified (via ConfidenceService)
  → SettlementOrchestrator.release() → escrow released
  → State: settled
  → Events emitted throughout
  → Projections updated
```

### Failure handling within execute()

```
If LP rejects proposal:
  → Re-route (try next LP from RoutingService)
  → If no LP available: state = failed

If LP disappears after acceptance:
  → Escrow remains frozen
  → Dispute engine opens auto-dispute (timeout)
  → Replacement LP selected
  → Escrow transferred to replacement LP
  → Settlement continues

If merchant doesn't confirm:
  → Escrow remains frozen
  → After timeout: auto-dispute
  → Evidence reviewed
  → Escrow released or slashed based on evidence

If evidence is insufficient:
  → Confidence drops below threshold
  → Planner re-routes
  → Or: dispute opened
```

---

## 4. Payment Service Interface

Manages the payment entity lifecycle. Does NOT execute — only manages state.

```typescript
interface PaymentService {
  createPayment(request: PaymentRequest): PaymentIntent;
  updateState(paymentId: string, state: PaymentState, detail: string): PaymentIntent;
  getStatus(paymentId: string): PaymentStatus;
  getPayment(paymentId: string): PaymentIntent | null;
  listPayments(filter?: PaymentFilter): PaymentIntent[];
}
```

### Payment Entity

```typescript
interface PaymentEntity {
  id: string;
  type: 'payment';
  state: PaymentState;
  capabilities: { canSettle: true; canReceive: true; canVerify: true };
  attributes: {
    sourceAmount: number;
    sourceCurrency: string;
    destinationAmount: number;
    destinationCurrency: string;
    senderId: string;
    receiverId: string;
    priority: string;
    constraints: Record<string, number>;
  };
}
```

---

## 5. Routing Service Interface

Selects the optimal settlement path using the kernel planner + liquidity marketplace.

```typescript
interface RoutingService {
  findRoute(request: PaymentRequest, entities: Entity[], evidence: Evidence[]): Promise<SettlementPlan>;
  findAlternative(paymentId: string, excludeLpIds: string[]): Promise<SettlementPlan | null>;
}

interface SettlementPlan {
  lpId: string;
  lpProfile: LPProfile;
  transitions: Transition[];
  confidence: number;
  expectedCompletionMs: number;
  cost: number;
  costPercent: number;
  riskScore: number;
  evidenceRequired: EvidenceRequirement[];
  alternativeLps: { lpId: string; score: number }[];
}
```

### Routing flow

```
1. Query LiquidityMarketplace for active LPs in destination currency
2. For each LP, query ConfidenceService for confidence score
3. Build ConvergenceIntent with entities + evidence + objectives
4. Call ConvergencePlanner.converge()
5. Return winning plan + alternatives
```

---

## 6. Settlement Orchestrator Interface

Coordinates the physical settlement steps. This is where the protocol modules are invoked.

```typescript
interface SettlementOrchestrator {
  reserve(payment: PaymentIntent, lpId: string): ReservationResult;
  freezeEscrow(payment: PaymentIntent): EscrowResult;
  settle(payment: PaymentIntent, proofHash: string): SettlementResult;
  confirmReceipt(payment: PaymentIntent): ConfirmationResult;
  verifyEvidence(payment: PaymentIntent): VerificationResult;
  release(payment: PaymentIntent): ReleaseResult;
  cancel(payment: PaymentIntent, reason: string): CancelResult;
  transferToReplacement(payment: PaymentIntent, newLpId: string): TransferResult;
}
```

Each method:
1. Produces a Command
2. The Command triggers a Transition
3. The Transition emits Events
4. Events are stored in the Event Store
5. Projections are updated

---

## 7. Event Contracts

Every protocol action produces a typed event. These are the **event contracts** that all consumers (projections, UI, analytics) depend on.

### Payment events

```typescript
// Payment lifecycle
'payment.intent_created'     → { paymentId, sourceAmount, sourceCurrency, destinationAmount, destinationCurrency, senderId, receiverId, priority }
'payment.planning_started'   → { paymentId }
'payment.plan_selected'      → { paymentId, planId, lpId, confidence, cost, expectedMs }
'payment.proposal_sent'      → { paymentId, lpId, proposalId }
'payment.proposal_accepted'  → { paymentId, lpId }
'payment.proposal_rejected'  → { paymentId, lpId, reason }
'payment.resources_reserved' → { paymentId, lpId, exposureReserved, capacityReserved }
'payment.escrow_frozen'      → { paymentId, escrowId, amount, currency }
'payment.settling'           → { paymentId, lpId, proofHash }
'payment.merchant_confirming' → { paymentId }
'payment.evidence_collected'  → { paymentId, evidenceIds: string[] }
'payment.settled'            → { paymentId, escrowId, settlementTimeMs, cost }
'payment.failed'             → { paymentId, reason }
'payment.disputed'           → { paymentId, disputeId, reason }
'payment.replacement_started' → { paymentId, oldLpId, newLpId }
```

### Settlement events (already defined in modules)

```typescript
'escrow.frozen'     → { escrowId, transactionId, lpId, merchantId, amount, twinTokenAmount }
'escrow.released'   → { escrowId, lpId, proofHash }
'escrow.disputed'   → { escrowId, disputeId }
'escrow.refunded'   → { escrowId, lpId }
'escrow.slashed'    → { escrowId, merchantId }
'escrow.transferred' → { escrowId, oldLpId, newLpId }
'escrow.expired'    → { escrowId, transactionId }
'collateral.locked' → { collateralId, lpId, amount, currency }
'collateral.slashed' → { collateralId, lpId, slashAmount, reason }
'collateral.released' → { collateralId, lpId, remaining }
'capacity.staked'   → { stakeId, lpId, amount, currency }
'capacity.unstaked' → { stakeId, lpId, amount }
'dispute.opened'    → { disputeId, escrowId, lpId, merchantId }
'dispute.resolved'  → { disputeId, outcome, fraudType }
'manual_settlement.started' → { settlementId, transactionId, lpId }
'manual_settlement.confirmed' → { settlementId, escrowId }
'manual_settlement.timed_out' → { settlementId, disputeId }
```

### Connector events

```typescript
'connector.query'    → { connectorId, type, params, success, latencyMs }
'connector.health'   → { connectorId, healthy, latencyMs }
'connector.evidence' → { connectorId, evidenceId, entityId, confidence }
```

---

## 8. Command Catalog

Every state change goes through a Command. Commands are the **only** way to trigger transitions.

```typescript
// Payment commands
'CreatePaymentIntent'     → creates payment entity, emits payment.intent_created
'ExecutePayment'          → triggers routing + settlement orchestration
'CancelPayment'           → cancels payment, releases reserved resources

// Settlement commands
'FreezeEscrow'            → freezes Twin Tokens in escrow
'ReleaseEscrow'           → releases escrow to LP (settlement confirmed)
'DisputeEscrow'           → marks escrow as disputed
'RefundEscrow'            → refunds escrow to LP (LP wins dispute)
'SlashEscrow'             → slashes escrow to merchant (merchant wins)
'TransferEscrow'          → transfers escrow to replacement LP
'ExpireEscrow'            → expires escrow (timeout)

// LP commands
'ReserveExposure'         → reserves LP exposure for a transaction
'ReleaseExposure'         → releases LP exposure
'SlashCollateral'         → slashes LP collateral
'LockCollateral'          → locks LP collateral
'ReleaseCollateral'       → releases LP collateral

// Capacity commands
'StakeCapacity'           → LP stakes Twin Tokens
'UnstakeCapacity'         → LP withdraws stake
'ReserveCapacity'         → reserves settlement capacity
'ConsumeCapacity'         → consumes reserved capacity (settlement complete)
'ReleaseCapacity'         → releases reserved capacity (cancellation)

// Merchant commands
'ConfirmReceipt'          → merchant confirms receiving payment
'RegisterMerchant'        → registers a new merchant
'UpgradeMerchantTier'     → upgrades merchant tier

// Dispute commands
'OpenDispute'             → opens a dispute on an escrow
'SubmitEvidence'          → submits evidence for a dispute
'CastVote'                → casts a community vote
'AdjudicateDispute'       → PaySwap adjudicates

// Manual settlement commands
'StartManualSettlement'   → starts manual settlement workflow
'NotifyLP'                → notifies LP of manual settlement requirement
'SubmitProof'             → LP submits proof of external settlement
```

---

## 9. Folder Structure

```
src/
├── kernel/                          # FROZEN — no changes
│   └── (50 files, 7 primitives)
│
├── protocol/                        # PaySwap protocol (domain layer)
│   ├── payments/
│   │   ├── lifecycle.ts             # EXISTING — payment lifecycle states
│   │   ├── transaction-engine.ts    # NEW — end-to-end orchestration
│   │   ├── payment-service.ts       # NEW — payment entity management
│   │   ├── routing-service.ts       # NEW — LP selection + plan generation
│   │   └── settlement-orchestrator.ts # NEW — coordinates escrow → settle → release
│   │
│   ├── liquidity/
│   │   └── marketplace.ts           # EXISTING — LP capacity marketplace
│   │
│   ├── settlement/                  # EXISTING
│   │   ├── escrow.ts
│   │   ├── collateral-vault.ts
│   │   ├── capacity-vault.ts
│   │   ├── dispute-engine.ts
│   │   ├── manual-settlement.ts
│   │   ├── auctions.ts
│   │   └── net-settlement.ts
│   │
│   ├── connectors/                  # EXISTING (will add real implementations)
│   │   ├── index.ts                 # Base connector + registry
│   │   ├── bank/
│   │   │   └── openbanking.ts       # NEW — Open Banking adapter
│   │   ├── mobile-money/
│   │   │   └── mpesa.ts             # NEW — M-Pesa adapter
│   │   ├── blockchain/
│   │   │   └── ethereum.ts          # NEW — Ethereum adapter
│   │   ├── psp/
│   │   │   └── psp-adapter.ts       # NEW — PSP adapter
│   │   └── exchange/
│   │       └── exchange-rate.ts     # NEW — FX rate adapter
│   │
│   ├── governance/
│   │   └── engine.ts                # EXISTING
│   │
│   ├── identity/
│   │   └── service.ts               # EXISTING
│   │
│   ├── economics/                   # EXISTING
│   ├── contracts/                   # EXISTING
│   ├── lp-lifecycle-manager.ts      # EXISTING
│   ├── merchant-registry.ts         # EXISTING
│   ├── treasury.ts                  # EXISTING
│   └── obligation.ts                # EXISTING
│
├── app/                             # Next.js app (API + UI)
│   ├── api/
│   │   ├── payments/                # NEW — payment endpoints
│   │   │   ├── route.ts             # POST /api/payments (create)
│   │   │   └── [id]/route.ts        # GET /api/payments/:id (status)
│   │   ├── lp/                      # NEW — LP endpoints
│   │   │   ├── register/route.ts    # POST /api/lp/register
│   │   │   └── proposals/route.ts   # GET /api/lp/proposals
│   │   ├── merchant/                # NEW — merchant endpoints
│   │   │   └── confirm/route.ts     # POST /api/merchant/confirm
│   │   ├── protocol/                # EXISTING
│   │   │   └── health/route.ts      # NEW — production health metrics
│   │   ├── simulate/                # EXISTING (Digital Twin)
│   │   ├── supply-chain/            # EXISTING (second domain)
│   │   ├── infrastructure/          # EXISTING (third domain)
│   │   ├── fuzz/                    # EXISTING
│   │   ├── validation/              # EXISTING
│   │   └── metrics/                 # EXISTING
│   │
│   └── page.tsx                     # Digital Twin UI (existing)
│
├── components/                      # UI components
│   ├── simulator/                   # EXISTING — Digital Twin panels
│   └── protocol/                    # NEW — production UI panels
│       ├── payment-tracker.tsx      # Real-time payment tracking
│       ├── lp-dashboard.tsx         # LP capacity management
│       └── ops-console.tsx          # Operations console
│
└── domains/                         # Non-PaySwap domains
    ├── supply-chain/                # EXISTING
    └── infrastructure/              # EXISTING
```

---

## 10. Production Database Model

### Principle: Events are authoritative. Projections are rebuildable.

```
database/
├── events/              # Event Store (append-only)
│   ├── payment_events
│   ├── escrow_events
│   ├── lp_events
│   ├── dispute_events
│   ├── treasury_events
│   └── connector_events
│
├── projections/         # Read models (rebuildable from events)
│   ├── payment_projection     # current payment states
│   ├── lp_projection          # current LP states + exposure
│   ├── merchant_projection    # current merchant states
│   ├── escrow_projection      # current escrow states
│   ├── treasury_projection    # current treasury positions
│   └── risk_projection        # current risk metrics
│
└── snapshots/           # Performance optimization (cached projections)
```

### Prisma schema additions

```prisma
model PaymentRecord {
  id            String   @id @default(cuid())
  paymentId     String   @unique
  state         String
  sourceAmount  Float
  sourceCurrency String
  destinationAmount Float
  destinationCurrency String
  senderId      String
  receiverId    String
  priority      String
  lpId          String?
  escrowId      String?
  confidence    Float
  cost          Float
  settlementMs  Int?
  createdAt     DateTime @default(now())
  settledAt     DateTime?
  events        String   // JSON array of event IDs
}
```

### Projection rebuild test

```
1. Delete all projection tables
2. Replay all events from event store
3. Verify projections match previous state
```

---

## 11. Failure Scenario Design

### Scenario 1: LP disappears after accepting proposal

```
1. Payment created, LP accepts, resources reserved, escrow frozen
2. LP goes offline (connector health check fails)
3. Escrow remains frozen (Twin Tokens are safe)
4. TransactionEngine detects LP unavailability
5. RoutingService.findAlternative() selects replacement LP
6. Escrow transferred to replacement LP
7. Settlement continues with replacement LP
8. Original LP: exposure released, reputation decreased
```

### Scenario 2: Evidence expires (bank proof stale)

```
1. Payment in planning phase
2. Bank connector provided evidence (60s TTL)
3. 65 seconds pass — evidence expired
4. ConfidenceService recomputes confidence → drops to 0
5. Planner re-routes (finds LP with fresh evidence)
6. If no LP with fresh evidence: payment fails with "insufficient confidence"
```

### Scenario 3: Merchant disputes falsely

```
1. Payment settled, LP provided proof, escrow released
2. Merchant opens dispute (claims non-receipt)
3. DisputeEngine opens dispute on released escrow
   (Note: escrow is already released — this is a challenge)
4. Evidence collected: LP's bank transfer proof vs merchant's claim
5. If LP proof is verified (cryptographic): dispute resolved, LP wins
6. Merchant reputation decreased for false dispute
7. If merchant has pattern of false disputes: bond slashed
```

**Weakness identified**: The current escrow state machine doesn't support disputes after release. This needs either:
- A: Escrow can be re-opened after release (within a challenge window)
- B: Disputes after release go through a separate "post-settlement dispute" flow

**Recommendation**: Option B — post-settlement disputes use the Governance engine, not the Escrow. The escrow is final once released.

### Scenario 4: Connector unavailable (network outage)

```
1. Payment in planning phase
2. Bank connector health check fails
3. ConnectorRegistry marks connector as unhealthy
4. ConfidenceService uses connector health to adjust confidence
5. Unhealthy connector → lower confidence → planner deprioritizes LPs relying on that connector
6. If alternative connectors available: re-route
7. If no alternatives: payment queued (retry when connector recovers)
8. No incorrect state (payment stays in 'planning' state)
```

---

## 12. Security Model

### Threat model

| Threat | Mitigation |
|--------|-----------|
| Balance creation | Constitution invariant: ledger must balance. No entity can credit without corresponding debit. |
| Event rewriting | Event store is append-only. Events have cryptographic hashes. Any tampering breaks the hash chain. |
| Evidence forgery | Evidence carries verificationLevel. Manual evidence = 0.3 confidence. Cryptographic = 1.0. Planner weights by verification level. |
| LP exceeding capacity | Exposure is reserved before settlement. `lpLifecycle.reserveExposure()` checks against `authorizedExposure`. Constitution invariant: exposure cannot exceed capacity. |
| Dispute bypassing escrow | Escrow state machine is enforced. Disputes can only be opened on frozen escrows. Released escrows are final. |
| Planner choosing unsupported paths | Planner only considers entities with matching capabilities. Constitution invariant: every transition must satisfy preconditions. |
| Double settlement | Escrow state machine prevents double release. Constitution invariant: no duplicate settlement. |
| Replay attack | Commands carry unique IDs. Event store rejects duplicate command IDs. |

### Attack simulations

1. **Fraudulent LP** — LP claims capacity but has no fiat. Evidence confidence drops. Planner reroutes. If LP already accepted: escrow frozen, dispute on timeout, collateral slashed.

2. **Fake evidence** — LP submits forged bank receipt. Evidence verificationLevel = manual. Confidence = 0.3. Planner rejects. If dispute: evidence hash mismatch detected.

3. **Offline bank** — Bank connector health = 0. Confidence for LPs using that bank = 0. Planner deprioritizes. Payment reroutes to LPs with healthy connectors.

4. **Colluding merchants** — Multiple merchants file false disputes against same LP. Pattern detected by projection (dispute rate > threshold). Governance proposal to slash merchant bonds.

5. **Liquidity collapse** — All LPs go offline. Planner returns no feasible plan. Payment fails with "no liquidity available." Treasury alert triggered.

6. **Replay attack** — Attacker replays a "ReleaseEscrow" command. Event store rejects (command ID already processed). No state change.

7. **Double settlement** — Attacker tries to settle same payment twice. Escrow state machine rejects (escrow already released). Constitution invariant blocks.

---

## 13. Design Challenges & Weaknesses

### Challenge 1: Synchronous vs asynchronous execution

**Problem**: The TransactionEngine.execute() flow is currently synchronous. In production, LP settlement is asynchronous (LP needs time to transfer fiat externally).

**Solution**: execute() should return immediately with state='escrow_frozen'. The settlement confirmation happens asynchronously (webhook or polling). The TransactionEngine exposes `confirmSettlement(paymentId, proofHash)` and `confirmReceipt(paymentId)` as separate methods.

**Impact**: The API needs to support both synchronous (for instant settlement via reserves) and asynchronous (for LP-mediated settlement) flows.

### Challenge 2: Post-settlement disputes

**Problem**: Escrow is released when merchant confirms. But what if merchant confirms prematurely (before actually receiving fiat)?

**Solution**: Add a challenge window. Escrow release is "pending" for N minutes. During this window, merchant can open a dispute. After the window, release is final.

**Impact**: Escrow state machine needs a `releasing` → `released` transition with a delay. Or: handle via separate post-settlement dispute flow.

### Challenge 3: Connector reliability under load

**Problem**: In production, bank APIs have rate limits, timeouts, and failures. The connector architecture needs circuit breakers, retries, and fallbacks.

**Solution**: Each connector has a circuit breaker. After N failures, the connector is marked unhealthy. ConfidenceService adjusts. Planner reroutes. Circuit breaker resets after cooldown.

**Impact**: Connector class needs `circuitBreaker` state. Health checks run periodically, not just on query.

### Challenge 4: Concurrent payment contention

**Problem**: Two payments try to reserve the same LP's exposure simultaneously. Both check `availableExposure >= amount`, both succeed, but combined they exceed capacity.

**Solution**: `lpLifecycle.reserveExposure()` must be atomic. In production (database-backed), this requires a transaction or optimistic concurrency check.

**Impact**: The in-memory implementation is fine for single-threaded simulation. Production needs database-level locking or event-sourced reservation (commands are serialized).

### Challenge 5: Event store scalability

**Problem**: Storing every event for every payment could generate millions of rows.

**Solution**: Partition events by payment ID. Snapshot projections periodically. Archive old events to cold storage.

**Impact**: Prisma schema needs payment_id index on all event tables. Projection snapshots need a `snapshot_version` field.

---

## 14. Proposed Improvements

### Improvement 1: Async settlement with webhooks

```
POST /api/payments → creates intent, returns paymentId + state=intent_created
POST /api/payments/:id/execute → starts execution, returns state=escrow_frozen
POST /api/payments/:id/confirm → LP confirms settlement (with proof)
POST /api/payments/:id/receipt → merchant confirms receipt
GET /api/payments/:id → poll status (or WebSocket for real-time)
```

### Improvement 2: Circuit breakers for connectors

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  canExecute(): boolean { ... }
  recordFailure(): void { ... }
  recordSuccess(): void { ... }
}
```

### Improvement 3: Challenge window for escrow release

```
Escrow states: frozen → releasing (challenge window) → released
During 'releasing': disputes can be opened
After challenge window (default 10 min): auto-transition to 'released'
```

### Improvement 4: Payment queue for insufficient liquidity

```
If no LP available:
  Payment state = 'queued'
  Payment added to liquidity queue
  When new LP capacity becomes available:
    Queue processor retries payment
    If successful: state = 'planning' → normal flow
    If timeout (24h): state = 'failed'
```

### Improvement 5: WebSocket for real-time updates

```
GET /api/payments/:id/events (WebSocket)
  → Streams events as they happen
  → Client sees: planning → proposal_sent → escrow_frozen → settling → settled
```

---

## 15. Success Criteria

The phase is complete when:

✅ A user can create a payment intent via API
✅ Planner selects a real settlement route (using LiquidityMarketplace + ConfidenceService)
✅ LP receives and accepts proposal
✅ Capacity and exposure are reserved
✅ Escrow freezes Twin Tokens
✅ LP settlement completes (with proof)
✅ Merchant confirms receipt
✅ Evidence is verified (confidence above threshold)
✅ Escrow releases to LP
✅ All events are emitted and stored
✅ Events replay identically (delete projections, replay, verify)
✅ No kernel changes required

### Additional success criteria

✅ LP disappearance → replacement LP selected → settlement continues
✅ Evidence expiry → confidence drops → planner reroutes
✅ Fraudulent dispute → evidence verified → escrow protected
✅ Connector outage → no incorrect state → retry/replan
✅ Production metrics endpoint (/api/protocol/health) shows real-time protocol health

---

## Conclusion

The 13 existing protocol modules are the building blocks. The TransactionEngine is the orchestrator that turns them into a working payment system. The key new components are:

1. **TransactionEngine** — end-to-end orchestration
2. **RoutingService** — LP selection + plan generation (integrates marketplace + planner)
3. **SettlementOrchestrator** — coordinates escrow → settle → confirm → release
4. **Event-driven execution** — every state change goes through Command → Transition → Event
5. **Real connectors** — bank, blockchain, mobile money, PSP, exchange
6. **Production database** — event store + rebuildable projections
7. **User APIs** — Consumer, Merchant, LP, Operations

The design is internally consistent. The main risks are:
- Async settlement flow (solved by separating execute/confirm/receipt)
- Post-settlement disputes (solved by challenge window)
- Concurrent contention (solved by atomic reservations in production DB)
- Connector reliability (solved by circuit breakers)

**Next**: Phase 2 — implement incrementally, verifying each subsystem.
