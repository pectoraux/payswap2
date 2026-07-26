# PaySwap Protocol Runtime — Architecture (Phase 1, v2: Revised)

> **Status:** Architecture design. No implementation in this phase.
> **Supersedes:** the earlier draft (v1) of this document. v1 mirrored Stripe's
> internal command-handler-aggregate shape; v2 reframes around PaySwap's actual
> objective.
> **Governing rule:** No business logic in pages or API routes. The Runtime is
> the product; every client — including the simulator — uses it. Every financial
> operation follows one identical execution pipeline. Every workflow must be
> **inspectable, replayable, explainable, and simulatable.**
> **Kernel constraint:** The frozen kernel (`src/kernel/*`) is never modified.
> Everything below is built **above** the kernel primitives.

---

## Changes from v1 (the 15 corrections)

| # | v1 | v2 |
|---|---|---|
| Objective | "Build a better Stripe" | **"Build the execution runtime of a programmable financial network"** |
| Orchestration | Replace services with Command handlers everywhere | **Keep Application Services** as the orchestration layer |
| Event Store | The database; reads replay | **Audit / replay / sim / debug / inspect source only** — pages never replay |
| Events | One bucket | **Domain Events vs Runtime Events** (business state vs operational) |
| Settlement | A step inside payment | **Dedicated Settlement Engine — the product**; everything flows through it |
| Treasury | Reserves + dashboard | **Capital Allocator** (idle capital, corridor/LP demand, FX, float, yield, risk) |
| LP | Selection algorithm | **Liquidity Market** — LPs publish strategies; market clears; winner executes |
| Reserves | Part of Treasury | **Separate Reserve Engine** (lock/release/collateral/mint-burn/backing/proofs) |
| Explainability | Scattered | **Decision Engine** — every important decision is a recorded, explainable artifact |
| Graphs | One Resource Graph | **Two graphs**: Resource (business) + Economic (money) |
| Policy | Implicit | **Policy Engine** — can-settle/can-mint/can-refund/can-release/can-retry |
| Time | Everything immediate | **Scheduling Engine** — delayed settlement, retries, reconciliation, rebalances |
| API edge | Each route owns cross-cutting | **API Gateway** — auth/rate-limit/idempotency/versioning in one place |
| Simulator | Calls services directly | **Runtime client** via SDK → REST/gRPC — indistinguishable from a merchant |
| Spine | Layer list | **The execution pipeline is first-class** — one 14-stage path for every operation |

---

## 0. The Objective and the One Rule

> **Objective:** Build the execution runtime of a programmable financial
> network.

This is not a slogan. It changes implementation decisions:

- The **Runtime is the product**. Merchant Dashboard, Admin, Simulator,
  Developer SDK, CLI, Mobile, Extensions, and the public API are all
  **clients** of one runtime. They differ by surface, not by execution path.
- **Settlement is the product**, not a side effect of payment. PaySwap's
  differentiator is *programmable settlement*, so settlement gets a dedicated
  engine that every money movement flows through.
- **Programmable liquidity is real.** LPs are a market with strategies and
  clearing, not a lookup table.
- **Stripe is the benchmark for experience, not the limit for capability.**
  We keep Stripe's discipline (uniform pipeline, immediate projections,
  explainable traces) and add what Stripe doesn't have: a treasury allocator,
  a liquidity market, a reserve engine, a digital twin, transparent routing.

**The One Rule (unchanged, sharpened):**

> No business logic in pages or API routes. Every financial operation flows
> through one execution pipeline. Application Services orchestrate; Domain
> Services and Engines decide; the Protocol Runtime executes and records. Every
> workflow is inspectable, replayable, explainable, and simulatable.

---

## 1. The Execution Pipeline — the Spine

Every financial operation — **payment, payout, refund, subscription charge,
invoice settlement, wallet transfer, treasury operation** — follows the
identical 14-stage pipeline. This consistency is what makes the system
cohesive and what makes the simulator indistinguishable from production.

```
┌─────────────────────────────────────────────────────────────────┐
│  1.  INTENT              — what the client wants (a typed request)│
│  2.  VALIDATION          — schema + business invariants           │
│  3.  POLICY EVALUATION   — can this actor do this, here, now?     │
│  4.  RISK & FRAUD        — scoring, screening, holds              │
│  5.  TREASURY & RESERVE  — allocate capital, lock reserves        │
│      ALLOCATION                                                   │
│  6.  LIQUIDITY MARKET    — LP strategies → score → clear → winner │
│      (LP SELECTION)                                               │
│  7.  SETTLEMENT PLANNING — connector + rail + FX + hops + timing  │
│  8.  EXECUTION           — drive connectors / chain / banks       │
│  9.  LEDGER POSTING      — double-entry, immutable                │
│  10. EVENT EMISSION      — Domain Events appended to the store    │
│  11. PROJECTION UPDATES  — read models updated immediately        │
│  12. NOTIFICATIONS &     — webhooks queued, emails/SMS sent       │
│      WEBHOOKS                                                     │
│  13. ANALYTICS           — metrics, LTV, corridor stats           │
│  14. PROTOCOL INSPECTION — trace node written for every stage     │
└─────────────────────────────────────────────────────────────────┘
```

**Properties of the pipeline:**
- **Uniform.** The same 14 stages run for a $5 M-Pesa payment and a $500k
  treasury rebalance. Stage 7 (Settlement Planning) is where the
  differentiation lives; the surrounding stages are identical.
- **Stage-local decisions.** Each stage owns one decision, recorded as a
  **Decision** artifact (Layer: Decision Engine). The trace shows every
  decision's score, confidence, alternatives, and tradeoffs.
- **Resumable.** Because every stage emits Domain Events and a trace node,
  a paused operation resumes from the last committed stage. The Scheduling
  Engine (Layer: Scheduling) can defer a stage ("settle in 4 hours").
- **Replayable.** Replaying an operation's Domain Events reproduces the exact
  stage sequence and decisions. The simulator re-runs the same pipeline with
  injected failures.
- **Inspectable.** Stage 14 writes one trace node per stage per operation;
  the Protocol Inspector renders the full tree.

**Where the pipeline lives:** `src/runtime/pipeline/`. It is the single
orchestrator. Application Services construct an Intent and hand it to the
pipeline; they do not implement stages themselves.

---

## 2. Current-State Assessment (carry forward)

### Keep
- **Application Services** (`src/services/*`) — they stay as the orchestration
  seam. `PaymentService.create()` remains the public entry; internally it
  builds an Intent and drives the pipeline rather than writing Prisma.
- **Projection pattern** (`src/services/projections/*`) — the side-effect
  pattern is correct; it is promoted into the Runtime with a Domain/Runtime
  event split and immediate projection.
- **Thin API routes** — they thin further to "validate → call App Service →
  return" behind a shared API Gateway.
- **Frozen kernel primitives** — `Command`, `Transition`, `Entity`,
  `Capability`, `Evidence`, `Proposal`, plus the pure-function engines
  (`OptimizationEngine`, `treasury-ai`, `lp-lifecycle`, `STATE_MACHINES`,
  `Constitution`, `financial-graph`). The Runtime calls these as pure
  functions; it never edits them.
- **Protocol domain modules** — `protocol/{ledger,settlement,liquidity-network,
  treasury-v2,connectors-v2,resilience,security,ops,economics}`. Formalized
  behind engine/driver contracts.

### Build (the v2 layers)
- The **execution pipeline** as a first-class orchestrator.
- Dedicated engines: **Settlement, Treasury Allocator, Reserve, Liquidity
  Market, Decision, Policy, Scheduling, Risk/Fraud**.
- **Two graphs** (Resource + Economic).
- **Event Store** as audit/replay/sim/debug/inspect source (not the read path).
- **Immediate projections** → read models (pages never replay).
- **Domain vs Runtime event** separation.
- **API Gateway** consolidating cross-cutting edge concerns.
- **Simulator as Runtime client** via SDK → REST.

---

## 3. The Product Reframe — Runtime is the Product

```
┌──────────────────────────────────────────────────────────────────┐
│  CLIENTS (all are peers; all use the same surfaces)              │
│  Merchant Dashboard · Admin · Simulator · Developer SDK · CLI ·  │
│  Mobile Apps · Extensions · Public API                           │
└───────────────────────────┬──────────────────────────────────────┘
                            │  SDK / REST / gRPC
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  API GATEWAY                                                      │
│  Authentication · Rate limiting · Idempotency · Versioning ·      │
│  Request logging · Quotas                                         │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  APPLICATION SERVICES  (orchestration — the public API of runtime)│
│  PaymentService · PayoutService · RefundService ·                 │
│  InvoiceService · SubscriptionService · WalletService ·           │
│  TreasuryService                                                  │
│  Each: build Intent → drive Pipeline → return Read Model handle   │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  PROTOCOL RUNTIME — the execution pipeline (§1)                   │
│  14 stages, each delegating to Domain Services / Engines          │
└───────────────────────────┬──────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ DOMAIN SERVICES  │ │   ENGINES    │ │   RESOURCE &     │
│ Validation       │ │ Settlement   │ │   ECONOMIC GRAPH │
│ Policy           │ │ Treasury     │ │   (two graphs)   │
│ Risk & Fraud     │ │ Allocator    │ └──────────────────┘
│ Ledger           │ │ Reserve      │
│ Connector Drivers│ │ Liquidity    │
│                  │ │ Market       │
│                  │ │ Decision     │
│                  │ │ Scheduling   │
└────────┬─────────┘ └──────┬───────┘
         │                  │
         ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  EVENT STORE  (append-only; audit / replay / sim / debug / inspect)│
│  Domain Events (business state) · Runtime Events (operational)    │
└───────────────────────────┬──────────────────────────────────────┘
                            │  project immediately (same transaction)
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  PROJECTIONS → READ MODELS                                        │
│  PaymentView · CustomerView · LedgerView · TreasuryView ·         │
│  ActivityView · WebhookQueue · AnalyticsView ·                    │
│  ResourceGraphView · EconomicGraphView · StateTimelineView ·      │
│  DecisionLogView                                                  │
└───────────────────────────┬──────────────────────────────────────┘
                            │  clients READ ONLY from read models
                            ▼
                       [CLIENTS]
```

**The invariant:** Clients write Intents (via App Services) and read Read
Models. They never touch the Event Store directly, never replay events, and
never call Engines directly. The pipeline is the only write path; read models
are the only read path.

---

## 4. Application Services — Kept as Orchestration

Application Services stay. They are **not** replaced by per-command handlers.
A service method is the canonical public entry for a business operation; it
builds an Intent and drives the pipeline.

```ts
class PaymentService {
  async create(params: CreatePaymentParams): Promise<PaymentResult> {
    // 1. Build a typed Intent
    const intent = PaymentIntent.from(params);

    // 2. Hand to the pipeline; the pipeline runs the 14 stages
    const handle = await pipeline.execute({
      intent,
      actor: params.actor,
      environment: params.environment,
      source: params.source ?? 'rest',
    });

    // 3. Return a handle to the read model (NOT a replay)
    return paymentView.get(handle.aggregateId);
  }
}
```

**Why keep services instead of pure command handlers:**
- A service method is a higher-level, business-named operation
  (`createPayment`, `refund`, `rebalance`). Hundreds of fine-grained command
  handlers become a maintenance burden PaySwap doesn't need.
- Services are the natural seam for the SDK/REST surface a merchant calls.
- The pipeline (not the service) enforces uniformity. The service is thin:
  build intent → execute → return read model.

**Back-compat:** existing service method signatures stay. Internally they
switch from "write Prisma + emit to in-memory bus" to "build intent → drive
pipeline." Existing callers (API routes, world simulator during migration)
keep working.

---

## 5. The Protocol Runtime — Engines

Each engine owns one stage (or a tightly-coupled cluster of stages) of the
pipeline. Engines are **decision services**: they read the current world
state, consult the kernel's pure functions, and return a **Decision** (§5.7)
that the pipeline records and acts on. Engines never write Prisma directly;
they return decisions that become Domain Events, which projections turn into
read-model writes.

### 5.1 Settlement Engine — the product

**Why it's the biggest addition.** v1 treated settlement as a step inside
payment. For PaySwap, **settlement is the product.** Every money movement —
payments, payouts, refunds, wallet transfers, treasury rebalances — flows
through one Settlement Engine.

**Stages it owns:** 7 (Settlement Planning) and 8 (Execution), in concert
with the Liquidity Market (stage 6) and Reserve Engine (stage 5).

**Internal flow:**
```
connector selection → LP selection (from Market) → reserve reservation →
FX → liquidity routing → execution → confirmation → reconciliation
```

**Contract:**
```ts
interface SettlementEngine {
  plan(req: SettlementPlanRequest): Promise<SettlementPlan>;
  execute(plan: SettlementPlan): Promise<SettlementResult>;
  reconcile(settlementId: string): Promise<ReconciliationResult>;
}

interface SettlementPlan {
  legs: SettlementLeg[];          // ordered money movements
  connectorChoices: { legId: string; driverId: string }[];
  lpAllocations: { legId: string; lpId: string; amount: number }[];
  fxHops: FXHop[];
  timing: 'immediate' | 'scheduled' | 'deferred';
  collateral: CollateralPlan;
  rationale: Decision;            // why this plan (see Decision Engine)
}
```

**Reuses:** `protocol/settlement/*` (escrow, net-settlement, auctions,
disputes, collateral/capacity vaults, manual-settlement) and the kernel's
`PlanExecutor` (the unified sim/production executor). The Settlement Engine
wraps these behind one contract and drives them through the pipeline.

### 5.2 Treasury — Capital Allocator

**Reframe:** Treasury stops being "reserves + dashboard" and becomes an
**optimization engine** that continuously allocates capital.

**Inputs it optimizes across:**
```
idle capital · corridor demand · LP demand · expected traffic ·
FX exposure · float · yield · risk
```

**Contract:**
```ts
interface TreasuryAllocator {
  // At stage 5 of the pipeline: how do we fund this operation?
  allocate(req: AllocationRequest): Promise<AllocationDecision>;

  // Continuous: rebalance idle capital across corridors/LPs/yield.
  rebalance(): Promise<RebalanceDecision[]>;

  // Forward: expected demand → pre-position capital.
  forecast(): Promise<ForecastPlan>;
}

interface AllocationDecision {
  reserveDraws: ReserveDraw[];     // which reserves, how much
  stablecoinSwaps: Swap[];
  lpPreFunding?: LPFunding;
  yieldPlacement?: YieldPlacement; // park idle capital earning yield
  rationale: Decision;
}
```

**Reuses:** `kernel/optimization-engine.ts` (5 candidates, 8-objective
scoring), `kernel/treasury-ai.ts` (continuous recommendations),
`protocol/treasury-v2/*` (yield, efficiency, limits, backing). The Allocator
calls these as pure functions; the pipeline applies the resulting decision.

### 5.3 Reserve Engine — separated from Treasury

**Why separate.** v1 had reserves inside Treasury. Reserves have their own
accounting (twin-token backing) and their own lifecycle (lock/release). A
dedicated engine keeps twin accounting clean and lets Treasury focus on
allocation.

**Owns:** reserve locking, release, collateral management, mint/burn
authorization, backing verification, exposure tracking, fiat proofs,
liquidity snapshots.

**Contract:**
```ts
interface ReserveEngine {
  lock(req: LockRequest): Promise<LockResult>;       // stage 5
  release(lockId: string): Promise<ReleaseResult>;
  mint(req: MintRequest): Promise<MintResult>;       // twin token
  burn(req: BurnRequest): Promise<BurnResult>;
  verifyBacking(): Promise<BackingProof>;            // twin supply == reserves
  snapshot(): Promise<ReserveSnapshot>;
}
```

**Reuses:** `kernel/reserve.ts`, `kernel/twin-token.ts`,
`protocol/twin-token/engine.ts`, `protocol/economics/fiat-proof.ts`. The
Constitution invariant "twin token backed" (kernel) is enforced here as a
hard check on every mint.

### 5.4 Liquidity Engine — a Market

**The largest architectural opportunity.** LPs stop being rows with balances;
they become **market participants** that publish strategies. The runtime
scores, the market clears, the winner executes.

**LP strategy (what an LP publishes):**
```ts
interface LPStrategy {
  pricingCurve: PricingCurve;        // fee as function of utilization/amount
  riskAppetite: 'low'|'medium'|'high';
  corridorPreferences: CorridorPref[]; // willing corridors with capacity
  supportedRails: Rail[];             // mobile_money, bank, stablecoin, ...
  reserveRequirements: Record<string, number>; // min collateral per corridor
  latencyTarget: number;              // ms
  utilizationTarget: number;          // 0..1 desired
  yieldTarget: number;                // APR
}
```

**Market flow (stage 6):**
```
operation intent → eligible LPs (by corridor + rail + capacity)
  → each LP's pricingCurve quotes a fee
  → runtime scores each quote (cost, speed, risk, reliability, reputation)
  → market clears: winner(s) selected, possibly split across multiple LPs
  → winning LPs execute (stage 8)
  → decision recorded (why this LP, what was rejected, tradeoffs)
```

**Contract:**
```ts
interface LiquidityMarket {
  // LP lifecycle
  publishStrategy(lpId: string, strategy: LPStrategy): void;
  updateStrategy(lpId: string, patch: Partial<LPStrategy>): void;
  pause(lpId: string): void;

  // Market operations (stage 6)
  quote(req: QuoteRequest): Promise<LPQuote[]>;
  clear(quotes: LPQuote[], req: ClearRequest): Promise<ClearingResult>;
  // ClearingResult: winning LPs + allocations + rejected quotes + reasons

  // Continuous
  rebalance(): Promise<RebalanceDecision[]>;   // shift LP capital per strategy
  explainSelection(operationId: string): LPSelectionExplanation;
}
```

**Reuses:** `protocol/liquidity-network/*` (scoring, routing, capacity,
pricing, health, forecast), `kernel/lp-lifecycle.ts` (stake/withdraw/slash
state machine). The Market adds the **strategy publication + clearing**
layer on top.

### 5.5 Decision Engine — every decision is an artifact

Every important decision in the pipeline produces a **Decision** — a
first-class, recorded, explainable artifact. This is what makes PaySwap
"explainable protocol execution" real.

**Where decisions are produced:** LP selection, routing, treasury allocation,
reserve movement, compliance screening, fraud scoring, settlement plan
choice, FX path choice, retry/timeout choices.

**Contract:**
```ts
interface Decision {
  id: string;
  kind: DecisionKind;   // 'lp_select'|'route'|'treasury_alloc'|'reserve_move'
                        // |'compliance'|'fraud'|'settlement_plan'|'fx'|'retry'
  subject: string;      // what was decided about (e.g. operation id)
  choice: string;       // what was chosen
  score: number;        // 0..1 confidence
  confidence: number;   // 0..1
  alternatives: { option: string; score: number; rejectedBecause: string }[];
  tradeoffs: { dimension: string; delta: number }[];
  constraints: { name: string; value: string }[];
  evidence: EvidenceCitation[];   // kernel evidence primitive
  reasoning: string;              // human-readable
  ts: number;
}
```

Decisions are stored in a `DecisionLogView` read model and rendered in the
Protocol Inspector as expandable nodes. The kernel's `reasoning-engine.ts`
and `confidence-engine.ts` provide the scoring backbone.

### 5.6 Policy Engine — explicit, evaluable

Stripe has lots of hidden policy. PaySwap exposes it. At stage 3, every
operation is evaluated against an explicit policy set.

**Questions the Policy Engine answers:**
```
Can this actor settle this amount in this corridor?
Can this merchant mint twin tokens?
Can this refund exceed the original payment?
Can this reserve be released before settlement confirms?
Can this LP be changed mid-operation?
Can this failed step be retried? How many times?
```

**Contract:**
```ts
interface PolicyEngine {
  evaluate(req: PolicyRequest): Promise<PolicyDecision>;
  // PolicyDecision: ALLOW | DENY | REQUIRE_APPROVAL + reason + ruleId
}

interface PolicyRule {
  id: string;
  name: string;
  when: PolicyCondition;     // e.g. amount > 50000 && corridor == 'NGN-GHS'
  then: PolicyAction;        // ALLOW | DENY | REQUIRE_APPROVAL
  scope: 'sandbox' | 'live' | 'both';
}
```

Policy rules are data (stored, versioned, auditable), not hardcoded branches.
Enterprise customers can later bring their own policy sets. Reuses
`kernel/policy.ts` + `kernel/permission.ts` + `kernel/capabilities.ts`.

### 5.7 Scheduling Engine — not everything is immediate

**Owns:** deferred and recurring operations.

**Examples:**
```
settle in 4 hours · retry failed webhook tomorrow · daily reconciliation ·
reserve rebalance every 5 min · FX hedge at market open ·
LP withdrawal after settlement window · end-of-day trial balance
```

**Contract:**
```ts
interface SchedulingEngine {
  schedule(job: ScheduledJob): Promise<ScheduleHandle>;
  cancel(handle: ScheduleHandle): Promise<void>;
  due(now: number): Promise<ScheduledJob[]>;
}

interface ScheduledJob {
  id: string;
  kind: 'one_shot' | 'cron' | 'fixed_rate';
  at?: number;              // epoch ms (one_shot)
  cron?: string;            // (cron)
  intervalMs?: number;      // (fixed_rate)
  tz?: string;              // e.g. 'Africa/Accra'
  command: RuntimeCommand;  // what to dispatch when due
  retryPolicy?: RetryPolicy;
}
```

When a job is due, the Scheduling Engine dispatches its command through the
normal pipeline — scheduled work is just deferred pipeline work. Reuses the
kernel's `WorkflowEngine` templates for multi-step scheduled workflows.

### 5.8 Risk & Fraud Engine

**Owns stage 4.** Scoring, screening, holds. Reuses `kernel/risk.ts` +
`kernel/fraud.ts` + `protocol/security/*`. Output is a Decision
(block / allow / hold-for-review) recorded in the trace.

---

## 6. Events — Domain vs Runtime

v1 put everything in one event bucket. v2 separates them. This makes replay
clean: replaying Domain Events rebuilds business state; Runtime Events are
operational telemetry that can be retained or discarded independently.

### 6.1 Domain Events (business state)
Affect business state. Appended to the Event Store. Replaying them rebuilds
aggregates and read models.

```
PaymentIntentReceived · PaymentValidated · PolicyPassed · RiskCleared ·
ReserveLocked · LPSelected · SettlementPlanned · SettlementExecuted ·
LedgerPosted · PaymentCompleted · PaymentFailed · RefundCreated ·
SettlementCompleted · ReserveReleased · TwinTokenMinted · TwinTokenBurned ·
EscrowCreated · EscrowReleased · LPStaked · LPWithdrawn · LPSlashed ·
TreasuryRebalanced · CorridorFrozen · CorridorReopened
```

### 6.2 Runtime Events (operational)
Operational side-effects. Recorded (for inspection and ops) but **not**
replayed to rebuild business state.

```
WebhookQueued · WebhookDelivered · WebhookFailed ·
ProjectionCompleted · ProjectionRebuilt ·
NotificationSent · EmailDelivered · SmsDelivered ·
AnalyticsUpdated · DecisionRecorded ·
ScheduledJobFired · ScheduledJobCompleted ·
ConnectorCalled · ConnectorHealthChanged ·
CircuitBreakerTripped · CircuitBreakerReset
```

### 6.3 Store layout
The Event Store has two logical streams per aggregate:
- `domain:<aggregateId>` — Domain Events, append-only, source of truth.
- `runtime:<aggregateId>` — Runtime Events, retained for inspection/ops,
  independently prunable.

The global log preserves total order across both. Projections subscribe to
Domain Events for read-model writes; ops dashboards subscribe to Runtime
Events for telemetry.

---

## 7. Event Store — Audit / Replay / Sim / Debug / Inspect (NOT the read path)

**The key correction from v1:** the Event Store is **not** the database. It
is the immutable record that powers audit, replay, simulation, debugging, and
the Inspector. Normal pages **never** replay events — they read read models,
which projections update **immediately** on append (within the same
transaction).

```
Application Service
   ↓ (append Domain Events)
Event Store  ───────────────────►  audit log
   ↓ (publish, same txn)            replay source
Projections                         simulator source
   ↓ (write)                        debugging source
Read Models  ──────────────────►   Inspector source
   ↓
Pages read here (never the store)
```

**Contract:**
```ts
interface EventStore {
  append(streamId: string, events: UncommittedDomainEvent[],
         expectedVersion: number): Promise<AppendResult>;
  readStream(streamId: string, fromVersion?: number): Promise<StoredEvent[]>;
  readAll(fromPosition: number, limit: number): Promise<StoredEvent[]>;
  snapshot(streamId: string): Promise<Snapshot | null>;
  loadAggregate<T>(streamId: string): Promise<{state: T; version: number}>;
  // Replay = rebuild one read model from domain events (admin/ops only)
  replayProjection(name: string, fromPosition: number): Promise<void>;
}
```

**Why this matters:**
- **Reads are fast and simple** — read-model queries, no replay.
- **The store is pure history** — append-only, OCC by stream version,
  snapshotable for fast aggregate load.
- **Replay is an admin/sim capability**, not a read path. Wipe a read model,
  replay its Domain Events, it restores identically. The simulator replays
  to reproduce a production trace.
- **Persistence:** a single Prisma `EventRecord` table (append-only) plus
  `EventSnapshot` for compaction. The in-memory `EventBus` is retired; an
  in-process publisher inside the store fires projections synchronously on
  commit.

---

## 8. Two Graphs — Resource + Economic

v1 had one graph. v2 has two, answering different questions.

### 8.1 Resource Graph (business relationships)
Answers: *"What business objects relate to this payment?"*

```
Payment → Refund → Invoice → Customer → Merchant → Subscription → Dispute
```

Nodes are domain aggregates; edges are structural/causal business links.
Built by the `ResourceGraphProjection` from Domain Events. Powers the
Inspector's business-object tree.

### 8.2 Economic Graph (money relationships)
Answers: *"Where did the money move, and what backed it?"*

```
Reserve → LP → Wallet → Treasury → FX → Settlement → Escrow → TwinToken
```

Nodes are economic entities (reserves, LP positions, wallets, treasury
positions, FX hops, settlement legs, escrows, twin token supplies); edges
carry financial weights (amount, currency, cost, risk). Built by the
`EconomicGraphProjection` from Domain Events. Powers the Inspector's
money-flow view and the economic-integrity reconciler.

**Relationship to the kernel:** the kernel's `financial-graph.ts` is the
**liquidity graph** the optimizer traverses at planning time (in-memory,
simulation-flavored). The Runtime's Economic Graph is its **persistent,
projected twin** — rebuilt from Domain Events, queryable by the Inspector
and the reconciler. Different purpose, both exist.

**Contract:**
```ts
interface GraphQuery {
  // Resource graph
  businessTree(rootId: string): { nodes: ResourceNode[]; edges: ResourceEdge[] };
  // Economic graph
  moneyFlow(rootId: string): { nodes: EconomicNode[]; edges: EconomicEdge[] };
  // Cross-graph: "show me the business object and the money it moved"
  unified(rootId: string): UnifiedGraphView;
}
```

---

## 9. API Gateway — one place for cross-cutting edge concerns

v1 left each route owning auth/rate-limit/idempotency. v2 consolidates these
into an API Gateway so routes are pure "validate params → call service →
return."

```
External API request
   ↓
Gateway middleware (one implementation):
   1. Authenticate (NextAuth session OR API key + secret)
   2. Rate limit (per actor + per org, sandbox/live separate buckets)
   3. Idempotency (key in header → cached response if seen)
   4. Versioning (header → route to correct service version)
   5. Request logging + tracing (correlationId assigned here)
   6. Quota enforcement (plan-based)
   ↓
Route handler: validate params → call App Service → return JSON
```

**Implementation:** a single Next.js middleware + a thin wrapper the route
handlers call. Existing routes migrate to the wrapper incrementally. The
Gateway writes the request as the root `TraceNode` (correlationId) that the
Inspector renders.

---

## 10. Simulator — a Runtime Client

**The strongest guarantee:** the simulator is indistinguishable from a real
merchant. It does not call services directly with special-cased paths; it
goes through the same SDK → REST/gRPC → Application Service → Runtime →
Events path.

```
Simulator
   ↓ (SDK call, identical to a merchant integration)
REST/gRPC API
   ↓
API Gateway
   ↓
Application Service
   ↓
Pipeline (14 stages)  ← identical to production
   ↓
Events → Projections → Read Models
```

**What differs between sandbox and live:** **only data sources and
configuration** — not execution paths. The sandbox uses simulated connector
drivers (MTN/Stripe stubs) and seeded reserves; live uses real connectors
and real reserves. The pipeline, engines, event store, and projections are
literally the same code.

**Failure injection:** the simulator passes a `FailureInjection` on the
Intent (e.g. "fail LP at stage 8, frame 3"). The pipeline applies it at the
specified stage; the resulting Domain Events (`LPFailed`, `CompensationStarted`,
`ReserveFallbackUsed`) are identical to what production would emit if the
failure happened live. This is what makes a twin run a faithful reproduction.

**Reuses:** the kernel's `OptimizationEngine`/`PlanExecutor`/`WorldStore` are
invoked by the Settlement/Treasury/Reserve engines during real pipeline runs,
so the twin's brain is the production brain — no parallel universe.

---

## 11. End-to-End — One Payment Through the Pipeline

1. **Client** (merchant dashboard) calls `POST /api/payments/create`.
2. **API Gateway** authenticates, rate-limits, assigns `correlationId`,
   writes the root `TraceNode`.
3. **Route** validates params, calls `paymentService.create()`.
4. **PaymentService** builds a `PaymentIntent`, calls `pipeline.execute()`.
5. **Pipeline stage 1 — Intent:** typed request recorded.
6. **Stage 2 — Validation:** schema + business invariants; Domain Event
   `PaymentValidated`.
7. **Stage 3 — Policy:** `PolicyEngine.evaluate()` → `PolicyPassed`;
   Decision recorded (ruleId, reason).
8. **Stage 4 — Risk & Fraud:** `RiskEngine` + `FraudEngine` score; Decision
   recorded; `RiskCleared` (or `RiskHeld`).
9. **Stage 5 — Treasury & Reserve:** `TreasuryAllocator.allocate()` returns
   an `AllocationDecision` (which reserves, stablecoin swaps, yield
   placement); `ReserveEngine.lock()` locks reserves; Domain Events
   `ReserveLocked`, `TreasuryRebalanced`.
10. **Stage 6 — Liquidity Market:** eligible LPs (by corridor + rail +
    capacity) quote via their `pricingCurve`; `LiquidityMarket.clear()`
    picks winner(s), possibly split; `LPSelected` Domain Event; Decision
    recorded (chosen LP, rejected quotes + reasons, tradeoffs).
11. **Stage 7 — Settlement Planning:** `SettlementEngine.plan()` returns
    legs, connector choices, FX hops, timing, collateral; Decision recorded.
12. **Stage 8 — Execution:** `SettlementEngine.execute()` drives connector
    drivers (MTN authorize→capture) / chain / banks; `SettlementExecuted`.
13. **Stage 9 — Ledger Posting:** double-entry, immutable; `LedgerPosted`.
14. **Stage 10 — Event Emission:** all Domain Events appended to the Event
    Store (atomic, OCC).
15. **Stage 11 — Projection Updates:** projections fire **immediately**
    (same transaction) → `PaymentView`, `LedgerView`, `TreasuryView`,
    `ResourceGraphView`, `EconomicGraphView`, `DecisionLogView`,
    `StateTimelineView` updated.
16. **Stage 12 — Notifications & Webhooks:** Runtime Events `WebhookQueued`,
    `NotificationSent`; webhook delivery driven by the WebhookProjection.
17. **Stage 13 — Analytics:** `AnalyticsUpdated` Runtime Event; LTV, corridor
    stats, metrics.
18. **Stage 14 — Protocol Inspection:** one `TraceNode` per stage written to
    `StateTimelineView`, correlated by `correlationId`.
19. **PaymentService** returns `paymentView.get(id)` — a read model, never a
    replay.
20. **Reconciliation (background):** trial balance + twin supply verified;
    result appended as a reconcile trace node.

**Simulator parity:** the twin dispatches the same `PaymentIntent` via the
SDK with `source: 'simulator'` and a `FailureInjection`. Steps 5–18 run the
identical code; the only differences are connector drivers (stubbed) and
reserve data (seeded). The resulting trace is structurally identical to a
production trace.

---

## 12. Economic-Integrity Invariants

Two non-overridable invariants, checked continuously by a reconciler that
reads Domain Events. A violation halts new appends for that environment and
fires a critical alert.

### 12.1 Trial Balance
For every currency and environment, at every global position:
```
Σ(debit ledger entries) === Σ(credit ledger entries)
```
The `LedgerProjection` maintains running balances; the reconciler recomputes
from the raw Domain Event log on a schedule and on every settlement event.

### 12.2 Twin Supply Reconciliation
At every global position:
```
Σ(twin tokens minted) − Σ(twin tokens burned) === outstanding twin token supply
                                                              === backed fiat reserves
```
Every `TwinTokenMinted` must have a corresponding fiat-reserve credit; every
`TwinTokenBurned` a debit. The Reserve Engine's `verifyBacking()` is the
per-operation check; the reconciler is the continuous guarantee.

These are the kernel's `Constitution` (10 invariants) made
**production-enforceable at the store level**, not just evaluated in
simulation.

---

## 13. Sandbox / Live Isolation

- Every Intent, Domain Event, Runtime Event, and read-model row carries an
  `environment` field.
- Event Store stream IDs are prefixed: `live:payment_abc` vs
  `sandbox:payment_abc`. The pipeline refuses cross-environment intents.
- Connector drivers are selected per environment: sandbox uses stubs, live
  uses real connectors. Same driver contract, different implementation.
- Projections filter by environment; a sandbox event never updates a live
  read model and vice versa.
- **The execution path is identical.** Sandbox and live differ only by data
  sources and configuration (§10).

---

## 14. Migration Strategy — Strangler Fig

A full rewrite of 77 pages and 97 routes at once is infeasible. The
migration introduces the Runtime alongside existing services and migrates
incrementally. At no point is the app broken.

### Phase A — Runtime Core (non-disruptive)
- Add `src/runtime/` with the pipeline scaffold, Event Store, Domain/Runtime
  event split, and immediate projection runner. New `EventRecord` table;
  existing tables untouched.
- App Service methods switch internally to "build Intent → drive pipeline,"
  but the pipeline initially calls the **existing service logic** (so
  behavior is unchanged). Events are appended **and** published to the old
  in-memory bus (existing projections keep firing).
- Result: the Event Store begins filling with real Domain Events; nothing
  breaks.

### Phase B — Projections own the tables
- Move projection logic into `src/runtime/projections/`, fed from the Event
  Store. Projections now **write** existing tables from Domain Events.
- App Services stop writing tables directly; they only append events. The
  in-memory bus is retired.

### Phase C — Engines behind the pipeline
- Introduce the engines one at a time behind their pipeline stages:
  Policy → Risk/Fraud → Reserve → Settlement → Treasury Allocator →
  Liquidity Market → Decision → Scheduling. Each stage swaps from "call old
  service logic" to "call engine, record Decision, emit Domain Event."
- The kernel's pure-function engines are wired in as the engines' compute
  core.

### Phase D — Read Models + API Gateway
- Introduce read-model façades; migrate pages off direct Prisma, one page
  at a time. Introduce the API Gateway middleware; migrate routes onto it.

### Phase E — Two Graphs + Inspector + Simulator-as-client
- `ResourceGraphProjection` + `EconomicGraphProjection` feed the Inspector.
- Refactor the world simulator to dispatch Intents through the SDK/REST
  surface (it becomes a client, not a special caller).

### Phase F — Integrity hardening
- Continuous reconciliation (trial balance + twin supply) at every commit;
  halt-on-violation. Schedule Engine drives daily reconciliations and
  rebalances.

---

## 15. Implementation Roadmap

Each milestone improves the **protocol architecture**, per the governing
rule. No milestone adds raw CRUD or business logic to pages.

| Milestone | Deliverable | Exit criteria |
|---|---|---|
| **M-RT-1** Runtime Core + Pipeline | 14-stage pipeline scaffold, Event Store (`EventRecord`), Domain/Runtime event split, immediate projection runner. App Services drive the pipeline (initially calling existing logic). | A real payment appends Domain Events to the store; existing UI unchanged. |
| **M-RT-2** API Gateway | Auth + rate-limit + idempotency + versioning + correlationId in one middleware. Routes thin to "validate → call service → return." | No route owns cross-cutting concerns; correlationId on every request. |
| **M-RT-3** Policy + Decision Engines | Stage 3 policy evaluation (explicit rules); Decision artifacts recorded for every important choice. | A payment's trace shows PolicyPassed + a Decision with alternatives. |
| **M-RT-4** Reserve Engine | Lock/release/collateral/mint-burn/backing/proofs/snapshots, separated from Treasury. Twin supply invariant checked per mint. | `ReserveEngine.verifyBacking()` passes after every mint. |
| **M-RT-5** Settlement Engine | Every payment/payout/refund/wallet-transfer flows through one Settlement Engine (plan → execute → reconcile). | A refund's trace shows it flowing through the same engine as a payment. |
| **M-RT-6** Treasury Capital Allocator | Stage 5 allocation + continuous rebalance + forecast. Idle capital optimized across corridors/LPs/yield. | Allocator returns a Decision with rationale + alternatives. |
| **M-RT-7** Liquidity Market | LP strategy publication + quote + clear + execute. LPs have pricing curves/risk/rails/yield targets. | An LP sets a strategy; market clears and logs why it won/lost. |
| **M-RT-8** Two Graphs | Resource Graph (business) + Economic Graph (money) projections and queries. | Inspector shows both trees for a payment. |
| **M-RT-9** Scheduling Engine | Deferred/recurring jobs dispatch commands through the pipeline. | "Settle in 4 hours" fires correctly; daily reconciliation runs. |
| **M-RT-10** Read Models migration | Pages migrated off direct Prisma onto read-model façades. Lint rule forbids `db.<DomainTable>` outside runtime. | Zero direct Prisma calls in pages. |
| **M-RT-11** Protocol Inspector | Full Inspector UI on `StateTimelineView` + both graphs + Decision log. Expandable, replayable, simulate-with-injection. | Operator clicks a payment → sees full 14-stage tree + money flow + decisions. |
| **M-RT-12** Simulator as Runtime Client | World simulator dispatches Intents via SDK/REST. Sandbox and live differ only by data/config. | A twin trace is structurally identical to a production trace. |
| **M-RT-13** Economic Integrity Hardening | Continuous reconciliation (trial balance + twin supply) at every commit; halt-on-violation; alert. | Injected imbalance halts the environment + alerts. |

---

## 16. Production Quality Gates

### 16.1 Architecture
- No business logic in `src/app/**` pages or routes (lint rule + review).
- No `db.<DomainTable>` access outside `src/runtime/projections/` and
  `src/runtime/read-models/` (lint rule).
- Kernel untouched: `git diff --name-only HEAD -- src/kernel/` returns 0.
- Every operation flows through the 14-stage pipeline; no shortcut paths.

### 16.2 Functional
- Every stage emits ≥1 Domain Event + ≥1 TraceNode.
- Every important decision is a recorded Decision with alternatives + tradeoffs.
- Every engine has a declared contract; no engine writes Prisma directly.
- Sandbox and live share the identical pipeline; only data/config differs.

### 16.3 Integration
- The simulator dispatches the same Intents as REST (verified by trace-shape
  equality).
- Webhook replay re-dispatches the original Intent and produces an identical
  Domain Event sequence.
- Cross-environment intents are rejected by the pipeline.

### 16.4 Simulator
- A production operation's trace and the twin's trace of the same operation
  are structurally equal (same stages, same decision kinds, same event types).
- Injected failures produce declared compensation, not silent catches.
- Replay from any aggregate version reproduces the same state and decisions.

### 16.5 UX
- The Protocol Inspector renders for every operation type.
- Read-model queries return within the existing p95 (no regression).
- Sticky footer, responsive layout, loading skeletons preserved (M10 polish
  carries forward).

### 16.6 Performance
- Pipeline dispatch p99 < 50ms (excluding connector/chain I/O).
- Event Store append p99 < 20ms.
- Projection catch-up (rebuild) processes ≥ 10k events/sec (snapshot-assisted).
- Reconciliation check p99 < 100ms.

### 16.7 Documentation
- Each engine has a README in `src/runtime/engines/<name>/README.md`.
- The pipeline stages are documented with their inputs/outputs/decisions.
- The event catalog (kernel `events.ts`) is extended with Runtime Domain and
  Runtime event types and rendered in developer docs.

---

## 17. What Does NOT Change

- **The frozen kernel.** Zero modifications to `src/kernel/*`. The Runtime
  imports its types and pure functions; it never edits them.
- **The product surface.** No pages are deleted. Existing URLs keep working.
  The 9 demo accounts, 9 orgs, and all role-based access remain.
- **The differentiators — realized, not replaced.** Programmable liquidity
  becomes real via the Liquidity Market; treasury intelligence via the
  Capital Allocator; the digital twin via simulator-as-client; explainable
  protocol execution via the Decision Engine + Inspector; transparent routing
  via the Settlement Engine's rationale; twin backing via the Reserve Engine.
- **Stripe as benchmark, not limit.** We keep Stripe's discipline (uniform
  pipeline, immediate projections, explainable traces) and add the engines
  Stripe doesn't have.

---

## 18. Scorecard Target

| Area | v1 target | v2 target |
|---|---|---|
| Product UX | 9.5/10 | 9.5/10 |
| Architecture | 10/10 | 10/10 |
| Financial protocol | 10/10 | 10/10 |
| Event-driven design | 10/10 | 10/10 |
| Simulator integrity | 10/10 | 10/10 |
| Production readiness | 9.5/10 | 9.5/10 |
| Stripe parity | ~90% | ~90%+ |
| **Programmable-network capability** | partial | **full** (settlement engine, liquidity market, capital allocator, reserve engine, decision engine, two graphs) |

The v2 architecture leans into what makes PaySwap unique instead of mirroring
Stripe's internal structure. The remaining gap to 100% is external systems
(real Stellar mainnet, real bank APIs, real KYC, regulatory licensing) —
explicitly out of scope for application architecture.

---

*End of Phase 1 v2 (Architecture Design). Phase 2 (Implementation) begins
with Milestone M-RT-1: Runtime Core + Pipeline.*
