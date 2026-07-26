# PaySwap Runtime — Architecture (v1.1 Runtime Constitution, Amendment 1)

> **Architecture Frozen — v1.1 Runtime Constitution (Amendment 1).**
> Amendment 1 adds Liquidity Intelligence, Reserve-Aware Economic Routing,
> Opportunity Discovery, the Liquidity Graph, the Liquidity Strategy
> Marketplace, and Economic Digital Twin as first-class subsystems. The
> architecture is frozen again after this amendment. Every future milestone
> either **implements**, **validates**, or **improves performance**. It does
> **not** change the architecture unless a production lesson reveals a
> genuine flaw.
>
> **Status:** Implementation-ready. Phase 2 resumes from M-RT-1 with the
> Amendment 1 concepts incorporated into the skeleton.
> **Supersedes:** v1 (Stripe-mirror) and v2 (programmable-network reframe).
> v3 completed the design with the Intent Engine, the four-runtimes split,
> the Runtime Clock, first-class Scenarios & Behaviors, the autonomous
> Digital Twin, Runtime Memory, and universal explainability.
> **Philosophy (one sentence, amended):** *The Runtime continuously optimizes
> the global financial network while executing financial intents — execution
> and optimization are equally important.*
> **Kernel constraint:** The frozen kernel (`src/kernel/*`) is never
> modified. Everything below is built **above** the kernel primitives.

---

## Architectural Principles

These ten principles are the constitution for every future milestone. A
milestone that violates any principle is rejected on review.

### Principle 1 — Runtime First
No UI, API route, extension, AI agent, CLI, simulator, or mobile app may
implement business logic. Everything enters through the Runtime.

### Principle 2 — Intent Before Execution
No financial operation executes directly. Everything begins as a typed
Intent.

### Principle 3 — Explainability by Default
Every state transition, decision, policy evaluation, optimization, and
settlement must be explainable. If it cannot be explained, it should not
execute.

### Principle 4 — One Runtime
Sandbox and Live are different worlds running the **same runtime**. Only
data, connectors, credentials, and clock differ.

### Principle 5 — Event Truth
Events are immutable. Read models are disposable. The runtime can always
rebuild itself.

### Principle 6 — Deterministic Replay
Given the same events, policies, clock, and runtime version, replay must
produce identical results.

### Principle 7 — Simulation Is Production
The simulator is simply another runtime client. There are no simulator-only
code paths.

### Principle 8 — Economic Safety
Money invariants override feature correctness. If financial integrity and
availability conflict, integrity wins.

### Principle 9 — Everything Is Inspectable
Every object must expose: history, decisions, policies, relationships,
events, execution trace.

### Principle 10 — Runtime Over Features
Whenever a design choice exists between adding another screen or
strengthening the runtime, the runtime wins.

### Principle 11 — Continuous Optimization *(Amendment 1)*
The Runtime continuously optimizes the global financial network while
executing. Execution and optimization are equally important; the Runtime
improves the network it runs on.

---

## Runtime Vocabulary (Frozen)

These terms have fixed meanings. Every document, API, SDK, UI, extension,
and AI agent uses exactly this vocabulary. Terminology never drifts.

| Term | Meaning (frozen) |
|---|---|
| **Intent** | A typed desire to perform a financial operation. The universal input. Never executed directly — normalized, resolved, validated, then handed to the pipeline. |
| **Command** | The internal execution primitive (kernel). A Command is produced from a validated Intent; it expresses *do X*, not *I want Y*. |
| **Decision** | A recorded, explainable artifact produced by every decision-producing stage. Answers Why / Why-not / Alternative / Evidence / Confidence / Policy / Cost / Risk. |
| **Policy** | An explicit, evaluable rule that gates execution (can-settle / can-mint / can-refund / can-release / can-retry). Data, not hardcoded branches. |
| **Workflow** | A declared, multi-step, resumable operation with compensation. Sub-commands flow through the same pipeline. |
| **Execution** | The act of running a validated Intent through the 14-stage pipeline to completion or declared failure. |
| **Settlement** | The movement of value to fulfill an obligation. The product. Every money movement flows through the Settlement Engine. |
| **Reserve** | Fiat collateral backing twin tokens and operations. Locked, released, minted against, burned. Owned by the Reserve Engine. |
| **Liquidity** | LP-provided capital offered in a market. LPs publish strategies; the market clears; the winner executes. |
| **Treasury** | PaySwap's own capital position. Optimized (not just displayed) across corridors, LPs, FX, float, yield, risk. |
| **Projection** | A function that subscribes to Domain Events and writes a read model. The only writer of read-model tables. |
| **Read Model** | A query façade over projection-maintained tables. The only thing interfaces read. Never the Event Store. |
| **Event** | An immutable recorded fact. **Domain Event** = business state (replayed). **Runtime Event** = operational (not replayed). |
| **Behavior** | A named pattern an actor exhibits that produces Intents per tick (MorningRush, SalaryDay, Aggressive, …). Not a random probability. |
| **Scenario** | A first-class versioned object describing a world's initial conditions and evolution rules. A regression test is "run scenario v3; compare to baseline." |
| **Actor** | A participant in a scenario (merchant, customer, LP, connector). Actors own behaviors. |
| **Resource Graph** | The business-object graph (Payment → Refund → Invoice → Customer → Merchant → Subscription → Dispute). |
| **Economic Graph** | The money graph (Reserve → LP → Wallet → Treasury → FX → Settlement → Escrow → TwinToken). |
| **Protocol Trace** | The expandable tree of every stage, decision, event, and connector call for one execution. Powers the Inspector. |
| **Runtime Memory** | The structured store of learned operational facts (corridor congestion, LP reliability, …). Consulted, not obeyed. |
| **Twin** | The autonomous 24/7 sandbox world (SimCity model). A runtime client, not a parallel universe. |
| **Environment** | `sandbox` or `live`. Same runtime, same code; only data, connectors, credentials, and clock differ. |
| **Connector** | A uniform driver implementing authorize / capture / refund / webhook / health / capabilities. MTN, Stripe, banks, Stellar — all the same shape. |
| **Runtime Clock** | The virtual clock. Everything reads `clock.now()`, never `Date.now()`. Live = 1× real time; sandbox = 10×/100×/1000×. |
| **Liquidity Intelligence** *(Amendment 1)* | The continuous engine that analyzes the liquidity network and improves it. Answers why corridors are expensive, which reserves are exhausted, where LPs should deploy capital. |
| **Opportunity Discovery** *(Amendment 1)* | The continuous search for missing corridors, LP opportunities, treasury opportunities, and connector gaps. Produces Recommendations. |
| **Reserve Shadow Price** *(Amendment 1)* | The internal opportunity cost of consuming one more unit of a reserve. An optimization signal, not customer pricing. Routing minimizes (execution cost + shadow price + capital cost + risk cost). |
| **Reserve Market State** *(Amendment 1)* | The continuously-published state of a reserve: available, locked, utilization, forecast depletion, refill rate, capital cost, risk, confidence, shadow price. A runtime input, not a dashboard metric. |
| **Liquidity Graph** *(Amendment 1)* | The third graph. Nodes: LPs, corridors, currencies, twin currencies, reserves, connectors. Edges carry capacity/cost/risk/latency/confidence/profitability/availability. Opportunity Discovery operates on it. |
| **Liquidity Strategy** *(Amendment 1)* | A programmable strategy an LP publishes alongside liquidity ("Maximize yield", "Win market share", "Only operate when reserve utilization < 60%"). Strategies are evaluated during market clearing. |
| **Recommendation** *(Amendment 1)* | A first-class runtime object advising an actor (merchant / LP / treasury / ops / compliance / developer) to act — e.g. "Deploy LP on Twin GHS→XOF, +43% volume". Versioned, explainable, actionable. |

---

## Amendment 1 — Liquidity Intelligence & Reserve-Aware Economic Routing

This amendment recognizes that liquidity is a **market with discoverable
opportunities and reserve-aware routing**, not merely a selection algorithm.
It adds three first-class subsystems and elevates several existing engines.
The architecture is frozen again after this amendment.

| # | Addition | Effect |
|---|---|---|
| 1 | **Liquidity Intelligence Runtime** | A new engine that continuously analyzes the network and improves it (why LPs are underutilized, which corridors are expensive, where capital should deploy). |
| 2 | **Opportunity Discovery** | First-class capability: missing-corridor detection, LP opportunity generation, treasury opportunity generation, connector-gap detection. Produces Recommendations. |
| 3 | **LP Opportunity Engine** | Per-LP business advisory: "also support Twin GHS→Twin XOF, +43% volume, +$84k/mo, $220k capital". |
| 4 | **Treasury Opportunity Engine** | Per-reserve optimization proposals: "increase GHS reserve 250k → +17% throughput", "reduce EUR reserve 150k (82% idle)". |
| 5 | **Reserve-Aware Routing** | Every route includes reserve cost. Routing becomes multi-objective: fee + latency + reserve utilization + shadow price + capital cost + risk. |
| 6 | **Reserve Shadow Price** | New primitive: the internal opportunity cost of consuming one more unit of a reserve. An optimization signal, not customer pricing. |
| 7 | **Reserve Market State** | Every reserve continuously publishes available/locked/utilization/forecast-depletion/refill/capital-cost/risk/confidence/shadow-price as runtime inputs. |
| 8 | **LP Pricing Curves** | LPs publish pricing *strategies* (utilization-tiered fees), not fixed fees. The market clears dynamically. |
| 9 | **Liquidity Graph** | Third graph (alongside Resource + Economic). Opportunity Discovery operates on it. |
| 10 | **Economic Digital Twin** | The Twin simulates what-if (reserve exhaustion, LP exits, treasury injections, FX shocks, seasonality) — not just what-happened. |
| 11 | **Liquidity Memory** | Runtime Memory gains liquidity-specific facts (LP congestion windows, reserve depletion cycles, connector recovery times) used as Evidence. |
| 12 | **Runtime Recommendations** | First-class objects advising every actor role. Versioned, explainable, actionable. |
| 13 | **Decision Engine expansion** | Every routing decision optimizes 9 dimensions (fee/latency/reserve-util/shadow-price/LP-util/profitability/resilience/compliance/CX) with full tradeoff exposure. |
| 14 | **Inspector expansion** | Payment inspection adds: liquidity market, reserve market, shadow prices, LP bids, rejected routes, treasury decisions, capital consumed, expected profitability, missed opportunities. |
| 15 | **Philosophy amendment** | The Runtime continuously optimizes the global financial network *while* executing financial intents. Execution and optimization are equally important. |
| 16 | **Liquidity Strategy Marketplace** | LPs publish programmable *strategies* ("Maximize yield", "Avoid payroll days", "Only > $1000"). The Runtime evaluates them during clearing. LPs become programmable participants — a capability Stripe/Paystack/Flutterwave/DEXs do not expose. |

---

## Implementation Order (revised)

Per the final review, the implementation order prioritizes **one perfect
vertical slice** over partial migration of everything.

| Milestone | Goal | Exit criteria |
|---|---|---|
| **M-RT-1** Runtime Skeleton | Runtime container, Intent Engine, Runtime Clock, Pipeline scaffold, Event/Decision/Policy interfaces, **plus Amendment 1 interfaces** (Liquidity Intelligence, Opportunity Discovery, Reserve Market/Shadow Price, Liquidity Graph, Liquidity Strategy Marketplace, Recommendations). **No business logic.** | Skeleton compiles, imports, dispatches a no-op intent through all 14 stages, appends a no-op event. Amendment 1 interfaces importable. Existing app untouched. |
| **M-RT-2** One Vertical Slice (Payments) | Payment Intent → pipeline → Settlement → Reserve (with Market State + Shadow Price) → Liquidity Market (with Pricing Curves + Strategy evaluation) → Ledger → Events → Projections → Inspector (with liquidity market / reserve market / shadow prices / LP bids / rejected routes / missed opportunities). End-to-end. | A real payment in the UI is inspectable end-to-end including reserve-aware routing and the LP selection rationale. Replayable in sandbox. |
| **M-RT-3** Simulator Integration | Simulator's payment generation replaced with Payment Intents through the runtime. | A twin payment trace is structurally identical to a live payment trace. Architecture proven. |
| **M-RT-4** Reserve-Aware Routing | Routes scored on 9 dimensions (fee/latency/reserve-util/shadow-price/LP-util/profitability/resilience/compliance/CX). Reserve Shadow Price and Reserve Market State drive routing. | A routing Decision exposes every tradeoff; Route B (higher fee, lower reserve cost) can beat Route A. |
| **M-RT-5** Liquidity Intelligence + Opportunity Discovery | Liquidity Intelligence Engine analyzes the network; Opportunity Discovery produces Recommendations (missing corridors, LP opportunities, treasury opportunities). | "Building Twin GHS→Twin XOF eliminates one hop" is a Recommendation with estimated cost/speed/volume deltas. |
| **M-RT-6** Liquidity Strategy Marketplace | LPs publish programmable strategies; the Runtime evaluates them during clearing. | An LP with "only > $1000" strategy is correctly excluded from sub-$1000 clears; the Decision explains why. |
| **M-RT-7** Economic Digital Twin | Twin simulates what-if (reserve exhaustion, LP exits, treasury injections, FX shocks, seasonality). | "What happens if LP A exits?" produces a forecast, not just a replay. |
| **M-RT-8+** Capability Migration | Migrate one capability at a time: refunds → payouts → invoices → subscriptions → wallets → treasury → LPs. | Each capability runs on the same execution model. No new architecture invented. |

**The measure of success:** after a few milestones, you can point to a
payment in the UI and inspect the original intent, every policy evaluated,
why a particular LP was chosen, how reserves were allocated, the settlement
path, every emitted event, every projection update, and replay the entire
execution deterministically in the sandbox.

---

## Changes from v2 (the final additions)

| # | v2 | v3 |
|---|---|---|
| Name | "Protocol Runtime" | **"PaySwap Runtime"** — the product; everything else is an interface |
| Philosophy | "Every operation follows the execution pipeline" | **"Every financial intent becomes an explainable execution"** |
| Entry | Pipeline starts at Intent (a typed request) | **Intent Engine** separates Intent from Command: MerchantIntent → normalize → resolve → validate → typed Intent → pipeline |
| Intent scope | Payment only | **8 intent types**: Payment, Refund, Transfer, Settlement, Mint, Reserve, Liquidity, Treasury — universal abstraction |
| Clients | Call services | **Emit Intents** (Dashboard, Admin, Twin, SDK, CLI, Extensions, AI Agents, Mobile) |
| Runtime shape | One runtime | **Four runtimes**: Execution, Economic, Operational, Simulation — sharing Event Store + Read Models + Decision + Policy |
| Time | `Date.now()` everywhere | **Runtime Clock** — virtual time; sandbox runs 10×/100×/1000×; Time Machine/forecast/replay free |
| Scenarios | Buttons (Holiday/Outage/Growth) | **First-class versioned objects** (actors, rules, timelines, weather, economy, traffic, connector failures) |
| Actor modeling | Random probabilities | **Behaviors** (Merchant: Morning Rush/Lunch/Weekend/Holiday/Promotion/Stockout; Customer: Impulse/Salary/Vacation/Fraud/Dormant/Loyal; LP: Aggressive/Conservative/Crisis/Expansion/Maintenance) — behaviors produce intents |
| Digital Twin | Run-once simulation | **Autonomous 24/7 world** (SimCity model) — merchants grow, customers churn, LPs earn, connectors fail, treasury reallocates; rewind/fast-forward |
| Explainability | Decision Engine only | **Everywhere** — every node answers Why/Why-not/Alternative/Evidence/Confidence/Policy/Cost/Risk |
| Memory | Analytics only | **Runtime Memory** — learned operational knowledge (corridor congestion patterns, LP reliability, seasonal demand) |

---

## 0. The Philosophy (amended)

> **The Runtime continuously optimizes the global financial network while
> executing financial intents — execution and optimization are equally
> important.**

The Runtime no longer exists merely to execute financial intents. It exists
to **continuously improve the liquidity network itself** while executing.
Execution and optimization are dual responsibilities. This amended philosophy
implies six non-negotiable properties:

1. **Intent-first.** Nothing mutates state without first being expressed as a
   typed Intent. The runtime never accepts "do X" — it accepts "I intend X,
   for these reasons, under these constraints."
2. **Universal.** The same Intent abstraction covers payments, refunds,
   transfers, settlements, mints, reserve moves, liquidity actions, and
   treasury operations. One shape in; one shape out.
3. **Explainable.** Every stage of execution answers
   *Why? Why not? Alternative? Evidence? Confidence? Policy? Cost? Risk?* —
   not just the "important" decisions. Explainability is the default, not an
   add-on.
4. **Executable.** An Intent is not a wish; it drives the 14-stage pipeline
   to completion (or declared failure with compensation).
5. **Reproducible.** Because an Intent is typed and recorded, replaying it
   reproduces the execution. The simulator emits the same Intents as
   production. The Time Machine rewinds and fast-forwards them.
6. **Self-improving.** *(Amendment 1)* The Runtime continuously analyzes the
   network (Liquidity Intelligence), discovers opportunities (Opportunity
   Discovery), and produces Recommendations that make the next execution
   cheaper, faster, and more resilient than the last. Execution feeds
   optimization; optimization improves execution.

---

## 1. The Product: PaySwap Runtime

The Runtime **is** the product. Everything else is an interface to it.

```
┌──────────────────────────────────────────────────────────────────┐
│  INTERFACES (all are peers; all emit Intents)                    │
│  Merchant Dashboard · Admin Console · Digital Twin ·             │
│  Developer SDK · CLI · Extensions · AI Agents · Mobile Apps ·    │
│  Public API                                                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │  Intent
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  PAYSWAP RUNTIME                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────┐│
│  │ Execution    │  │ Economic     │  │ Operational  │  │Simulat-││
│  │ Runtime      │  │ Runtime      │  │ Runtime      │  │ion     ││
│  │              │  │              │  │              │  │Runtime ││
│  │ payments     │  │ LP market    │  │ notifications│  │ sandbox││
│  │ refunds      │  │  + strategies│  │ webhooks     │  │ twin   ││
│  │ settlements  │  │ reserves     │  │ analytics    │  │ forecst││
│  │ routing      │  │  + shadow px │  │ audit        │  │ time-m ││
│  │  (reserve-   │  │ treasury     │  │ search       │  │ what-if││
│  │   aware)     │  │ capital/yield│  │ incidents    │  │ (econ) ││
│  │              │  │ LIQUIDITY    │  │              │  │        ││
│  │              │  │ INTELLIGENCE │  │              │  │        ││
│  │              │  │ OPPORTUNITY  │  │              │  │        ││
│  │              │  │  DISCOVERY   │  │              │  │        ││
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └───┬────┘│
│         └────────────────┬┴────────────────┬┴──────────────┘     │
│                          ▼                 ▼                     │
│        ┌─────────────────────────────────────────┐               │
│        │  SHARED CORE                             │               │
│        │  Intent Engine · Decision Engine ·       │               │
│        │  Policy Engine · Scheduling Engine ·     │               │
│        │  Runtime Clock · Runtime Memory          │               │
│        │   (+ Liquidity Memory) ·                 │               │
│        │  Event Store · Read Models ·             │               │
│        │  Resource Graph + Economic Graph +       │               │
│        │   LIQUIDITY GRAPH ·                      │               │
│        │  Reserve Market State (shadow prices) ·  │               │
│        │  Recommendations · Protocol Inspector    │               │
│        └─────────────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

**The invariant:** Interfaces emit Intents. The Runtime executes them.
Interfaces read Read Models. There is no other path.

---

## 2. The Four Runtimes

The Runtime is split into four concerns. Each is independently evolvable.
All four share one core (Event Store, Read Models, Decision Engine, Policy
Engine, Runtime Clock, Runtime Memory, graphs, Inspector).

| Runtime | Owns | Does not own |
|---|---|---|
| **Execution** | payments, refunds, settlements, routing, fulfillment | capital allocation, LP selection logic, notifications |
| **Economic** | LP market, reserves, treasury, capital, yield, FX | payment lifecycle, webhooks |
| **Operational** | notifications, webhooks, analytics, audit, search, incident response | money movement |
| **Simulation** | sandbox, digital twin, forecasting, time machine, what-if, scenarios, behaviors | live money movement |

**Why split.** Concerns that change for different reasons (a new webhook
delivery retry policy vs. a new LP pricing model vs. a new simulator
behavior) live in different runtimes. The shared core prevents
incoherence: the Decision Engine, Policy Engine, and Event Store are
literally the same code across all four.

**Cross-runtime calls.** The Execution Runtime's payment pipeline calls the
Economic Runtime's Treasury Allocator at stage 5 and Liquidity Market at
stage 6. These are in-process calls today (same Next.js process); the seam
allows them to become separate services later without changing call sites.

---

## 3. The Intent Engine — the Universal Entry

This is the biggest addition in v3. **Intent is separated from Command.**

A Command says *do X*. An Intent says *I want outcome Y, here is my
understanding of the situation, please figure out how*. The runtime
normalizes, resolves, and validates the Intent before any pipeline stage
runs.

### 3.1 The Intent flow

```
Merchant says:  "Charge Alice $120"
        │
        ▼  (raw merchant request)
  MerchantIntent
        │
        ▼  Intent Engine:
        │   1. Normalize    — canonicalize amounts, currencies, casing
        │   2. Resolve      — "Alice" → customer record; "$" → USD; merchant → org
        │   3. Validate     — schema + business invariants + environment
        │   4. Augment      — attach evidence, context, actor scope, correlation
        ▼
  Typed Intent  (PaymentIntent)
        │
        ▼  Execution Pipeline (14 stages)
        ▼
  Explainable Execution  (read model + trace + decisions)
```

### 3.2 The eight intent types

Every financial operation is one of:

| Intent type | Example | Runtime |
|---|---|---|
| `PaymentIntent` | "Charge Alice $120" | Execution |
| `RefundIntent` | "Refund payment p_abc, $30" | Execution |
| `TransferIntent` | "Move 5k from wallet A to wallet B" | Execution |
| `SettlementIntent` | "Settle corridor KE→GH for 25k GHS" | Execution |
| `MintIntent` | "Mint 10k TWINGHS backed by fiat reserve" | Economic |
| `ReserveIntent` | "Lock 8k GHS reserve for payment p_abc" | Economic |
| `LiquidityIntent` | "LP Acacia offers 50k GHS at 110bps" | Economic |
| `TreasuryIntent` | "Rebalance: shift 20k from GH reserve to KE" | Economic |

### 3.3 Contract

```ts
interface IntentEngine {
  // Entry: a raw merchant/client request becomes a typed Intent.
  ingest(raw: MerchantIntent, ctx: RequestContext): Promise<TypedIntent>;

  // Resolve references ("Alice" → customerId), validate, augment.
  normalize(raw: MerchantIntent): NormalizedIntent;
  resolve(n: NormalizedIntent, ctx: RequestContext): Promise<ResolvedIntent>;
  validate(r: ResolvedIntent): ValidationResult;
  augment(r: ResolvedIntent, ctx: RequestContext): TypedIntent;
}

// A TypedIntent is what the pipeline accepts. It is serializable,
// replayable, and inspectable.
interface TypedIntent {
  id: string;
  kind: IntentKind;                 // 'payment'|'refund'|'transfer'|...
  actor: { id: string; role: string; orgId?: string };
  environment: 'sandbox' | 'live';
  subject: ResolvedSubject;         // the resolved customer/payment/wallet/...
  desired: DesiredOutcome;          // amount, currency, corridor, method, ...
  constraints: IntentConstraints;   // max cost bps, max risk, deadline, ...
  evidence: EvidenceCitation[];     // kernel evidence primitive
  correlationId: string;
  causationId?: string;             // intent that caused this one
  source: 'dashboard'|'admin'|'twin'|'sdk'|'cli'|'extension'|'ai-agent'|'mobile'|'api';
  failureInjection?: FailureInjection;   // simulator only
  createdAt: number;                // Runtime Clock time (§11)
}
```

### 3.4 Why this is huge

- **AI agents never manipulate the runtime directly.** They produce Intents.
  `AI → Intent → Runtime`. The runtime validates and refuses anything the
  actor isn't allowed to do. No AI ever calls a service method.
- **Extensions never call services.** They emit Intents.
  `Extension → Intent → Runtime`. Same path, same validation, same
  explainability. An extension can't bypass policy.
- **The simulator emits Intents.** `Twin → Intent → Runtime`. The twin is
  just another client. A simulated payment is structurally identical to a
  real one because it IS a real one, in the sandbox environment.
- **Replay is trivial.** To replay an execution, re-ingest the original
  TypedIntent. To branch ("what if we had chosen the other LP?"), mutate
  the Intent's constraints and re-ingest.

---

## 4. Interfaces Emit Intents

All clients are peers. None call services directly; none manipulate the
runtime. They all emit Intents through one of two surfaces:

- **REST/gRPC** (Dashboard, Admin, Mobile, Public API, Simulator, CLI)
- **In-process SDK** (Extensions, AI Agents — same contract, no network hop)

```
Merchant Dashboard ─┐
Admin Console ──────┤
Digital Twin ───────┤
Developer SDK ──────┼──► API Gateway ──► Intent Engine ──► Pipeline
CLI ────────────────┤
Mobile Apps ────────┤
Public API ─────────┘
Extensions ─────────┐
AI Agents ──────────┴──► SDK ──► Intent Engine ──► Pipeline
```

**The API Gateway** (§17) still owns authentication, rate limiting,
idempotency, versioning, correlation. Behind it, every route does one
thing: translate the HTTP request into a `MerchantIntent` and hand it to
the Intent Engine.

**Extensions and AI Agents** use the SDK, which calls the same Intent
Engine in-process. The SDK enforces the same validation; an extension
cannot bypass policy any more than a REST caller can.

---

## 5. The Execution Pipeline (revised)

The 14-stage pipeline now **starts with the Intent Engine** (stages 0–3),
then runs the execution stages (4–14). Every stage emits Domain Events and
a TraceNode; every decision-producing stage records a Decision.

```
 ┌ Intent Engine ──────────────────────────────────────────┐
 │  0.  INGEST       — raw request → MerchantIntent        │
 │  1.  NORMALIZE    — canonicalize amounts/currencies     │
 │  2.  RESOLVE      — resolve references to concrete IDs  │
 │  3.  VALIDATE &   — schema + invariants + policy gate;  │
 │      AUGMENT        attach evidence + correlation       │
 └─────────────────────────────────────────────────────────┘
 ┌ Execution ──────────────────────────────────────────────┐
 │  4.  POLICY        — can this actor do this, here, now? │
 │  5.  RISK & FRAUD  — scoring, screening, holds          │
 │  6.  TREASURY &    — allocate capital, lock reserves    │
 │      RESERVE                                             │
 │  7.  LIQUIDITY     — LP market: quote → clear → winner  │
 │      MARKET                                              │
 │  8.  SETTLEMENT    — connector + rail + FX + hops       │
 │      PLANNING                                            │
 │  9.  EXECUTION     — drive connectors / chain / banks   │
 │  10. LEDGER        — double-entry, immutable            │
 │  11. EVENT         — Domain Events appended to store    │
 │      EMISSION                                            │
 │  12. PROJECTION    — read models updated immediately    │
 │  13. NOTIFICATIONS — webhooks queued, emails/SMS sent   │
 │      & WEBHOOKS                                          │
 │  14. ANALYTICS +   — metrics, LTV; trace node per stage │
 │      INSPECTION                                          │
 └─────────────────────────────────────────────────────────┘
```

**Properties (carried from v2, sharpened):**
- **Uniform.** Every intent kind runs the same stages. Stage 8 (Settlement
  Planning) is where differentiation lives.
- **Resumable.** Every stage commits Domain Events; a paused intent resumes
  from the last committed stage. The Scheduling Engine (§10) can defer a
  stage ("settle in 4 hours").
- **Replayable.** Re-ingest the TypedIntent → reproduce the execution.
- **Explainable.** Every stage records a Decision (§13) answering
  Why/Why-not/Alternative/Evidence/Confidence/Policy/Cost/Risk.
- **Inspectable.** Stage 14 writes one TraceNode per stage per intent; the
  Protocol Inspector renders the full tree.

---

## 6. Execution Runtime — Engines

Owns the money-movement lifecycle. Engines here are decision services that
read world state, call kernel pure functions, and return Decisions the
pipeline records and acts on. They never write Prisma directly.

### 6.1 Settlement Engine — the product
Owns stages 8–9. Every payment, payout, refund, wallet transfer, and
treasury movement flows through it.
```
connector selection → LP allocation (from Market) → reserve reservation →
FX → liquidity routing → execution → confirmation → reconciliation
```
Reuses `protocol/settlement/*` + kernel `PlanExecutor`.

### 6.2 Risk & Fraud Engine
Owns stage 5. Scoring, screening, holds. Reuses `kernel/risk.ts` +
`kernel/fraud.ts` + `protocol/security/*`. Output: a Decision
(block/allow/hold-for-review).

---

## 7. Economic Runtime — Engines

Owns capital, liquidity, and reserves. Called by the Execution pipeline at
stages 6–7. **Amendment 1 expands this runtime** with Liquidity Intelligence,
Opportunity Discovery, Reserve Market State, and the Liquidity Strategy
Marketplace.

### 7.1 Treasury Capital Allocator
Owns stage 6 (with Reserve). Optimizes idle capital across corridor demand,
LP demand, expected traffic, FX exposure, float, yield, risk. Reuses
`kernel/optimization-engine.ts` + `kernel/treasury-ai.ts` +
`protocol/treasury-v2/*`. **(Amendment 1)** Receives Treasury Opportunity
Recommendations from Opportunity Discovery (§7B).

### 7.2 Reserve Engine (separated from Treasury)
Owns reserve locking/release, collateral, mint/burn authorization, backing
verification, exposure, fiat proofs, liquidity snapshots. The Constitution
invariant "twin token backed" is enforced here per mint. Reuses
`kernel/reserve.ts` + `kernel/twin-token.ts` + `protocol/twin-token/engine.ts`.
**(Amendment 1)** Publishes a continuous **Reserve Market State** (§7C).

### 7.3 Liquidity Market
LPs publish **pricing curves** (utilization-tiered fees, not fixed fees),
**risk appetite**, **corridor preferences**, **supported rails**, **reserve
requirements**, **latency/utilization/yield targets**, and — **(Amendment 1)**
**programmable Liquidity Strategies** (§7D). The market quotes, scores,
clears, and the winner executes. Reuses `protocol/liquidity-network/*` +
`kernel/lp-lifecycle.ts`.

---

## 7A. Liquidity Intelligence Runtime *(Amendment 1)*

A new first-class engine that **continuously analyzes the liquidity network
and improves it**. It does not route payments; it improves the network that
routing uses.

**It continuously analyzes:**
completed settlements · failed settlements · unused corridors · reserve
pressure · LP utilization · FX spreads · connector usage · missed routing
opportunities · market concentration · capital efficiency.

**It answers:**
```
Why is this LP underutilized?
Why is this corridor expensive?
Which reserve is always exhausted?
Which LP could earn more?
Which corridor has no competition?
Where should new LPs deploy capital?
Which connectors should be added?
Which reserves should Treasury increase?
```

**Contract:**
```ts
interface LiquidityIntelligenceEngine {
  // Continuous analysis on a schedule + on settlement events.
  analyze(): Promise<IntelligenceReport>;

  // Per-subject diagnostics (for the Inspector + LP/Treasury dashboards).
  explainLP(lpId: string): Promise<LPDiagnostics>;
  explainCorridor(corridorId: string): Promise<CorridorDiagnostics>;
  explainReserve(reserveId: string): Promise<ReserveDiagnostics>;

  // Feed Opportunity Discovery (§7B).
  findings(): Promise<IntelligenceFinding[]>;
}
```

Findings become Evidence for the Decision Engine and inputs to Opportunity
Discovery. The engine reads the Liquidity Graph (§16A) and Runtime Memory
(§12) to produce its analysis.

---

## 7B. Opportunity Discovery *(Amendment 1)*

A first-class capability that continuously searches for ways to make the
network cheaper, faster, and more resilient. It produces **Recommendations** —
first-class, versioned, explainable, actionable runtime objects.

**Four discovery kinds:**

**1. Missing Corridor Detection.** The Runtime detects that building a new
corridor would eliminate hops.
```
Current:   GHS → Twin GHS → Twin XOF → XOF   (3 hops)
Detects:   "Building Twin GHS → Twin XOF eliminates one settlement hop."
Recommendation: deploy LP on Twin GHS → Twin XOF.
  Estimated: 35% cheaper · 48% faster · 27% more volume.
```

**2. LP Opportunity Engine.** Per-LP business advisory.
```
LP currently provides: Twin GHS → XOF
Runtime detects: 95% of traffic passes through Twin XOF
Recommendation: also support Twin GHS → Twin XOF
  Expected volume +43% · revenue +$84k/month · capital required $220k
```

**3. Treasury Opportunity Engine.** Per-reserve optimization proposals.
```
"Increase GHS reserve 250k → +17% network throughput"
"Reduce EUR reserve 150k (82% idle)"
```

**4. Connector-Gap Detection.** Which connectors should be added to reduce
failure rates or open new rails.

**Contract:**
```ts
interface OpportunityDiscoveryEngine {
  discover(): Promise<Recommendation[]>;
  bySubject(subjectId: string): Promise<Recommendation[]>;
  byAudience(audience: RecommendationAudience): Promise<Recommendation[]>;
}

type RecommendationAudience = 'merchant' | 'lp' | 'treasury' | 'ops' | 'compliance' | 'developer';

interface Recommendation {
  id: string;
  version: number;
  audience: RecommendationAudience;
  subject: string;
  kind: 'missing_corridor' | 'lp_opportunity' | 'treasury_opportunity' | 'connector_gap';
  title: string;
  rationale: string;                 // why
  expectedImpact: { dimension: string; delta: string }[];  // +43% volume, +$84k/mo
  requiredAction: string;            // "deploy LP on Twin GHS→Twin XOF"
  capitalRequired?: number;
  evidence: EvidenceCitation[];      // from Liquidity Intelligence + Memory
  confidence: number;
  status: 'proposed' | 'accepted' | 'declined' | 'superseded';
  createdAt: number;
}
```

Recommendations are stored, versioned, and tracked (accepted/declined/
superseded) so the network's improvement history is auditable.

---

## 7C. Reserve-Aware Economic Routing *(Amendment 1)*

Routing stops considering only fee/latency/reliability. **Every route
includes reserve cost.** Routing becomes a multi-objective optimization
minimizing:

```
Execution Cost  +  Reserve Shadow Price  +  Capital Cost  +  Risk Cost
```

**Reserve Shadow Price** is a new runtime primitive: the internal
opportunity cost of consuming one more unit of a reserve. It is **not**
customer pricing — it is an optimization signal.
```
Reserve GHS:   shadow price 0.22%
Reserve USDC:  shadow price 0.03%
```
A route that drains an exhausted reserve is penalized by its high shadow
price; a route through a flush reserve is cheap. This lets Route B (higher
fee, lower reserve cost) legitimately beat Route A (lower fee, exhausted
reserve).

**Reserve Market State.** Every reserve continuously publishes:
```
available · locked · utilization · forecast depletion · refill rate ·
capital cost · risk · confidence · shadow price
```
These are **runtime inputs**, not dashboard metrics. The Settlement Engine,
Treasury Allocator, and Liquidity Market all read them.

**Contract:**
```ts
interface ReserveMarketState {
  reserveId: string;
  currency: string;
  available: number;
  locked: number;
  utilization: number;        // 0..1
  forecastDepletionMs?: number;
  refillRate: number;         // units/sec
  capitalCostBps: number;
  risk: number;               // 0..1
  confidence: number;         // 0..1
  shadowPriceBps: number;     // the optimization signal
  ts: number;
}

interface ReserveMarket {
  state(reserveId: string): ReserveMarketState;
  states(): ReserveMarketState[];       // all reserves
  shadowPrice(reserveId: string): number;
}
```

The 9-dimension routing objective (§13) consumes shadow prices + market
state directly.

---

## 7D. Liquidity Strategy Marketplace *(Amendment 1)*

LPs stop being passive infrastructure providers. They publish programmable
**strategies** the Runtime evaluates during market clearing — a capability
Stripe, Paystack, Flutterwave, and today's DEXs do not expose.

**Example strategies an LP can publish:**
```
"Maximize yield"
"Win market share"
"Prioritize instant settlement"
"Avoid payroll days"
"Only serve transactions over $1,000"
"Only operate when reserve utilization < 60%"
```

**Contract:**
```ts
interface LiquidityStrategy {
  id: string;
  lpId: string;
  name: string;
  // Predicate evaluated against the clearing context. If false, the LP is
  // excluded from this clear (and the Decision explains why).
  eligible: (ctx: ClearingContext) => boolean;
  // How this LP prefers to be scored (weighting hint, not a guarantee).
  preference?: { dimension: string; weight: number }[];
  // Dynamic pricing curve (utilization-tiered fee).
  pricingCurve: PricingTier[];
  // Risk/corridor/rail constraints (from v3 Liquidity Market).
  riskAppetite: 'low' | 'medium' | 'high';
  corridorPreferences: CorridorPref[];
  supportedRails: Rail[];
  reserveRequirements: Record<string, number>;
  latencyTarget: number;
  utilizationTarget: number;
  yieldTarget: number;
}

interface PricingTier {
  utilizationRange: [number, number];   // e.g. [0.4, 0.6]
  feeBps: number;                       // e.g. 50
}

interface ClearingContext {
  amount: number;
  currency: string;
  corridor: string;
  reserveUtilization: Record<string, number>;
  isPayrollDay: boolean;
  ts: number;
}
```

During clearing, the Runtime evaluates every published strategy's `eligible`
predicate. An LP with "only > $1000" is excluded from a $500 clear; the
Decision records "LP X excluded: strategy 'Only > $1000' not satisfied."
An LP with "avoid payroll days" is excluded (or repriced) on the 25th.

The marketplace is a marketplace for **execution strategies**, not just
liquidity — the differentiator that makes LPs programmable participants.

---

## 8. Operational Runtime

Owns everything that is not money movement but must react to it.

| Engine | Owns |
|---|---|
| **Notification Engine** | email, SMS, in-app, push — Runtime Events only |
| **Webhook Engine** | queue, sign, deliver, retry, dead-letter — Runtime Events only |
| **Analytics Engine** | metrics, LTV, corridor stats, aggregates |
| **Audit Engine** | immutable audit trail (reads Domain Events) |
| **Search Engine** | indexed search across read models (payments, customers, decisions) |
| **Incident Engine** | ops incidents, status page, SRE console |

The Operational Runtime subscribes to the Event Store. It never participates
in the execution pipeline's write path — it only reacts. This keeps
money-movement latency unaffected by notification/analytics load.

---

## 9. Simulation Runtime

This is where v3's biggest new ideas live: Runtime Clock, first-class
Scenarios, Behaviors (not probabilities), the autonomous Digital Twin, Time
Machine, and Forecasting.

### 9.1 Runtime Clock (§11)
The Simulation Runtime runs on a virtual clock. Sandbox time can be
sped up 10×/100×/1000×, paused, rewound. Every scheduled job, every
behavior tick, every seasonality curve reads `clock.now()`, never
`Date.now()`.

### 9.2 Scenarios as first-class objects

A Scenario is a **versioned asset** — not a button. It declares the world's
initial conditions and the rules that govern its evolution.

```ts
interface Scenario {
  id: string;
  version: number;                  // immutable; bumps create new versions
  name: string;
  description: string;

  actors: {
    merchants: MerchantActor[];
    customers: CustomerActor[];
    lps: LPActor[];
    connectors: ConnectorActor[];
  };

  rules: {
    seasonality: SeasonalityCurve[];        // traffic multipliers over time
    weather: WeatherModel;                  // affects mobile-money uptime
    economy: EconomyModel;                  // FX volatility, inflation
    traffic: TrafficModel;                  // peak hours, corridors
    connectorFailures: FailureSchedule[];   // planned outages
    policyOverrides: PolicyRule[];          // scenario-specific policy
  };

  timeline: {
    start: number;                          // Runtime Clock ms
    duration: number;                       // ms (or open-ended for 24/7)
    milestones: Milestone[];                // "harvest peak at day 14"
  };

  behaviors: BehaviorAssignment[];          // §9.3 — actors own behaviors
}
```

Scenarios are stored, versioned, diffable, and shareable. A regression test
is "run scenario v3 against current code; compare to baseline."

### 9.3 Behaviors (not probabilities)

Actors don't carry random probabilities. They carry **behaviors** — named
patterns that produce Intents according to context (time, season, recent
events). Behaviors are composable: a merchant can be in `MorningRush` +
`Promotion` simultaneously.

**Merchant behaviors:**
```
MorningRush · LunchRush · Weekend · Holiday · Promotion · Stockout
```
*MorningRush* emits high-volume small-ticket PaymentIntents 7–10am.
*Promotion* multiplies volume and lowers avg ticket. *Stockout* suppresses
a product line.

**Customer behaviors:**
```
Impulse · SalaryDay · Vacation · Fraud · Dormant · Loyal
```
*SalaryDay* emits a burst of PaymentIntents on the 25th. *Fraud* emits
Intents that the Risk Engine should flag. *Dormant* goes quiet for weeks.

**LP behaviors:**
```
Aggressive · Conservative · LiquidityCrisis · Expansion · Maintenance
```
*Aggressive* publishes low-fee strategies to win share. *LiquidityCrisis*
withdraws capacity and raises fees. *Expansion* publishes new corridors.

**How behaviors produce Intents:** each behavior is a function
`(actor, clock, world) → Intent[]` per tick. The Simulation Runtime
dispatches those Intents through the normal pipeline. The result is a
world that evolves organically — not a script.

### 9.4 Autonomous Digital Twin (SimCity model) — Economic *(Amendment 1)*

The twin stops being a "run-once" simulation. It becomes a **persistent
24/7 world** in the sandbox environment — and **(Amendment 1)** an
**Economic Digital Twin** that answers *what-if*, not just *what-happened*:

```
Sandbox World (always running)
  ├─ Merchants grow (LTV rises, new merchants appear)
  ├─ Customers churn / reactivate
  ├─ LPs earn yield, adjust strategies, occasionally enter crisis
  ├─ Connectors fail and recover on schedules + randomly
  ├─ Treasury reallocates capital per the Capital Allocator
  ├─ Seasonality rotates (holiday peaks, harvest, salary days)
  ├─ Runtime Memory (§12) learns patterns from the running world
  └─ Liquidity Intelligence + Opportunity Discovery run continuously
```

**Economic what-if the Twin answers** *(Amendment 1)*:
- What happens if **reserve GHS** is exhausted for 6 hours?
- What happens if **LP Acacia** exits the network?
- What happens if Treasury **injects 250k** into the XOF reserve?
- What happens if **FX shocks** +30% on NGN?
- What happens if **connector MTN** fails during Friday peak?
- What happens if a **new LP** onboards with $500k on Twin GHS→Twin XOF?
- What happens to **capital costs / shadow prices / throughput** next quarter?

The Twin simulates these by branching the world (Runtime Clock `branch()`),
applying the perturbation, and running forward — then diffing the forecast
read models against the unperturbed baseline. The result is a forecast, not
a replay.

Operators can:
- **Observe** the live sandbox world (dashboards read sandbox read models).
- **Rewind** to any past Runtime Clock moment (Time Machine).
- **Fast-forward** to see what happens next (Forecasting).
- **Branch** ("what if connector X fails tomorrow?") — forks the world.
- **Inject** a one-off Intent as any actor.
- **Ask what-if** *(Amendment 1)* and get a forecast diff.

Because the twin runs on the same Runtime as production (just sandbox
environment + virtual clock), behaviors and outcomes are directly
comparable to live.

### 9.5 Time Machine
Every Domain Event is timestamped with Runtime Clock time. Rewinding =
reading events up to clock time T and rebuilding read-model snapshots.
Fast-forwarding = letting the simulation run ahead. Both are free because
the clock is virtual and events are immutable.

### 9.6 Forecasting
Run the twin 1000× faster for a virtual week. The Capital Allocator,
Liquidity Market, and Treasury make real decisions on synthetic data. The
forecast is a read model the treasury team can inspect: "if traffic grows
15%, the GH reserve will hit critical on day 4 unless we pre-position 30k."
*(Amendment 1)* Forecasts include **shadow-price trajectories**, **reserve
depletion curves**, and **Opportunity Discovery recommendations** generated
from the forecast run.

---

## 10. Cross-Cutting Engines (shared core)

These live in the shared core and are called by all four runtimes.

### 10.1 Decision Engine
Every important decision is a recorded artifact (carried from v2). In v3,
**every** decision-producing stage uses it — not just "big" ones.

**(Amendment 1)** Every **routing** decision optimizes **9 dimensions**, and
every tradeoff is exposed in the Decision artifact:
1. fee
2. latency
3. reserve utilization
4. reserve shadow price
5. LP utilization
6. expected profitability
7. resilience
8. compliance
9. customer experience

The routing objective minimizes
`execution cost + reserve shadow price + capital cost + risk cost`, with
the other dimensions exposed as tradeoffs. The Inspector renders all 9
dimensions on any routing Decision so an operator sees *why* Route B
(higher fee, lower reserve cost) beat Route A.

### 10.2 Policy Engine
Explicit, evaluable rules (carried from v2). Answers can-settle / can-mint
/ can-refund / can-release / can-retry. Applied at pipeline stage 4 and at
every engine that mutates economic state.

### 10.3 Scheduling Engine
Deferred/recurring jobs (carried from v2). Jobs dispatch Intents through
the pipeline on the Runtime Clock. Powers "settle in 4 hours," daily
reconciliation, reserve rebalances, FX hedges, and the Simulation Runtime's
behavior ticks.

---

## 11. Runtime Clock

This sounds tiny; it is huge. **Everything uses the Runtime Clock instead
of `Date.now()`.**

```ts
interface RuntimeClock {
  now(): number;                    // current virtual ms
  speed(): number;                  // 1× (live), 10×, 100×, 1000× (sandbox)
  pause(): void;
  resume(): void;
  seekTo(ts: number): void;         // Time Machine: jump to a moment
  branch(fromTs: number): RuntimeClock;   // fork for what-if
}
```

**Why it unlocks everything:**
- **Sandbox runs faster than reality.** A virtual week completes in
  minutes. Forecasting and regression testing become practical.
- **Time Machine is free.** Rewind = `clock.seekTo(pastTs)` + rebuild from
  events. Fast-forward = `clock.setSpeed(1000)` + let behaviors fire.
- **Replay is deterministic.** A recorded execution's timestamps are
  virtual; replaying at any clock speed reproduces the same decisions.
- **Scheduled jobs are virtual.** "Settle in 4 hours" in sandbox settles in
  4 virtual hours (seconds at 1000×).

**Live environment:** the clock runs at 1×, backed by real time. Sandbox:
the clock runs at a configurable multiplier, backed by virtual time. The
clock is part of the shared core; every engine and every read model reads
`clock.now()`, never `Date.now()`.

---

## 12. Runtime Memory

The runtime **remembers** learned operational knowledge — beyond analytics,
beyond the Decision Log. Runtime Memory is a structured fact store the
engines consult during execution. **(Amendment 1)** gains a dedicated
**Liquidity Memory** sub-store.

```ts
interface RuntimeMemory {
  record(fact: RuntimeFact): Promise<void>;
  recall(query: MemoryQuery): Promise<RuntimeFact[]>;
}

interface RuntimeFact {
  id: string;
  kind: 'corridor_pattern'|'lp_reliability'|'connector_health'
      |'seasonal_demand'|'fraud_pattern'|'customer_behavior'
      // Amendment 1 — Liquidity Memory kinds:
      | 'lp_congestion_window'      // LP A always congests Fridays 16:00-18:00
      | 'reserve_depletion_cycle'   // Reserve GHS depletes every payroll day
      | 'connector_recovery_time'   // Connector X recovers after 11 minutes
      | 'corridor_concentration'    // 90% of KE-GH volume routes through 1 LP
      | 'fx_spread_pattern'         // NGN spread widens 2-4pm UTC
      | 'missed_opportunity';       // 30 settlements/day couldn't use a missing corridor
  subject: string;            // e.g. "corridor:KE-GH"
  claim: string;              // "usually congested Friday 16:00-20:00"
  evidence: EvidenceCitation[];
  confidence: number;         // 0..1
  observedCount: number;
  lastObserved: number;       // Runtime Clock
  decay?: number;             // confidence half-life
}
```

**Examples:**
- `corridor:KE-GH` "usually congested Friday 16:00-20:00" → the Settlement
  Engine prefers alternative corridors on Friday afternoons.
- `lp:Acacia` "settles 12% faster than market avg" → the Liquidity Market
  boosts Acacia's speed score.
- `connector:MTN-KE` "health degrades after 2am UTC" → the Connector
  Runtime raises its failure probability window.
- `customer:Alice` "salary-day burst on 25th" → the Risk Engine adjusts
  baseline for that day.
- *(Amendment 1)* `lp:Acacia` "always congests Fridays 16:00-18:00" → the
  Liquidity Market reduces Acacia's eligibility score in that window.
- *(Amendment 1)* `reserve:GHS` "depletes every payroll day (25th)" → the
  Treasury Allocator pre-positions capital on the 24th.
- *(Amendment 1)* `connector:Visa` "recovers after 11 minutes" → the
  Settlement Engine retries Visa at +12min instead of failing.
- *(Amendment 1)* `corridor:TwinGHS-XOF` "missing — 30 settlements/day
  would use it" → Opportunity Discovery generates a missing-corridor
  Recommendation.

Runtime Memory is **consulted, not obeyed.** Every engine that consults a
fact records it as Evidence in its Decision. Facts decay; stale facts lose
confidence. The Simulation Runtime's autonomous twin is the primary
producer of facts (it runs 24/7 and observes everything); live execution
validates and refines them. **(Amendment 1)** Liquidity Intelligence
findings and Opportunity Discovery both consume Liquidity Memory facts as
Evidence.

---

## 13. Explainability Everywhere

In v2, the Decision Engine made *important* decisions explainable. In v3,
**every node in the trace** answers the same eight questions. Explainability
is the default.

For every stage, every transition, every event:

```
Why?          — what triggered this (the Intent + prior events)
Why not?      — what alternatives were considered and rejected
Alternative?  — the rejected options, with their scores
Evidence?     — the kernel EvidenceCitation[] cited
Confidence?   — 0..1, with the contributing factors
Policy?       — which policy rule(s) allowed or constrained this
Cost?         — bps, fees, FX, opportunity cost
Risk?         — score + the dimensions that produced it
```

**Implementation.** The Decision type (v2) becomes the universal
explainability record. Every TraceNode carries one. The Protocol Inspector
renders these eight fields uniformly — click any node, see the same panel.
The Operational Runtime's Audit Engine indexes Decisions for cross-cutting
queries ("show me every LP selection where confidence < 0.6 this week").

**(Amendment 1) Inspector expansion.** When inspecting a payment, the
operator also sees:
- the **Liquidity Market** state at clearing time (which LPs bid, their
  pricing-curve quotes, their strategy-eligibility verdicts)
- the **Reserve Market** state (available/locked/utilization/shadow price
  for every reserve the route touched)
- the **shadow prices** used in the routing objective
- the **rejected routes** and why (each with its 9-dimension score)
- the **Treasury decisions** (which reserve was drawn, capital cost)
- the **capital consumed** (reserve locked + LP capacity used)
- the **expected profitability** of the chosen route
- the **missed opportunities** (e.g. "a Twin GHS→Twin XOF corridor would
  have been 35% cheaper — see Recommendation rec_abc")

Every routing decision becomes inspectable end-to-end, including the
economic reasoning that produced it.

---

## 14. Events — Domain vs Runtime (carried from v2)

**Domain Events** affect business state; replayed to rebuild aggregates and
read models.
```
IntentReceived · IntentValidated · PolicyPassed · RiskCleared ·
ReserveLocked · LPSelected · SettlementPlanned · SettlementExecuted ·
LedgerPosted · PaymentCompleted · PaymentFailed · RefundCreated ·
SettlementCompleted · ReserveReleased · TwinTokenMinted · TwinTokenBurned ·
EscrowCreated · EscrowReleased · LPStaked · LPWithdrawn · LPSlashed ·
TreasuryRebalanced · CorridorFrozen · CorridorReopened
```

**Runtime Events** are operational side-effects; retained for inspection
and ops, not replayed to rebuild business state.
```
WebhookQueued · WebhookDelivered · WebhookFailed ·
ProjectionCompleted · ProjectionRebuilt ·
NotificationSent · EmailDelivered · SmsDelivered ·
AnalyticsUpdated · DecisionRecorded · MemoryFactRecorded ·
ScheduledJobFired · ScheduledJobCompleted ·
ConnectorCalled · ConnectorHealthChanged ·
CircuitBreakerTripped · CircuitBreakerReset ·
BehaviorTicked · ScenarioStarted · ScenarioCompleted
```

Two logical streams per aggregate: `domain:<id>` (source of truth) and
`runtime:<id>` (operational, independently prunable). The global log
preserves total order.

---

## 15. Event Store (carried from v2, refined)

The Event Store is **audit / replay / sim / debug / inspect source only**.
Pages never replay — they read read models, which projections update
**immediately** on append (same transaction).

```ts
interface EventStore {
  append(streamId: string, events: UncommittedDomainEvent[],
         expectedVersion: number): Promise<AppendResult>;
  readStream(streamId: string, fromVersion?: number): Promise<StoredEvent[]>;
  readAll(fromPosition: number, limit: number): Promise<StoredEvent[]>;
  snapshot(streamId: string): Promise<Snapshot | null>;
  loadAggregate<T>(streamId: string): Promise<{state: T; version: number}>;
  replayProjection(name: string, fromPosition: number): Promise<void>;
}
```

- Append-only, OCC by stream version, snapshotable.
- Persistence: one Prisma `EventRecord` table + `EventSnapshot`.
- In-process publisher fires projections synchronously on commit.
- All timestamps are Runtime Clock time (§11).

---

## 16. Three Graphs *(Amendment 1: added Liquidity Graph)*

**Resource Graph** (business): Payment → Refund → Invoice → Customer →
Merchant → Subscription → Dispute. Built by `ResourceGraphProjection`.
Answers: *"What business objects relate to this payment?"*

**Economic Graph** (money): Reserve → LP → Wallet → Treasury → FX →
Settlement → Escrow → TwinToken. Built by `EconomicGraphProjection`.
Answers: *"Where did the money move, and what backed it?"*

**Liquidity Graph** *(Amendment 1)*: LPs · corridors · currencies · twin
currencies · reserves · connectors — edges carry capacity, cost, risk,
latency, confidence, profitability, availability. Built by
`LiquidityGraphProjection`. Continuously updated as settlements complete and
reserves/LPs change state. Answers: *"What liquidity paths exist, and which
are cheapest/fastest/most resilient right now?"* **Opportunity Discovery
operates on this graph** — it traverses the Liquidity Graph to detect
missing corridors, underutilized LPs, and concentration risks.

All three rebuilt from Domain Events; all queryable by the Inspector and the
reconciler. The kernel's `financial-graph.ts` remains the optimizer's
in-memory traversal graph (a fourth, transient graph used at planning time);
the Runtime's three graphs are persistent, projected, and inspectable.

```ts
interface LiquidityGraphQuery {
  // All paths between two currencies, ranked by the 9-dimension objective.
  paths(from: string, to: string, amount: number): Promise<LiquidityPath[]>;
  // Subgraph for a corridor (for the Inspector).
  corridor(corridorId: string): Promise<{ nodes: LiquidityNode[]; edges: LiquidityEdge[] }>;
  // Concentration check (for Liquidity Intelligence).
  concentration(subject: string): Promise<ConcentrationReport>;
}
```

---

## 17. API Gateway (carried from v2)

```
External request
  ↓
Gateway middleware (one implementation):
  1. Authenticate (NextAuth session OR API key + secret)
  2. Rate limit (per actor + per org; sandbox/live separate buckets)
  3. Idempotency (key in header → cached response if seen)
  4. Versioning (header → route to correct intent schema version)
  5. Request logging + tracing (correlationId assigned here)
  6. Quota enforcement (plan-based)
  ↓
Route handler: build MerchantIntent → hand to Intent Engine → return read model
```

---

## 18. End-to-End — One Payment Through the Runtime

1. **Merchant Dashboard** calls `POST /api/payments/create` with
   `{ customer: "Alice", amount: 120, currency: "USD" }`.
2. **API Gateway** authenticates, rate-limits, assigns `correlationId`,
   writes the root TraceNode.
3. **Route** builds a `MerchantIntent` and hands it to the **Intent Engine**.
4. **Intent Engine stage 0 — Ingest:** raw request → `MerchantIntent`.
5. **Stage 1 — Normalize:** `$120` → `120 USD`; canonicalize casing.
6. **Stage 2 — Resolve:** `"Alice"` → `customer_cx1`; merchant → `org_m1`.
7. **Stage 3 — Validate & Augment:** schema ✓; attach Evidence (customer
   history, merchant tier); `correlationId`; `source: 'dashboard'`.
   `IntentReceived` Domain Event.
8. **Stage 4 — Policy:** `PolicyEngine.evaluate()` → `PolicyPassed`;
   Decision recorded (ruleId, reason).
9. **Stage 5 — Risk & Fraud:** `RiskEngine` + `FraudEngine` score; consult
   Runtime Memory (Alice's salary-day pattern); Decision recorded;
   `RiskCleared`.
10. **Stage 6 — Treasury & Reserve:** `TreasuryAllocator.allocate()` returns
    an `AllocationDecision`; `ReserveEngine.lock()` locks reserves;
    `ReserveLocked`, `TreasuryRebalanced`.
11. **Stage 7 — Liquidity Market:** eligible LPs quote via `pricingCurve`;
    `LiquidityMarket.clear()` picks winner(s); `LPSelected`; Decision
    recorded (chosen LP, rejected quotes + reasons, tradeoffs).
12. **Stage 8 — Settlement Planning:** `SettlementEngine.plan()` returns
    legs, connector choices, FX hops, timing, collateral; Decision recorded.
13. **Stage 9 — Execution:** `SettlementEngine.execute()` drives connector
    drivers; `SettlementExecuted`.
14. **Stage 10 — Ledger:** double-entry; `LedgerPosted`.
15. **Stage 11 — Event Emission:** all Domain Events appended to the Event
    Store (atomic, OCC). Runtime Clock timestamps.
16. **Stage 12 — Projection Updates:** projections fire immediately →
    `PaymentView`, `LedgerView`, `TreasuryView`, `ResourceGraphView`,
    `EconomicGraphView`, `DecisionLogView`, `StateTimelineView`.
17. **Stage 13 — Notifications & Webhooks:** Runtime Events `WebhookQueued`,
    `NotificationSent`.
18. **Stage 14 — Analytics + Inspection:** `AnalyticsUpdated`; one
    TraceNode per stage written to `StateTimelineView`, correlated by
    `correlationId`. Every node carries the 8 explainability fields.
19. **Route** returns `paymentView.get(id)` — a read model, never a replay.
20. **Reconciliation (background):** trial balance + twin supply verified;
    result appended as a reconcile trace node.

**Simulator parity:** the twin dispatches the same `PaymentIntent` with
`source: 'twin'`, `environment: 'sandbox'`, and a `failureInjection`. The
identical pipeline runs on the Runtime Clock (perhaps at 100×). The
resulting trace is structurally identical to a production trace.

---

## 19. Economic-Integrity Invariants (carried from v2)

Two non-overridable invariants, checked continuously. A violation halts new
appends for that environment and fires a critical alert.

### 19.1 Trial Balance
`Σ(debit ledger entries) === Σ(credit ledger entries)` per currency, per
environment, at every global position.

### 19.2 Twin Supply
`Σ(minted) − Σ(burned) === outstanding twin token supply === backed fiat
reserves` at every global position.

These are the kernel's Constitution (10 invariants) made
production-enforceable at the store level.

---

## 20. Sandbox / Live Isolation (carried from v2, refined)

- Every Intent, Domain Event, Runtime Event, and read-model row carries an
  `environment` field.
- Event Store stream IDs are prefixed: `live:payment_abc` vs
  `sandbox:payment_abc`. The pipeline refuses cross-environment intents.
- **The clock differs:** live runs at 1× real time; sandbox runs at a
  configurable multiplier on virtual time.
- **The execution path is identical.** Sandbox and live differ only by
  data sources, configuration, and clock speed.

---

## 21. Migration Strategy — Strangler Fig (carried from v2, extended)

### Phase A — Runtime Core (non-disruptive)
- Add `src/runtime/` with the Intent Engine, the 14-stage pipeline scaffold,
  the Event Store, Domain/Runtime event split, immediate projection runner,
  and the Runtime Clock (live at 1×). New `EventRecord` table; existing
  tables untouched.
- App Service methods switch internally to "build MerchantIntent → hand to
  Intent Engine → drive pipeline," but the pipeline initially calls the
  existing service logic (behavior unchanged). Events appended **and**
  published to the old in-memory bus.

### Phase B — Projections own the tables
- Projections fed from the Event Store write existing tables. App Services
  stop writing tables directly; they only append events. In-memory bus
  retired.

### Phase C — Engines behind the pipeline
- Engines introduced one at a time behind their stages: Policy → Risk/Fraud
  → Reserve → Settlement → Treasury Allocator → Liquidity Market → Decision
  → Scheduling. Kernel pure functions wired as each engine's compute core.

### Phase D — Read Models + API Gateway
- Read-model façades; pages migrated off direct Prisma, one page at a time.
  API Gateway middleware; routes migrate onto it.

### Phase E — Two Graphs + Inspector
- `ResourceGraphProjection` + `EconomicGraphProjection` feed the Inspector.
  Inspector UI on `StateTimelineView` + both graphs + Decision log.

### Phase F — Simulation Runtime
- Runtime Clock virtualization for sandbox. Scenarios as first-class
  versioned objects. Behaviors catalog. Autonomous 24/7 twin. Time Machine
  + Forecasting.

### Phase G — Runtime Memory + Integrity Hardening
- Runtime Memory fact store; engines consult it during execution.
  Continuous reconciliation (trial balance + twin supply) at every commit;
  halt-on-violation. Scheduling Engine drives daily reconciliations and
  rebalances.

---

## 22. Implementation Roadmap *(Amendment 1: reordered + new milestones)*

Each milestone improves the **Runtime architecture**, per the governing
rule. No milestone adds raw CRUD or business logic to pages. The order
prioritizes one perfect vertical slice, then layers in the Amendment 1
economic capabilities, then migrates the remaining capabilities.

| Milestone | Deliverable | Exit criteria |
|---|---|---|
| **M-RT-1** Runtime Skeleton *(done)* | Runtime container, Intent Engine, Runtime Clock, 14-stage Pipeline scaffold, Event/Decision/Policy interfaces, **+ Amendment 1 interfaces** (Liquidity Intelligence, Opportunity Discovery, Reserve Market/Shadow Price, Liquidity Graph, Liquidity Strategy Marketplace, Recommendations). **No business logic.** | Skeleton compiles, imports, dispatches a no-op intent through all 14 stages, appends a no-op event. Amendment 1 interfaces importable. Existing app untouched. |
| **M-RT-2** One Vertical Slice (Payments) | Payment Intent → pipeline → Settlement → Reserve → Liquidity Market → Ledger → Events → Projections → Inspector. End-to-end. | A real payment in the UI is inspectable: original intent, every policy, why the LP was chosen, reserve allocation, settlement path, every event, every projection, replayable in sandbox. |
| **M-RT-3** Simulator Integration | Simulator's payment generation replaced with Payment Intents through the runtime. | A twin payment trace is structurally identical to a live payment trace. Architecture proven. |
| **M-RT-4** Reserve-Aware Economic Routing *(Am1)* | Reserve Market State + Shadow Price published continuously; routes scored on 9 dimensions (fee/latency/reserve-util/shadow-price/LP-util/profitability/resilience/compliance/CX); routing objective minimizes execution cost + shadow price + capital cost + risk cost. | A routing Decision exposes every tradeoff; Route B (higher fee, lower reserve cost) can beat Route A; Inspector shows shadow prices + rejected routes. |
| **M-RT-5** Liquidity Strategy Marketplace *(Am1)* | LPs publish programmable strategies (eligibility predicates + pricing curves); the Runtime evaluates them during clearing. | An LP with "only > $1000" strategy is excluded from sub-$1000 clears; the Decision explains why. |
| **M-RT-6** Liquidity Intelligence + Opportunity Discovery *(Am1)* | Liquidity Intelligence Engine analyzes the network; Opportunity Discovery produces Recommendations (missing corridors, LP opportunities, treasury opportunities, connector gaps) on the Liquidity Graph. | "Building Twin GHS→Twin XOF eliminates one hop" is a Recommendation with estimated cost/speed/volume deltas + evidence. |
| **M-RT-7** Economic Digital Twin *(Am1)* | Twin simulates what-if (reserve exhaustion, LP exits, treasury injections, FX shocks, seasonality) via clock.branch(); forecast diffs against baseline. | "What happens if LP A exits?" produces a forecast with shadow-price/reserve/throughput deltas, not just a replay. |
| **M-RT-8** Runtime Memory + Liquidity Memory *(Am1)* | Fact store with Liquidity Memory kinds; engines consult facts as Evidence; twin produces facts, live validates. | A corridor-congestion fact changes routing; a reserve-depletion-cycle fact triggers pre-positioning. |
| **M-RT-9** Three Graphs + Full Inspector *(Am1)* | Resource Graph + Economic Graph + **Liquidity Graph** projections; full Inspector UI with the Amendment 1 expansion (liquidity market / reserve market / shadow prices / LP bids / rejected routes / treasury decisions / capital consumed / expected profitability / missed opportunities). | Inspector shows all three graphs + full economic reasoning for any operation. |
| **M-RT-10** API Gateway + Scheduling Engine | Auth/rate-limit/idempotency/versioning/correlationId in one middleware; deferred/recurring jobs dispatch Intents. | No route owns cross-cutting concerns; "settle in 4 hours" fires correctly. |
| **M-RT-11** Read Models migration | Pages migrated off direct Prisma onto read-model façades. Lint rule forbids `db.<DomainTable>` outside runtime. | Zero direct Prisma calls in pages. |
| **M-RT-12** Capability Migration | Migrate one capability at a time: refunds → payouts → invoices → subscriptions → wallets → treasury → LPs. | Each capability runs on the same execution model. No new architecture invented. |
| **M-RT-13** Economic Integrity Hardening | Continuous reconciliation (trial balance + twin supply) at every commit; halt-on-violation; alert. | Injected imbalance halts the environment + alerts. |

---

## 23. Production Quality Gates

### 23.1 Architecture
- No business logic in `src/app/**` pages or routes (lint rule + review).
- No `db.<DomainTable>` access outside `src/runtime/projections/` and
  `src/runtime/read-models/` (lint rule).
- No `Date.now()` in `src/runtime/**` — use `clock.now()` (lint rule).
- Kernel untouched: `git diff --name-only HEAD -- src/kernel/` returns 0.
- Every state change starts as a TypedIntent; no shortcut paths.
- Every client (REST, SDK, twin, extension, AI) enters through the Intent
  Engine.

### 23.2 Functional
- Every pipeline stage emits ≥1 Domain Event + ≥1 TraceNode + ≥1 Decision.
- Every TraceNode carries the 8 explainability fields.
- Every engine has a declared contract; no engine writes Prisma directly.
- Sandbox and live share the identical pipeline; only data/config/clock
  speed differ.

### 23.3 Integration
- The simulator emits the same Intent types as REST (verified by trace-shape
  equality).
- Webhook replay re-ingests the original TypedIntent and produces an
  identical Domain Event sequence.
- Cross-environment intents are rejected by the Intent Engine.

### 23.4 Simulator
- A production operation's trace and the twin's trace of the same operation
  are structurally equal (same stages, same decision kinds, same event types).
- The autonomous twin runs 24/7 without operator intervention.
- Time Machine rewinds and fast-forwards correctly; branching produces
  independent worlds.
- Injected failures produce declared compensation, not silent catches.

### 23.5 UX
- The Protocol Inspector renders for every operation type, with the 8-field
  explainability panel on every node.
- Read-model queries return within the existing p95 (no regression).
- Sticky footer, responsive layout, loading skeletons preserved.

### 23.6 Performance
- Intent ingestion p99 < 10ms.
- Pipeline dispatch (stages 4–14, excluding connector/chain I/O) p99 < 50ms.
- Event Store append p99 < 20ms.
- Projection catch-up (rebuild) ≥ 10k events/sec (snapshot-assisted).
- Reconciliation check p99 < 100ms.
- Sandbox at 1000× sustains ≥ 1000 virtual payments/sec.

### 23.7 Documentation
- Each engine has a README in `src/runtime/engines/<name>/README.md`.
- The Intent catalog (8 types) is documented with schemas + examples.
- The Behavior catalog is documented.
- The Scenario format is documented.
- The event catalog (kernel `events.ts` + Runtime Domain + Runtime) is
  rendered in developer docs.

---

## 24. What Does NOT Change

- **The frozen kernel.** Zero modifications to `src/kernel/*`. The Runtime
  imports its types and pure functions; it never edits them.
- **The product surface.** No pages are deleted. Existing URLs keep working.
  The 9 demo accounts, 9 orgs, and all role-based access remain.
- **The differentiators — realized, not replaced.** Programmable liquidity
  via the Liquidity Market; treasury intelligence via the Capital Allocator;
  the digital twin via the autonomous Simulation Runtime; explainable
  protocol execution via the Decision Engine + universal explainability +
  Inspector; transparent routing via the Settlement Engine's rationale; twin
  backing via the Reserve Engine; learned operational intelligence via
  Runtime Memory.
- **Stripe as benchmark, not limit.** We keep Stripe's discipline (uniform
  pipeline, immediate projections, explainable traces, PaymentIntent-style
  abstraction generalized to every operation) and add the engines, the
  autonomous twin, and the Runtime Memory that Stripe doesn't have.

---

## 25. Scorecard

| Area | Before this discussion | After v3 |
|---|---|---|
| Product UX | 7/10 | 9.5/10 |
| Architecture | 6/10 | 10/10 |
| Financial protocol | 7/10 | 10/10 |
| Event-driven design | 5/10 | 10/10 |
| Simulator integrity | 6/10 | 10/10 |
| Production readiness | 5.5/10 | 9.5/10 |
| Stripe parity | ~45% | ~90%+ |
| **Programmable-network capability** | partial | **full** |
| **Liquidity intelligence** *(Am1)* | absent | **full** (Liquidity Intelligence + Opportunity Discovery + Liquidity Graph) |
| **Reserve-aware routing** *(Am1)* | absent | **full** (Shadow Price + 9-dimension objective) |
| **LP programmability** *(Am1)* | passive | **full** (Liquidity Strategy Marketplace) |

The architecture no longer optimizes for Stripe parity. It optimizes for a
**coherent, programmable financial runtime that continuously optimizes its
own network** with clear principles: intent first, four runtimes, a virtual
clock, an autonomous economic twin, learned memory (including liquidity
memory), three graphs, reserve-aware routing, a liquidity strategy
marketplace, and universal explainability. Stripe remains the benchmark for
developer experience; PaySwap differentiates through programmable settlement,
liquidity orchestration, transparent execution, simulation, and
explainability — capabilities Stripe, Paystack, Flutterwave, and today's
DEXs do not expose in this combination.

The remaining gap to 100% is external systems (real Stellar mainnet, real
bank APIs, real KYC, regulatory licensing) — explicitly out of scope for
application architecture.

---

## 26. Architecture Frozen (Amendment 1 applied). Resume Implementation.

Amendment 1 is applied. The architecture is **frozen again** as the v1.1
Runtime Constitution. No further redesigns — the next gains come from
executing the milestone plan while keeping the runtime coherent.

**M-RT-1 is already built.** The skeleton now needs the Amendment 1
interfaces added (Liquidity Intelligence, Opportunity Discovery, Reserve
Market/Shadow Price, Liquidity Graph, Liquidity Strategy Marketplace,
Recommendations) — all as interface-only modules, no business logic — then
implementation resumes at **M-RT-2: One Vertical Slice (Payments)**.

*The Runtime continuously optimizes the global financial network while
executing financial intents — execution and optimization are equally
important.*

---

*End of Phase 1 v3 (Final Architecture Design).*
