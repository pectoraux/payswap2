# PaySwap Protocol Runtime — Architecture (Phase 1: Design)

> **Status:** Architecture design. No implementation in this phase.
> **Governing rule:** No business logic in pages or API routes. All state
> transitions flow through Commands → Application Services → Domain Events →
> Projections. Every workflow must be **inspectable, replayable, explainable,
> and simulatable.**
> **Kernel constraint:** The frozen kernel (`src/kernel/*`) is never modified.
> Everything below is built **above** the kernel primitives.

---

## 0. The One Rule and Why It Exists

Stripe's coherence at scale comes from one discipline: **there is exactly one
way state changes** — a command enters a bus, a handler mutates a domain
aggregate, the aggregate emits events, events are appended to an immutable
store, projections derive read models, the UI reads only read models.

PaySwap today has **two parallel worlds that never meet**:

```
PRODUCTION:  UI → API → Service → Prisma → in-memory EventBus → Projections → Prisma
SIMULATION:  scenario → kernel engines (OptimizationEngine → PlanExecutor → WorldStore)
                            → in-memory EventEngine → replay frames
```

A simulated payment does **not** flow through `PaymentService`. A production
payment does **not** flow through the kernel. The simulator cannot reproduce a
production bug because it runs different code. The Protocol Inspector cannot
exist because there is no single trace to inspect.

The Protocol Runtime collapses these into **one pipeline** that both
production and simulation use. Every entry point issues the same command. Every
command produces the same kind of trace. The simulator becomes a *driver* of
the real pipeline, not a parallel universe.

---

## 1. Current-State Assessment

### 1.1 What is strong — KEEP

| Asset | Location | Why it stays |
|---|---|---|
| Application services | `src/services/*` | Single entry points; the right seam. They become command handlers. |
| Event bus + projections | `src/services/event-bus.ts`, `projections/*` | Correct pattern (pub/sub → side effects). Upgrade the substrate from in-memory to a persistent store; keep the projection contracts. |
| Thin API routes | `src/app/api/*` | Already mostly "validate → call service → return JSON". They thin further to "validate → dispatch command → return". |
| Kernel primitives | `src/kernel/{command,transition,event,entity,capability,evidence,proposal}.ts` | The 7 frozen primitives provide the vocabulary. The Runtime reuses their *types and pure functions* without modifying them. |
| Kernel simulation engines | `src/kernel/{optimization-engine,plan-executor,world-store,state-machine,financial-graph,constitution,...}.ts` | The Digital Twin's brain. The Runtime **drives** these engines by dispatching the same commands production uses; it does not replace them. |
| Protocol domain modules | `src/protocol/{ledger,settlement,liquidity-network,treasury-v2,connectors-v2,resilience,security,ops,economics}/*` | Domain logic that handlers call. Formalized behind driver/workflow contracts. |

### 1.2 What is missing — BUILD

1. **No Command Bus.** Services are called directly by name. REST, CLI,
   simulator, webhook replay, schedulers, AI agents, and extensions each must
   know *which service method* to call. They cannot issue a uniform command.
2. **No persistent Event Store.** `EventBus` is in-process with a 10k rolling
   cap. Events are **side-effects after Prisma writes**, not the source of
   truth. A process restart loses them; they cannot be replayed.
3. **No Read Models.** Pages query Prisma tables directly. There is no
   projection-derived view layer, so every dashboard reads raw rows and
   re-derives state on the fly.
4. **Application state machine is not wired.** `STATE_MACHINES` exists in the
   kernel (9 object kinds, full edge table) but `PaymentService.create()`
   writes `status: 'COMPLETED'` straight to Prisma, bypassing every transition.
   State changes are not validated, not logged, not replayable.
5. **No application-layer Resource Graph.** The kernel has
   `financial-graph.ts` for simulation. Production has no graph linking
   Payment → Settlement → ReserveAllocation → LP → TreasuryJournal →
   AccountingEntries → Webhook → Analytics → CustomerLTV.
6. **No inspectable Workflow Engine.** `kernel/workflow.ts` holds templates;
   production has no engine with steps, compensation, retries, timeouts. A
   refund is `refundService.create()` — opaque.
7. **Connectors are not uniform drivers.** `protocol/connectors-v2/*` has
   adapters with audit/retry/health, but no single
   `authorize/capture/refund/webhook/health/capabilities` contract every
   connector implements.
8. **Treasury/Liquidity are sim-focused.** `treasury-v2` and
   `liquidity-network` compute for the twin. Production payments do not ask
   the treasury optimizer "how should reserves move?" in real time.
9. **No Protocol Inspector.** There is no single trace tying API request →
   command → validation → workflow → reserve allocation → LP selection →
   ledger → settlement → webhooks → analytics → completed.

### 1.3 The delta in one diagram

```
TODAY                              TARGET
─────                              ──────
UI → API → Service → Prisma        UI → API → Command Bus → Handler → Aggregate
            ↓                                  ↓
        in-mem bus                       Event Store (source of truth)
            ↓                                  ↓
        Projections → Prisma             Projections → Read Models → UI
```

Prisma stops being the write target of services. It becomes the **physical
store** that projections write to and read models read from. The Event Store
is the logical source of truth; Prisma tables are materialized views.

---

## 2. Target Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS — all issue the SAME command                            │
│  REST · CLI · Simulator · Webhook Replay · Scheduled Jobs ·           │
│  AI Agent · Extensions                                                │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ Command (serializable intent)
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  COMMAND BUS                                                          │
│  1. validate schema   2. authorize (capability + scope)               │
│  3. idempotency check  4. dispatch to handler   5. record outcome     │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  COMMAND HANDLERS (one per command type)                              │
│  CreatePaymentHandler · RefundPaymentHandler · MoveReserveHandler ·   │
│  SelectLPEndpointHandler · FreezeCorridorHandler · …                  │
│  Each handler: load aggregate → call domain method → return events    │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  DOMAIN — Aggregates + State Machines                                 │
│  PaymentAggregate · RefundAggregate · PayoutAggregate ·               │
│  LPAggregate · ReserveAggregate · TreasuryAggregate ·                │
│  EscrowAggregate · WebhookAggregate                                   │
│  Every transition validated against STATE_MACHINES;                   │
│  every transition emits ≥1 domain event.                              │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ uncommitted events
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  EVENT STORE (append-only, source of truth)                           │
│  EventStream(aggregateId) · global log · snapshots · replay ·         │
│  time machine · per-stream versioning (optimistic concurrency)        │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ publish (within same transaction)
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  PROJECTIONS (each builds exactly one read model)                     │
│  PaymentView · CustomerView · LedgerView · TreasuryView ·             │
│  ActivityView · WebhookQueue · AnalyticsView · ResourceGraphView ·    │
│  StateTimelineView (powers the Inspector)                             │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  READ MODELS — the ONLY thing UI/API reads                            │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────────────┐
│  UI — pages read read models, issue commands. Zero business logic.    │
└───────────────────────────────────────────────────────────────────────┘
```

### 2.1 The Runtime package

All new code lives in **`src/runtime/`** — the "Protocol Runtime." It sits
above the kernel and below the API:

```
src/
├── kernel/          ← FROZEN (never modified)
├── protocol/        ← domain modules (formalized behind contracts)
├── runtime/         ← NEW: Command Bus · Event Store · Projections ·
│                        Read Models · Workflow Engine · Resource Graph ·
│                        Protocol Inspector
├── services/        ← RETAINED, refactored: service methods become thin
│                        wrappers that dispatch commands (back-compat shim)
├── app/api/         ← RETAINED, thinned: validate → dispatch → return
└── app/.../         ← RETAINED, refactored: read read models, not Prisma
```

### 2.2 The invariant

> **Every state change** = Command → Bus → Handler → Aggregate.transition() →
> Events appended to Event Store → Projections update Read Models.
> **There is no other path.** No service, page, or route writes a domain table
> directly. Prisma tables are write-only-by-projections and
> read-only-by-read-models.

Back-compat is preserved by making existing service methods (e.g.
`paymentService.create()`) dispatch the corresponding command. Existing
callers keep working; new callers (simulator, CLI, agents) dispatch commands
directly.

---

## 3. Layer-by-Layer Design

### Layer 1 — Command Bus

**Purpose.** A single dispatch surface so that *every* entry point — REST,
CLI, simulator, webhook replay, scheduler, AI agent, extension — expresses
intent the same way. The bus validates, authorizes, deduplicates, dispatches,
and records.

**Location.** `src/runtime/command-bus/` — new files:
`types.ts`, `bus.ts`, `registry.ts`, `middleware.ts`, `handlers/*.ts`.

**Relationship to kernel.** Reuses `kernel/command.ts` `Command` type and
`Commands` builders as the canonical command vocabulary. Does **not** modify
the kernel. Extends the type with runtime fields (idempotency key, causation
id, correlation id, environment, actor scope).

**Contract (design sketch).**

```ts
// A command is serializable intent. It never knows HOW.
interface RuntimeCommand {
  id: string;
  type: CommandType;                 // from kernel/command.ts
  actor: { id: string; role: string; orgId?: string };
  environment: 'sandbox' | 'live';
  params: Record<string, unknown>;
  metadata: {
    idempotencyKey?: string;         // dedup across retries
    correlationId: string;           // ties a request's whole trace together
    causationId?: string;            // the event/command that caused this one
    source: 'rest' | 'cli' | 'simulator' | 'webhook-replay'
          | 'scheduler' | 'ai-agent' | 'extension';
    timestamp: number;
  };
}

interface CommandResult {
  commandId: string;
  status: 'accepted' | 'rejected' | 'failed';
  aggregateId?: string;
  events: DomainEvent[];             // the events this command produced
  trace: TraceNode[];                // feeds the Inspector
  error?: { code: string; message: string; retryable: boolean };
}

class CommandBus {
  register(type: CommandType, handler: CommandHandler): void;
  dispatch(cmd: RuntimeCommand): Promise<CommandResult>;
}

interface CommandHandler {
  validate(cmd: RuntimeCommand): ValidationResult;     // schema + invariants
  authorize(cmd: RuntimeCommand): Promise<AuthZResult>; // capability + scope
  handle(cmd: RuntimeCommand, ctx: HandlerContext): Promise<HandlerOutcome>;
}
```

**Middleware pipeline** (runs for every command, in order):
1. **Schema validation** — params match the command's Zod schema.
2. **Idempotency** — if `idempotencyKey` was seen, return the cached result.
3. **Authorization** — actor has the Capability (kernel primitive) for this
   command type, scoped to the right org/merchant/environment.
4. **Environment gate** — sandbox commands never touch live aggregates and
   vice versa (enforced at the Event Store stream-prefix level).
5. **Dispatch** — invoke the handler.
6. **Recording** — persist the command + outcome to the command log (part of
   the Event Store) so the full causal chain is reconstructable.

**Why it matters.** With a command bus, the simulator issues
`CreatePaymentCommand` exactly like REST does. Webhook replay re-dispatches
the original command. An AI agent issues `MoveReserveCommand` with
`source: 'ai-agent'`. The Protocol Inspector sees one uniform trace shape
regardless of origin.

---

### Layer 2 — Event Store

**Purpose.** Events become the **source of truth**, not a side-effect. The
store is append-only, globally ordered, per-stream versioned (optimistic
concurrency), snapshotable, and replayable. This unlocks Time Machine, audit,
debugging, and simulation-for-free.

**Location.** `src/runtime/event-store/` — new files:
`types.ts`, `store.ts`, `snapshots.ts`, `replay.ts`, `reconciliation.ts`.

**Relationship to existing code.** Replaces the in-memory
`services/event-bus.ts` as the authoritative record. The existing `EventBus`
becomes an **in-process publisher** that the store calls after a successful
append (so existing projection subscriptions keep working during migration).
The kernel's `event-sourced-world.ts` and `EventEngine` remain the
simulation in-memory store; the Runtime's Event Store is the persistent twin.

**Contract (design sketch).**

```ts
interface StoredEvent {
  id: string;                        // globally unique
  streamId: string;                  // aggregate id, e.g. "payment_abc"
  streamType: AggregateType;
  version: number;                   // per-stream, monotonic, for OCC
  globalPosition: number;            // global log order
  type: string;                      // e.g. "payment.reserve_locked"
  payload: Record<string, unknown>;
  metadata: {
    commandId: string;               // causation
    correlationId: string;
    actor: string;
    environment: 'sandbox' | 'live';
    timestamp: number;
  };
}

interface EventStore {
  append(streamId: string, events: UncommittedEvent[],
         expectedVersion: number): Promise<AppendResult>;
  readStream(streamId: string, fromVersion?: number): Promise<StoredEvent[]>;
  readAll(fromPosition: number, limit: number): Promise<StoredEvent[]>;
  snapshot(streamId: string): Promise<Snapshot | null>;
  loadAggregate<T>(streamId: string, snapshot?: Snapshot): Promise<{state: T; version: number}>;
}
```

**Persistence.** A single Prisma model `EventRecord` (append-only, never
updated/deleted) plus `EventSnapshot` for periodic compaction. The store uses
`expectedVersion` for optimistic concurrency — if two commands try to mutate
the same aggregate concurrently, the loser retries or fails cleanly.

**Projections are fed from the store, not the bus.** A projection runner
reads `readAll(fromPosition)` in order and applies events to read models.
This makes projections **rebuildable**: wipe a read model, replay its events,
it returns identically. This is what makes Time Machine and the Inspector
possible.

**Reconciliation.** `reconciliation.ts` continuously verifies the two
economic invariants (Section 5):
- Trial balance: sum of all ledger projection debits = sum of credits, per
  currency, per environment, at every global position.
- Twin supply: minted − burned = outstanding twin tokens = backed fiat
  reserves, at every global position.

If either ever breaks, the store halts new appends for that environment and
fires a critical alert. This is the financial equivalent of ACID.

---

### Layer 3 — Read Models

**Purpose.** Pages and API routes **never query raw Prisma tables**. They
query read models — projection-derived views optimized for reading. This
decouples the write model (events + aggregates) from the read model (what the
UI needs).

**Location.** `src/runtime/read-models/` — new files, one per view:
`payment-view.ts`, `customer-view.ts`, `ledger-view.ts`, `treasury-view.ts`,
`activity-view.ts`, `webhook-view.ts`, `analytics-view.ts`,
`resource-graph-view.ts`, `state-timeline-view.ts`.

**Relationship to existing code.** Today's Prisma tables (`Payment`,
`CustomerRecord`, `AuditLog`, `WebhookDelivery`, etc.) **become** the
physical backing of read models. Projections own them. A `paymentView.list()`
replaces `db.payment.findMany()` in pages. During migration, pages are
swapped table-by-table from direct Prisma calls to read-model calls.

**Contract (design sketch).**

```ts
// A read model is a query façade over projection-maintained tables.
interface PaymentReadModel {
  get(id: string): Promise<PaymentView | null>;
  list(filter: PaymentFilter): Promise<PaymentView[]>;
  timeline(id: string): Promise<TimelineEntry[]>;   // for the Inspector
  graph(id: string): Promise<ResourceGraphNode[]>;  // for the Inspector
}

// A projection rebuilds the view from events.
interface Projection {
  name: string;
  handles: string[];                  // event type prefixes
  apply(event: StoredEvent): Promise<void>;
  rebuild(fromPosition: number): Promise<void>;  // wipe + replay
  checkpoint(): Promise<number>;      // last processed position
}
```

**Read model catalog (initial set):**

| Read model | Backing table(s) | Built by projection | Read by |
|---|---|---|---|
| `PaymentView` | `Payment` | `PaymentProjection` | merchant payments, payouts, refunds pages |
| `CustomerView` | `CustomerRecord` | `CustomerProjection` | merchant CRM |
| `LedgerView` | `LedgerEntryRecord` | `LedgerProjection` | treasury, reports |
| `TreasuryView` | `Reserve`, `Corridor` | `TreasuryProjection` | treasury dashboard |
| `ActivityView` | `AuditLog` | `ActivityProjection` | activity feed, audit |
| `WebhookView` | `WebhookDelivery` | `WebhookProjection` | developer webhooks |
| `AnalyticsView` | derived | `AnalyticsProjection` | analytics, reports |
| `ResourceGraphView` | new `ResourceEdge` table | `ResourceGraphProjection` | Inspector |
| `StateTimelineView` | new `StateTransition` table | `StateTimelineProjection` | Inspector |

**The rule, enforced by lint + review:** no `db.<DomainTable>.` call outside
`src/runtime/projections/` and `src/runtime/read-models/`. Pages import from
`read-models/` only.

---

### Layer 4 — Protocol State Machine

**Purpose.** Every resource is a **state machine**, not a row with a status
column. Transitions are validated against declared edges, logged, and
emitted as events. This makes the lifecycle of every payment, refund, LP,
reserve, and escrow explicit and inspectable.

**Location.** `src/runtime/domain/` — new files, one aggregate per resource:
`payment.ts`, `refund.ts`, `payout.ts`, `lp.ts`, `reserve.ts`,
`treasury.ts`, `escrow.ts`, `webhook.ts`.

**Relationship to kernel.** Reuses the kernel's `STATE_MACHINES` definitions
(`state-machine.ts`) as the **single source of allowed edges**. Does not
modify the kernel. The kernel's in-memory `StateMachineEngine` stays for
simulation; the Runtime's aggregates enforce the same edges persistently
against the Event Store.

**The payment lifecycle (canonical),** each arrow an emitted event:

```
created → validated → fraud_checked → reserve_locked → lp_selected →
escrow_created → settlement_pending → settled → webhook_delivered → completed
                 ↘ failed (any step) → rolled_back → archived
```

**Contract (design sketch).**

```ts
// An aggregate is loaded from the Event Store by replaying its events.
class PaymentAggregate {
  readonly id: string;
  state: PaymentState;
  amount: number; currency: string; merchantId: string;
  lpId?: string; reserveAllocationId?: string; settlementId?: string;
  // ... derived from events

  // Each method validates the transition against STATE_MACHINES.payment,
  // then returns uncommitted events. It NEVER writes to Prisma.
  validate(ctx): Event[];          // created → validated
  fraudCheck(ctx): Event[];        // validated → fraud_checked
  lockReserve(ctx): Event[];       // fraud_checked → reserve_locked
  selectLP(ctx): Event[];          // reserve_locked → lp_selected
  createEscrow(ctx): Event[];      // lp_selected → escrow_created
  settle(ctx): Event[];            // escrow_created → settled (via pending)
  markWebhookDelivered(ctx): Event[];
  complete(ctx): Event[];
  fail(ctx, reason): Event[];      // any → failed
  rollback(ctx): Event[];          // failed → rolled_back
  archive(ctx): Event[];           // → archived
}
```

**Why this is the biggest missing piece.** Today a payment jumps from
`created` to `COMPLETED` in one Prisma write. There is no record that fraud
was checked, that a reserve was locked, that an LP was selected, that escrow
existed. With the state machine, **every step is an event in the store**, so
the Inspector can show the full path, the simulator can reproduce it, and a
rollback can unwind it step by step.

**Compensation.** Because every transition has a recorded event, a failed
step emits `*.failed` and the workflow engine (Layer 6) drives a declared
rollback sequence — not an ad-hoc `try/catch`.

---

### Layer 5 — Resource Graph

**Purpose.** Every object knows its parents, children, dependencies, derived
objects, and reverse references. The graph is what makes the Inspector show
"this payment → its settlement → its reserve allocation → the LP → the
treasury journal → the accounting entries → the webhook → the analytics →
the customer LTV" in one expandable tree.

**Location.** `src/runtime/resource-graph/` — new files:
`types.ts`, `builder.ts`, `projection.ts`, `query.ts`.

**Relationship to kernel.** The kernel's `financial-graph.ts` is the
**liquidity graph** (nodes = wallets/reserves/LPs, edges = weighted
financial relationships) used by the optimizer. The Runtime's resource graph
is the **object graph** (nodes = domain aggregates, edges = causal/structural
relationships) used by the Inspector and by referential-integrity checks.
They are different graphs for different purposes; both exist.

**Contract (design sketch).**

```ts
interface ResourceNode {
  id: string;
  type: 'payment' | 'refund' | 'payout' | 'settlement' | 'reserve_allocation'
      | 'lp_position' | 'treasury_journal' | 'ledger_entry' | 'webhook'
      | 'analytics_event' | 'customer' | 'merchant' | 'escrow';
  label: string;
  status: string;
}

interface ResourceEdge {
  from: string; to: string;
  kind: 'parent' | 'child' | 'dependency' | 'derived' | 'reverse_ref';
  weight?: number;                  // for financial edges
  label: string;                    // e.g. "settled via"
}

// Built incrementally by the ResourceGraphProjection as events arrive.
// Queried by the Inspector: graph(paymentId) → full tree.
interface ResourceGraphQuery {
  ancestors(id: string, depth?: number): ResourceNode[];
  descendants(id: string, depth?: number): ResourceNode[];
  neighbors(id: string): ResourceNode[];
  path(from: string, to: string): ResourceNode[];
  subtree(id: string): { nodes: ResourceNode[]; edges: ResourceEdge[] };
}
```

**How edges are derived.** Each projection emits graph edges as a side
effect of applying events. Example: when `payment.settled` is applied, the
projection adds edges `payment → settlement`, `settlement → reserve_allocation`,
`reserve_allocation → lp_position`, `settlement → ledger_entry`,
`payment → webhook`. The graph is therefore **always consistent with the
event log** — wipe and replay rebuilds it exactly.

---

### Layer 6 — Workflow Engine

**Purpose.** Multi-step operations become **declared, inspectable workflows**
with steps, transitions, compensation, retries, and timeouts. A refund is no
longer `refundService.create()`; it is a workflow:

```
Validate → Freeze Reserve → Notify LP → Post Ledger → Settle →
Fire Webhook → Update Analytics → Done
```

each step a row in a timeline, each failure a compensation.

**Location.** `src/runtime/workflow/` — new files:
`types.ts`, `engine.ts`, `definitions/*.ts`, `executor.ts`, `compensation.ts`.

**Relationship to kernel.** The kernel's `workflow.ts` (manual settlement +
insurance claim templates) is the **template source**. The Runtime engine
instantiates those templates as persistent, resumable workflows. Does not
modify the kernel.

**Contract (design sketch).**

```ts
interface WorkflowDef {
  name: string;                      // e.g. "refund"
  trigger: CommandType;              // the command that starts it
  steps: WorkflowStep[];
  compensation: CompensationStep[];  // per-step undo
  timeout: number;                   // overall
  retry: { max: number; backoff: 'exp' | 'linear' };
}

interface WorkflowStep {
  id: string;
  name: string;
  action: (ctx) => Promise<StepResult>;   // issues sub-commands
  onSuccess?: (ctx) => Event[];
  onFailure?: (ctx) => Event[];
  timeout?: number;
  retries?: number;
}

interface WorkflowInstance {
  id: string; defName: string;
  status: 'pending'|'running'|'paused'|'completed'|'failed'|'compensating';
  currentStep: string;
  history: WorkflowStepRecord[];     // every attempt, every result
  startedAt: number; finishedAt?: number;
}
```

**How it works.**
- The command bus dispatches `RefundPaymentCommand`.
- The handler starts a `refund` workflow instance (persisted).
- The executor runs step 1, records the outcome, advances, runs step 2, …
- Each step issues its **own** sub-command (`FreezeReserveCommand`,
  `PostLedgerCommand`, …) through the bus — so steps appear in the Inspector
  as nested trace nodes under the workflow.
- If a step fails and exhausts retries, the engine runs the **compensation**
  chain in reverse (unfreeze reserve, reverse ledger) and marks the workflow
  `failed`.
- Timeouts pause the workflow and emit `workflow.timed_out`.

**Why this matters.** The Inspector now shows a refund as a 7-step timeline
with per-step status, duration, and sub-traces. The simulator can drive the
same workflow with injected failures. Replay can resume a workflow from any
step. This is "every workflow inspectable."

---

### Layer 7 — Connector Runtime

**Purpose.** Every external system (Stripe, MTN, Hubtel, Flutterwave, banks,
Stellar) behaves as a **uniform driver** with the same contract. The
Treasury/Liquidity engines and the workflow steps call drivers, not
adapter-specific code.

**Location.** `src/runtime/connectors/` — new files:
`driver.ts` (contract), `registry.ts`, `drivers/*.ts`. Wraps the existing
`src/protocol/connectors-v2/*` adapters (which already have audit/retry/
health/idempotency) behind the uniform contract.

**Relationship to existing code.** `protocol/connectors-v2/*` already
implements the hard parts (rate limiting, idempotency, retry, audit,
evidence). The Runtime's `drivers/` are thin **contract adapters** that map
the uniform `authorize/capture/refund/webhook/health/capabilities` surface
onto the v2 adapters. No v2 file is rewritten; it is wrapped.

**Contract (design sketch).**

```ts
interface ConnectorDriver {
  readonly id: string;
  readonly kind: 'card'|'mobile_money'|'bank'|'stablecoin'|'blockchain';

  authorize(req: AuthorizeRequest): Promise<AuthorizeResult>;
  capture(req: CaptureRequest): Promise<CaptureResult>;
  refund(req: RefundRequest): Promise<RefundResult>;
  webhook(raw: WebhookPayload): Promise<WebhookEvent>;
  health(): Promise<HealthStatus>;
  capabilities(): Capabilities;     // supported currencies, max amount, routes
}

interface Capabilities {
  currencies: string[];
  routes: ('domestic'|'cross_border')[];
  maxAmount: number; minAmount: number;
  supportsAuthorize: boolean; supportsCapture: boolean;
  supportsRefund: boolean; supportsWebhooks: boolean;
}
```

**Why uniform.** A workflow step "capture funds" calls
`driver.capture()` regardless of whether the underlying connector is MTN or
Stripe. The Treasury optimizer asks `driver.capabilities()` to know what's
possible. The Inspector shows "Connector: MTN M-Pesa · authorize → capture"
uniformly. Adding a new connector = implementing the driver contract;
nothing else changes.

---

### Layer 8 — Treasury Engine

**Purpose.** The treasury becomes an **optimizer**, not a dashboard. Every
payment asks it: *How should reserves move? Which corridor? Which LP? Which
liquidity pool? What FX path? What collateral?* It returns a **declared,
explainable plan** that the workflow executes.

**Location.** `src/runtime/engines/treasury-optimizer.ts` — new. Wraps
`protocol/treasury-v2/*` + `kernel/treasury-ai.ts` + `kernel/optimization-engine.ts`
behind a production callable.

**Relationship to existing code.** The kernel's `OptimizationEngine` already
generates 5 candidate world transitions and scores them across 8 explainable
objectives; `treasury-ai.ts` already emits continuous recommendations. The
Runtime's optimizer **calls these** with the live world state (rebuilt from
the Event Store) and returns the chosen plan as a sequence of commands. The
kernel computes; the Runtime dispatches.

**Contract (design sketch).**

```ts
interface TreasuryOptimizer {
  // Called by the payment workflow at the "reserve_locked" step.
  plan(req: TreasuryPlanRequest): Promise<TreasuryPlan>;
}

interface TreasuryPlan {
  corridors: CorridorMove[];         // ordered reserve movements
  lpAllocations: LPAllocation[];     // which LP funds which leg
  fxPath: FXHop[];                   // currency conversion hops
  collateral: CollateralPlan;        // what backs the movement
  rationale: ObjectiveScore[];       // 8-dimensional explainability
  alternatives: TreasuryPlan[];      // rejected plans + reasons
  costBps: number; riskScore: number; etaMs: number;
}
```

**Explainability.** Every plan carries its `rationale` (the 8 objective
scores) and `alternatives` (the rejected plans with reasons). The Inspector
renders this so an operator sees *why* reserves moved through corridor X
instead of Y. This is the "transparent routing" differentiator.

---

### Layer 9 — Liquidity Engine

**Purpose.** LPs stop being passive rows. They define **strategies and
constraints** (max corridor exposure, min fee, desired utilization, risk
tolerance). The engine **continuously rebalances** across LPs and
**explains** every decision.

**Location.** `src/runtime/engines/liquidity-optimizer.ts` — new. Wraps
`protocol/liquidity-network/*` + `kernel/lp-lifecycle.ts`.

**Relationship to existing code.** `liquidity-network/` already has scoring,
routing, capacity, pricing, health, forecast. The Runtime optimizer uses
these to produce rebalancing decisions as commands
(`RebalanceLPCommand`, `AdjustCorridorFeeCommand`), dispatched on a schedule
and on demand. The kernel's `lp-lifecycle.ts` enforces stake/withdraw/slash
transitions; the Runtime persists them as aggregate events.

**Contract (design sketch).**

```ts
interface LiquidityEngine {
  // LP defines a strategy; engine enforces it.
  registerStrategy(lpId: string, strategy: LPStrategy): void;

  // Continuous rebalance — runs on a schedule + on capacity events.
  rebalance(): Promise<RebalanceDecision[]>;

  // Explain why a specific LP was (or wasn't) chosen for a payment.
  explainSelection(paymentId: string): LPSelectionExplanation;
}

interface LPStrategy {
  maxCorridorExposure: Record<string, number>;
  minFeeBps: number; maxFeeBps: number;
  desiredUtilization: number;       // 0..1
  riskTolerance: 'low'|'medium'|'high';
  corridors: string[];              // willing to operate in
}

interface RebalanceDecision {
  lpId: string; action: 'shift'|'add'|'withdraw'|'repric';
  amount: number; currency: string;
  reason: string;                   // human-readable explanation
  evidence: ObjectiveScore[];       // why this decision
}
```

**The differentiator.** An LP sets a strategy once. The engine rebalances
their capital across corridors to hit their desired utilization at their
min fee, never exceeding their max exposure, and logs *why* for every move.
This is "programmable liquidity" made real — not a manual console.

---

### Layer 10 — Protocol Inspector

**Purpose.** Stripe's request inspector × Chrome DevTools. Every payment (and
refund, payout, treasury move) is a **single expandable trace**:

```
API Request          POST /api/payments/create        14ms
└─ Command           CreatePayment  (idempotency: abc) 1ms
   └─ Validation     schema ✓ · authz ✓ · env ✓        1ms
   └─ Workflow       payment.create                     312ms
      ├─ Validate    created → validated                2ms
      ├─ FraudCheck  validated → fraud_checked          18ms
      ├─ LockReserve fraud_checked → reserve_locked     9ms
      │  └─ TreasuryOptimizer.plan() → 5 candidates
      │     └─ chose: LP-bridge (cost 80bps, risk 0.13)
      ├─ SelectLP    reserve_locked → lp_selected       4ms
      │  └─ LiquidityEngine.explain() → Acacia LP (1.1%, avail)
      ├─ CreateEscrow lp_selected → escrow_created      11ms
      ├─ Settle      escrow_created → settled           240ms
      │  └─ Ledger   DR cash:bank:GHS 25000 / CR …      3ms
      │  └─ Connector MTN · authorize → capture         220ms
      ├─ Webhook     settled → webhook_delivered        6ms
      └─ Complete    webhook_delivered → completed      1ms
   └─ ResourceGraph  14 nodes · 19 edges               [expand]
   └─ Events          11 events emitted                 [expand]
   └─ Reconcile      trial balance ✓ · twin supply ✓
```

**Location.** `src/runtime/inspector/` — new files:
`trace.ts` (builds the trace), `api.ts` (serves it), plus UI under
`src/app/(merchant)/dashboard/payments/[id]/inspector/` (and equivalents).

**How the trace is built.** Every command, every handler step, every
workflow step, every sub-command, every aggregate transition, every event,
every connector call, and every projection writes a `TraceNode` to the
`StateTimelineView` read model (correlated by `correlationId`). The Inspector
query is a single read-model call: `inspector.trace(paymentId)` → tree.

**Contract (design sketch).**

```ts
interface TraceNode {
  id: string; parentId?: string;
  kind: 'request'|'command'|'validation'|'workflow'|'step'|'transition'
      |'event'|'connector'|'ledger'|'reconcile'|'graph';
  label: string;
  status: 'ok'|'warn'|'error'|'pending';
  startedAt: number; durationMs: number;
  detail: Record<string, unknown>;   // type-specific payload
  children: TraceNode[];
}

interface InspectorAPI {
  trace(aggregateId: string): Promise<TraceNode>;      // full tree
  timeline(aggregateId: string): Promise<TimelineEntry[]>;
  graph(aggregateId: string): Promise<{nodes; edges}>;
  replay(aggregateId: string, fromVersion: number): Promise<TraceNode>;
  // "what if we had failed at step X?" — re-run with injected failure
  simulate(aggregateId: string, inject: FailureInjection): Promise<TraceNode>;
}
```

**The capstone.** The Inspector is what makes the other nine layers
*visible*. Without it, the architecture is correct but opaque. With it, an
operator clicks a payment and sees the entire causal chain — command,
workflow, treasury reasoning, LP selection, ledger, connector, webhook,
reconciliation — expandable at every node, replayable from any point, and
re-simulatable with injected failures. That is Stripe parity with
PaySwap-exclusive depth.

---

## 4. End-to-End Execution Flow

A single payment, traced through every layer:

1. **REST** `POST /api/payments/create` → route validates auth, builds a
   `CreatePaymentCommand` with `correlationId`, dispatches via `commandBus`.

2. **Command Bus** runs middleware: schema ✓ → idempotency ✓ → authorize
   (actor has `CreatePayment` capability, scoped to merchant+environment) ✓
   → dispatch to `CreatePaymentHandler`.

3. **Handler** loads `PaymentAggregate` from the Event Store (replay or
   snapshot), calls `aggregate.validate()` then drives the `payment.create`
   workflow.

4. **Workflow Engine** runs the declared steps. Each step issues a
   **sub-command** through the bus (so it appears as a nested trace node):
   - `FraudCheckCommand` → `fraudEngine` → `payment.fraud_checked` event.
   - `LockReserveCommand` → **Treasury Optimizer**.plan() returns a
     `TreasuryPlan` (5 candidates, 8 objective scores, chosen + alternatives).
     Reserve aggregate transitions `healthy → low`, emits
     `reserve.locked`.
   - `SelectLPCommand` → **Liquidity Engine**.explain() picks LP, emits
     `lp.selected` with full reasoning.
   - `CreateEscrowCommand` → escrow aggregate `created`.
   - `SettleCommand` → **Connector Driver** (MTN) `.authorize()` →
     `.capture()`; **Ledger** posts DR/CR; payment `settled`.
   - `DeliverWebhookCommand` → webhook projection queues delivery.
   - `CompleteCommand` → payment `completed`.

5. **Each transition** appends events to the Event Store (optimistic
   concurrency on the aggregate's stream version) and writes a `TraceNode`.

6. **Event Store** publishes appended events to projections **in the same
   transaction**.

7. **Projections** update read models: `PaymentView` (status, timeline),
   `LedgerView` (journal), `TreasuryView` (reserve levels), `ActivityView`
   (feed), `WebhookView` (queue), `AnalyticsView` (metrics),
   `ResourceGraphView` (edges), `StateTimelineView` (trace nodes).

8. **Reconciliation** runs after the stream commit: trial balance ✓, twin
   supply ✓. Result appended as a `reconcile` trace node.

9. **Inspector** query `inspector.trace(paymentId)` returns the full tree
   from `StateTimelineView` — the UI renders it expandable.

10. **Simulator parity:** the Digital Twin dispatches the *same*
    `CreatePaymentCommand` with `source: 'simulator'` and an injected
    `FailureInjection`. The identical pipeline runs; the only difference is
    the environment prefix and the failure injection point. The resulting
    trace is structurally identical to a production trace — so a twin run is
    a faithful reproduction.

---

## 5. Economic-Integrity Invariants

Two non-overridable invariants, checked at every Event Store commit by
`reconciliation.ts`. A violation halts new appends for that environment and
fires a critical alert.

### 5.1 Trial Balance
For every currency and environment, at every global position:
```
Σ(debit ledger entries) === Σ(credit ledger entries)
```
The `LedgerProjection` maintains running balances; the reconciler recomputes
from the raw event log on a schedule and on every settlement event. This is
the financial equivalent of ACID — the books must always balance.

### 5.2 Twin Supply Reconciliation
At every global position:
```
Σ(twin tokens minted) − Σ(twin tokens burned) === outstanding twin token supply
                                                              === backed fiat reserves
```
Every `twin.minted` event must have a corresponding fiat-reserve credit;
every `twin.burned` must have a corresponding debit. The reconciler verifies
the token engine's book matches the reserve book. This is what makes the
digital twin's money real — every twin token in circulation is provably
backed.

These two invariants are the **Constitution** (kernel/constitution.ts, 10
checks) made *enforceable in production at the store level*, not just
evaluated in simulation.

---

## 6. Sandbox / Live Isolation

Carried forward and hardened:
- Every `RuntimeCommand`, `StoredEvent`, and read-model row carries an
  `environment` field.
- Event Store stream IDs are prefixed: `live:payment_abc` vs
  `sandbox:payment_abc`. The bus refuses cross-environment commands.
- Projections filter by environment; a sandbox event never updates a live
  read model and vice versa.
- The cookie-based environment switcher (existing) reloads the page; read
  models are queried with the active environment, so the UI never mixes
  data.

---

## 7. Migration Strategy

A full event-sourced rewrite of 77 pages and 97 routes at once is
infeasible. The migration uses the **strangler fig** pattern: introduce the
Runtime alongside the existing services, route new writes through it, and
migrate reads page-by-page. At no point is the app broken.

### Phase A — Foundation (non-disruptive)
1. Add `src/runtime/` with the Command Bus, Event Store, and projection
   runner. The Event Store writes to a new `EventRecord` table; existing
   tables are untouched.
2. Make existing service methods (`paymentService.create()` etc.) **dispatch
   the corresponding command** as a back-compat shim. Existing callers keep
   working; the command flows through the bus, the handler calls the
   existing service logic, events are appended to the store *and* published
   to the old in-memory bus (so existing projections keep firing).
3. Existing Prisma tables become **dual-write**: the service writes the row
   (as today) *and* the event is appended. Read models are not yet queried
   by pages.

**Result:** the Event Store begins filling with real events; nothing breaks.

### Phase B — Projections own the tables
4. Move projection logic from `services/projections/*` into
   `runtime/projections/*`, fed from the Event Store (not the in-memory bus).
   The projections now **write** the existing tables (`Payment`,
   `AuditLog`, …) from events.
5. Service methods stop writing tables directly — they only append events.
   The projection fills the table. (Dual-write removed; events are the
   source of truth.)

**Result:** tables are now projection-maintained; the in-memory bus is
retired.

### Phase C — Read models
6. Introduce read-model query façades. Migrate pages from `db.payment.findMany()`
   to `paymentView.list()`, one page at a time. Each migration is a small,
   reviewable PR.

**Result:** pages read read models; raw Prisma access is gone from pages.

### Phase D — Aggregates + state machines
7. Replace the service-logic-that-appends-events with proper aggregates:
   `PaymentAggregate.validate()` etc., enforcing `STATE_MACHINES` edges and
   emitting the full event sequence (validate → fraud_check → lock_reserve →
   …). The payment lifecycle becomes real.

**Result:** every payment transitions through declared states; the Inspector
has a real timeline.

### Phase E — Workflows + engines + Inspector
8. Introduce the Workflow Engine; refactor refund/payout/manual-settlement
   into declared workflows.
9. Wire the Treasury Optimizer and Liquidity Engine into the payment
   workflow's `LockReserve` and `SelectLP` steps.
10. Build the Protocol Inspector UI on the `StateTimelineView` read model.

**Result:** all ten layers live; the simulator drives the same pipeline.

### Phase F — Simulator unification
11. Refactor the world simulator to dispatch commands (`source:
    'simulator'`) through the same bus instead of calling services directly.
    The kernel's `OptimizationEngine`/`PlanExecutor` are invoked by the
    Treasury/Liquidity engines during real workflows, so sim and prod share
    the brain.

**Result:** simulator = production. A twin run is a faithful reproduction.

---

## 8. Implementation Roadmap

Each milestone improves the **protocol architecture**, per the governing
rule. No milestone adds raw CRUD or business logic to pages.

| Milestone | Layer(s) | Deliverable | Exit criteria |
|---|---|---|---|
| **M-RT-1** Runtime Foundation | 1, 2 | Command Bus + Event Store + projection runner. Service methods dispatch commands as back-compat shim. `EventRecord` table. | A real payment produces a command + events in the store; existing UI unchanged. |
| **M-RT-2** Projections Own Tables | 2, 3 | Projections fed from the store write existing tables. Services append events only. In-memory bus retired. | Wipe a table, replay events, table restores identically. |
| **M-RT-3** Read Models | 3 | Read-model façades; merchant payments/customers/payouts/refunds pages migrated off direct Prisma. | Lint rule forbids `db.<DomainTable>` outside runtime. |
| **M-RT-4** Aggregates & State Machines | 4 | `PaymentAggregate`, `RefundAggregate`, `PayoutAggregate` enforcing `STATE_MACHINES`. Full payment lifecycle events. | A payment's event stream shows all 10 lifecycle states. |
| **M-RT-5** Resource Graph | 5 | `ResourceGraphProjection` + `ResourceGraphView`. Inspector shows object tree. | `inspector.graph(paymentId)` returns 14+ nodes. |
| **M-RT-6** Workflow Engine | 6 | Refund + payout + manual-settlement as declared workflows with compensation. | A failed refund unwinds via compensation, visible in trace. |
| **M-RT-7** Connector Runtime | 7 | Uniform `ConnectorDriver` contract wrapping v2 adapters. | Adding a connector = implementing the driver; no other change. |
| **M-RT-8** Treasury Optimizer | 8 | Payment workflow calls `TreasuryOptimizer.plan()` at `LockReserve`; plan + rationale in trace. | Inspector shows 5 candidates + chosen + alternatives. |
| **M-RT-9** Liquidity Engine | 9 | LP strategies + continuous rebalance + `explainSelection()`. | LP sets strategy; engine rebalances and logs reasons. |
| **M-RT-10** Protocol Inspector | 10 | Full Inspector UI on `StateTimelineView`. Expandable trace, replay, simulate-with-injection. | Operator clicks a payment → sees the full causal tree. |
| **M-RT-11** Simulator Unification | all | World simulator dispatches commands through the bus. | A twin run's trace is structurally identical to a production trace. |
| **M-RT-12** Economic Integrity Hardening | 2, 5 | Continuous reconciliation (trial balance + twin supply) at every commit; halt-on-violation. | Injected ledger imbalance halts the environment + alerts. |

---

## 9. Production Quality Gates

Every milestone must pass these before it is considered done.

### 9.1 Architecture gates
- No business logic in `src/app/**` pages or `src/app/api/**` routes (lint
  rule + review).
- No `db.<DomainTable>` access outside `src/runtime/projections/` and
  `src/runtime/read-models/` (lint rule).
- Kernel untouched: `git diff --name-only HEAD -- src/kernel/` returns 0.
- Every command type has a registered handler with `validate` + `authorize`.

### 9.2 Functional gates
- Every aggregate transition is validated against `STATE_MACHINES`; invalid
  transitions are rejected (not silently ignored).
- Every workflow step records an outcome (success/failure/compensation) to
  the timeline.
- Every connector driver implements the full contract
  (`authorize/capture/refund/webhook/health/capabilities`).

### 9.3 Integration gates
- The simulator dispatches the same commands as REST (verified by trace
  shape equality).
- Webhook replay re-dispatches the original command and produces an
  identical event sequence.
- Sandbox and live events are strictly isolated (cross-env command rejected).

### 9.4 Simulator gates
- A production payment's trace and the twin's trace of the same payment are
  structurally equal (same node kinds, same order).
- Injected failures produce declared compensation, not silent catches.
- Replay from any aggregate version reproduces the same state.

### 9.5 UX gates
- The Protocol Inspector renders for every payment/refund/payout/treasury
  move.
- Read-model queries return within the existing p95 (no regression).
- Sticky footer, responsive layout, loading skeletons preserved (M10 polish
  carries forward).

### 9.6 Performance gates
- Command dispatch p99 < 50ms (excluding connector/chain I/O).
- Event Store append p99 < 20ms.
- Projection catch-up (rebuild) processes ≥ 10k events/sec (snapshot-assisted).
- Reconciliation check p99 < 100ms.

### 9.7 Documentation gates
- Each layer has a README in `src/runtime/<layer>/README.md`.
- The command catalog is auto-generated from the registry.
- The event catalog (kernel `events.ts`) is extended with Runtime-emitted
  types and rendered in the developer docs.

---

## 10. What Does NOT Change

- **The frozen kernel.** Zero modifications to `src/kernel/*`. The Runtime
  imports its types and pure functions; it never edits them.
- **The product surface.** No pages are deleted. Existing URLs keep working.
  The 9 demo accounts, 9 orgs, and all role-based access remain.
- **The differentiators.** Programmable liquidity, LP marketplace, treasury
  intelligence, digital twin, explainable protocol execution — these are
  *realized* by the Runtime, not replaced. The Treasury/Liquidity engines
  make "programmable liquidity" true; the Inspector makes "explainable
  protocol execution" true; the Event Store makes the "digital twin" a
  faithful reproduction.
- **Stripe as benchmark, not limit.** The architecture matches Stripe's
  command/event/projection discipline while keeping capabilities Stripe
  lacks (the optimizer, the twin, the LP marketplace, transparent routing).

---

## 11. The Score This Targets

| Area | Now | Target after M-RT-1..12 |
|---|---|---|
| Product UX | 8.5/10 | 9.5/10 (Inspector + read models) |
| Architecture | 8.5/10 | 10/10 (full command/event/projection) |
| Financial protocol | 8/10 | 10/10 (state machines + reconciliation) |
| Event-driven design | 8.5/10 | 10/10 (event store = source of truth) |
| Simulator integrity | 9/10 | 10/10 (sim = prod pipeline) |
| Production readiness | 7.5/10 | 9.5/10 (compensation, replay, reconciliation) |
| Stripe parity | ~60% | ~90%+ |

The remaining ~10% is external systems (real Stellar mainnet, real bank APIs,
real KYC, regulatory licensing) — explicitly out of scope for application
architecture, as noted in the project summary.

---

*End of Phase 1 (Architecture Design). Phase 2 (Implementation) begins with
Milestone M-RT-1.*
