# PaySwap Runtime — Interface Contract Catalog

> **The fourth permanent artifact.** Not architecture — **contracts**. One
> page per primitive: purpose, inputs, outputs, invariants, consumers,
> dependencies, milestone. Engineers implement against these contracts; the
> Constitution defines *what the system is*, this catalog defines *what each
> piece promises*.
>
> **The four permanent documents:**
> 1. **Runtime Constitution** — vision, principles, primitives. Never changes.
> 2. **Runtime Dependency Map** — who depends on whom. Changes rarely.
> 3. **Runtime Roadmap** — milestones + exit criteria + deployment order.
> 4. **Interface Contract Catalog** (this doc) — per-primitive contracts.

---

## How to read a contract

Each contract states exactly what a primitive promises. **Invariants are
non-negotiable** — a primitive that violates an invariant is broken.
**Consumers** list who depends on this primitive's output. **Dependencies**
list what this primitive needs to function. **Milestone** is when the real
logic (not the NoOp stub) lands.

---

## L0 — Foundation

### Runtime Clock

```
Purpose
  Provide virtual time. Everything reads clock.now(), never Date.now().
  Live = 1× real time; sandbox = 10×/100×/1000×.

Inputs
  (none — foundational)

Outputs
  now(): number            // current virtual ms
  speed(): number          // 1× (live) or N× (sandbox)

Invariants
  • monotonic non-decreasing
  • live clock cannot pause/seek (throws)
  • virtual clock supports pause/resume/seekTo/branch

Consumers
  everything

Dependencies
  (none)

Milestone
  M-RT-1 ✅ (LiveClock + VirtualClock implemented)
```

---

## L1 — Core Infrastructure

### Event Store

```
Purpose
  Append-only source of truth. Audit / replay / sim / debug / inspect source.
  Pages NEVER replay — they read read models, which projections update
  immediately on append.

Inputs
  UncommittedEvent[] + expectedVersions + AppendMetadata

Outputs
  AppendResult (fromPosition, toPosition, streamVersions, events)
  readStream(streamId, fromVersion?) → StoredEvent[]
  readAll(fromPosition, limit) → StoredEvent[]

Invariants
  • append-only (no update/delete)
  • optimistic concurrency (OCC by stream version)
  • subscribers fire synchronously on append (immediate projection)
  • Domain Events replayed to rebuild; Runtime Events not replayed

Consumers
  Compiler, Pipeline, Projections, Inspector, all graphs, Runtime Memory

Dependencies
  Runtime Clock (L0)

Milestone
  M-RT-1 ✅ (InMemoryEventStore); Prisma-backed EventRecord in M-RT-12
```

### Intent Engine

```
Purpose
  Universal entry. Ingest a raw MerchantIntent → normalize → resolve →
  validate → augment → TypedIntent. Separates Intent ("I want Y") from
  Command ("do X").

Inputs
  MerchantIntent (kind + raw) + RequestContext

Outputs
  TypedIntent (id, kind, actor, environment, subject, desired, constraints,
               evidence, correlationId, source, createdAt)

Invariants
  • every state change starts as a TypedIntent (Principle 2)
  • all clients (REST, SDK, twin, extension, AI) enter here
  • validation rejects invalid intents before the pipeline

Consumers
  Compiler (compile a TypedIntent), Pipeline (stages 0-3)

Dependencies
  Runtime Clock (L0)

Milestone
  M-RT-1 ✅ (IntentEngine with overridable hooks); real payment hooks in M-RT-12
```

---

## L2 — Execution Substrate

### Policy Engine

```
Purpose
  Explicit, evaluable rules gating execution. can-settle / can-mint /
  can-refund / can-release / can-retry. Data, not hardcoded branches.

Inputs
  PolicyContext (intentKind, actor, environment, desired)

Outputs
  PolicyDecision (ALLOW | DENY | REQUIRE_APPROVAL + ruleId + reason)

Invariants
  • first-match-wins
  • rules are data (stored, versioned, auditable)
  • cross-environment intents rejected

Consumers
  Compiler (policy pass), Pipeline (stage 4)

Dependencies
  Event Store (L1) — for rule persistence

Milestone
  M-RT-1 ✅ (DefaultPolicyEngine with default ALLOW); real rules in M-RT-12
```

### Decision Engine

```
Purpose
  Universal explainability record. Every decision-producing stage produces
  a Decision answering Why/Why-not/Alternative/Evidence/Confidence/Policy/
  Cost/Risk.

Inputs
  (per-stage decision params)

Outputs
  Decision (kind, stage, subject, choice, score, confidence, alternatives,
            tradeoffs, constraints, evidence, reasoning, costBps, riskScore,
            policyRuleIds, ts)

Invariants
  • every TraceNode carries a Decision
  • 9+ dimensions exposed for routing decisions
  • immutable once recorded

Consumers
  Inspector, Audit Engine, every decision-producing stage

Dependencies
  (none — pure record)

Milestone
  M-RT-1 ✅ (Decision type + factory)
```

### Projection Engine

```
Purpose
  Subscribe to Domain Events → write read models immediately on append.
  Projections are the ONLY writers of read-model tables.

Inputs
  StoredEvent[] (from Event Store subscriber)

Outputs
  updated read-model tables

Invariants
  • immediate (synchronous on append, same transaction)
  • rebuildable (wipe + replay restores identically)
  • idempotent (re-applying an event is safe)

Consumers
  Read Models (the only thing pages read), Inspector, all dashboards

Dependencies
  Event Store (L1)

Milestone
  M-RT-1 ✅ (ProjectionRunner); real projections per milestone (PaymentView in M-RT-12)
```

### Protocol Inspector

```
Purpose
  Expandable trace tree per execution. Stripe inspector × Chrome DevTools.

Inputs
  correlationId (root) → reads StateTimelineView read model

Outputs
  ExecutionTrace (root TraceNode + stage nodes + child nodes)
  OptimizationExplanation (why this LP/reserve/route + missed opportunities +
                           counterfactual projections)

Invariants
  • one TraceNode per pipeline stage
  • every node carries the 8-field explainability + a Decision
  • inspectable for every operation type

Consumers
  operators (the Inspector UI)

Dependencies
  Projection Engine (L2), Event Store (L1)

Milestone
  M-RT-1 ✅ (types); UI in M-RT-14
```

---

## L3 — Knowledge Substrate

### Capability Graph

```
Purpose
  What each LP CAN do. Explicit, discoverable capability objects. Source of
  truth for "what's possible." Routes are generated FROM this.

Inputs
  LPCapability (lpId, from, to, rail, maxAmount, latencyMs, active)

Outputs
  forLP(lpId) → LPCapability[]
  canMove(from, to) → LPCapability[]
  all() → LPCapability[]

Invariants
  • capabilities are explicit objects (not derived)
  • publish/withdraw updates the graph immediately
  • Route Graph is regenerated from this (never manually maintained)

Consumers
  Route Graph (L4), Liquidity Graph (L4), Knowledge Graph (L5),
  Liquidity Market (L8), Opportunity Discovery (L9)

Dependencies
  Event Store (L1)

Milestone
  M-RT-2  ← implementation starts here
```

### Reserve Market

```
Purpose
  Continuously-published Reserve Market State + Shadow Price. Runtime input,
  not a dashboard metric. Shadow price = opportunity cost of one more unit.

Inputs
  ReserveMarketState (reserveId, currency, available, locked, utilization,
                      forecastDepletionMs, refillRate, capitalCostBps, risk,
                      confidence, shadowPriceBps, ts)

Outputs
  state(reserveId) → ReserveMarketState
  states(environment?) → ReserveMarketState[]
  shadowPrice(reserveId) → number

Invariants
  • shadow price is an optimization signal, NOT customer pricing
  • state is continuously published (on schedule + on lock/release)
  • per-environment isolation

Consumers
  Compiler (reserve_aware_routing pass), Reserve Engine (L8),
  Knowledge Graph (L5), Treasury Intelligence (L8)

Dependencies
  Event Store (L1), Runtime Clock (L0)

Milestone
  M-RT-3
```

### Liquidity Strategy Marketplace

```
Purpose
  LPs publish programmable strategies (eligible predicate + pricing curve +
  constraints). The market evaluates them during clearing.

Inputs
  LiquidityStrategy (lpId, eligible predicate, pricingCurve, riskAppetite,
                     corridorPreferences, supportedRails, reserveRequirements,
                     latencyTarget, utilizationTarget, yieldTarget)

Outputs
  evaluate(ClearingContext) → StrategyEvaluation[] (eligible + reason + quotedFeeBps)

Invariants
  • eligible=false excludes the LP from the clear (Decision explains why)
  • pricing curve is utilization-tiered (not fixed fee)
  • strategies are data (publishable/withdrawable)

Consumers
  Liquidity Market (L8), Compiler (liquidity_optimization pass)

Dependencies
  Event Store (L1)

Milestone
  M-RT-3
```

### Runtime Memory

```
Purpose
  Learned operational knowledge. Three tiers: Operational (previous
  executions), Economic (network observations), Learning (recommendation
  outcomes). Consulted, not obeyed; recorded as Evidence.

Inputs
  RuntimeFact (kind, subject, claim, evidence, confidence, observedCount,
               lastObserved, decay)

Outputs
  recall(query {subject?, kind?, tier?}) → RuntimeFact[]
  recordTo(tier, fact)
  typeConfidence(RecommendationKind) → number  // from Learning tier

Invariants
  • facts decay (stale facts lose confidence)
  • Learning tier drives adaptive Recommendation confidence
  • consulted, never obeyed (always cited as Evidence)

Consumers
  Compiler (Evidence), Economic Intelligence (L9), all engines

Dependencies
  Event Store (L1), Runtime Clock (L0)

Milestone
  M-RT-1 ✅ (types); 3-tier impl in M-RT-11
```

---

## L4 — Derived Graphs

### Route Graph

```
Purpose
  What routes currently exist. Compiled FROM the Capability Graph — never
  manually maintained. Source of truth for "what's routable right now."

Inputs
  LPCapability[] (from Capability Graph)

Outputs
  regenerate(capabilities) → void
  direct(from, to) → Route[]
  multiHop(from, to, maxHops?) → Route[]
  all(from, to) → Route[]

Invariants
  • routes are generated, never stored manually
  • adding/removing a capability auto-adds/removes routes
  • multi-hop routes are synthesized (Route Synthesis)

Consumers
  Compiler (settlement_planning pass), Knowledge Graph (L5)

Dependencies
  Capability Graph (L3)

Milestone
  M-RT-5 (after minimal Compiler M-RT-4)
```

### Liquidity Graph · Resource Graph · Economic Graph

```
Purpose
  Three specialized graph projections. Liquidity = money paths; Resource =
  business objects; Economic = money flow + backing.

Inputs
  (derived from Event Store + Capability Graph + Reserve Market)

Outputs
  paths/corridor/concentration (Liquidity)
  businessTree (Resource)
  moneyFlow (Economic)

Invariants
  • rebuilt from Domain Events
  • queryable by Inspector + reconciler

Consumers
  Knowledge Graph (L5), Inspector, Opportunity Discovery (L9)

Dependencies
  L3 primitives + Event Store (L1)

Milestone
  M-RT-14 (with Full Inspector)
```

---

## L5 — Root Graph

### Financial Knowledge Graph

```
Purpose
  Single root over all 5 graphs. Cross-graph queries no individual graph can
  answer. The single source of truth the Compiler reads at compile time.

Inputs
  (aggregates the 5 graph projections)

Outputs
  capability() / route() / liquidity() / resource() / economic() → graph views
  query(KnowledgeQuery) → KnowledgeQueryResult
  whatIf(opensReserve) → { lpId, projectedProfitability }[]

Invariants
  • not manually maintained — continuously rebuilt from Events + Compiler
    outputs + Recommendations + Economic Scores + Runtime Memory + projections
  • everything feeds the graph; the graph feeds everything

Consumers
  Compiler (L6), Economic Intelligence (L9), Counterfactual (L9), Digital Twin (L10)

Dependencies
  all 5 L4 graphs

Milestone
  M-RT-1 ✅ (NoOp); real root in M-RT-14
```

---

## L6 — Financial Compiler

### Financial Compiler

```
Purpose
  THE unifying abstraction. Compile a TypedIntent into an ExecutionPlan via
  optimization passes. Every engine is a compiler pass. Dual modes: execution
  (payments) + optimization (recommendations).

Inputs
  TypedIntent + CompilerContext (clock, knowledgeGraph, reserveMarket,
  liquidityStrategyMarketplace, economicScore, runtimeMemory, environment)
  [optimization mode also takes GraphTransformationRecommendation]

Outputs
  ExecutionPlan (reserveAllocations, lpAllocations, fxHops, settlementLegs,
                 collateral, capitalAllocation, executionTiming, passes[],
                 rationale, alternativesConsidered, estimatedCostBps,
                 estimatedRisk, expectedProfitability)
  [optimization mode → OptimizationPlan]

Invariants
  • deterministic (same inputs → same plan)
  • replayable (recompileFrom a pass reproduces)
  • side-effect free (compilation doesn't mutate state)
  • explainable (every pass produces a Decision)
  • idempotent (compile twice = same plan)
  • dual modes use the same passes + Knowledge Graph + cost decomposition

Compilation passes (in order):
  resolve_identities → policy → compliance → fraud → reserve_allocation →
  reserve_aware_routing → liquidity_optimization → fx_optimization →
  settlement_planning → ExecutionPlan

Cost decomposition (reserve_aware_routing pass):
  Execution + Capital + Reserve(shadow price) + Liquidity + Risk +
  Settlement Delay + FX

Consumers
  Pipeline (execution mode), Counterfactual Engine (optimization mode)

Dependencies
  Knowledge Graph (L5), Policy (L2), Reserve Market (L3), Liquidity Marketplace
  (L3), Economic Score (L8), Runtime Memory (L3), Clock (L0)

Milestone
  M-RT-4 (MINIMAL compiler: resolve_identities + settlement_planning only,
          transforms TypedIntent → basic ExecutionPlan)
  M-RT-5 (FULL compiler: all 8 passes + cost decomposition)
  ← M-RT-4 pulled earlier per roadmap adjustment; reduces integration risk
```

---

## L7 — Pipeline & Settlement

### Runtime Pipeline

```
Purpose
  Execute an ExecutionPlan through the 14 stages. The ONLY write path.

Inputs
  MerchantIntent + RequestContext → (via Intent Engine + Compiler) → ExecutionPlan

Outputs
  ExecutionResult (intent, trace, decisions, events, status, error?)

Invariants
  • every state change flows through here (Principle 1)
  • 14 stages, each emits ≥1 Domain Event + ≥1 TraceNode
  • resumable (paused intent resumes from last committed stage)
  • sandbox/live share identical pipeline (Principle 4)

Consumers
  Settlement (L7), Inspector, all execution

Dependencies
  Compiler (L6), Intent Engine (L1), Event Store (L1), Policy (L2)

Milestone
  M-RT-1 ✅ (scaffold); real in M-RT-12
```

### Settlement Engine

```
Purpose
  Move value to fulfill obligations. THE product. Every money movement flows
  through it.

Inputs
  ExecutionPlan (settlementLegs, connectorChoices, lpAllocations, fxHops)

Outputs
  SettlementResult (legs executed, confirmation, reconciliation)

Invariants
  • every payment/payout/refund/transfer flows through here
  • connector selection → LP allocation → reserve reservation → FX → routing →
    execution → confirmation → reconciliation
  • economic integrity (trial balance + twin supply) verified after every settle

Consumers
  Event Store (writes SettlementExecuted events)

Dependencies
  Pipeline (L7), Reserve Engine (L8), Liquidity Market (L8), Connector drivers

Milestone
  M-RT-12 (payments vertical slice)
```

---

## L8 — Economic Engines

### Reserve Engine

```
Purpose
  Lock/release/collateral/mint-burn/backing/proofs/snapshots. Twin-token
  backing invariant enforced per mint.

Inputs
  LockRequest / ReleaseRequest / MintRequest / BurnRequest

Outputs
  LockResult / ReleaseResult / MintResult / BurnResult / BackingProof / Snapshot

Invariants
  • twin token backed (every mint has fiat-reserve credit)
  • no negative balances
  • Constitution invariant enforced per mint

Consumers
  Settlement (L7), Compiler (reserve_allocation pass)

Dependencies
  Reserve Market (L3), Event Store (L1)

Milestone
  M-RT-3
```

### Liquidity Market

```
Purpose
  LPs publish strategies; market quotes, clears, winner executes.

Inputs
  ClearingContext (amount, currency, corridor, reserveUtilization, isPayrollDay)

Outputs
  ClearingResult (winning LPs + allocations + rejected quotes + reasons)

Invariants
  • eligible=false excludes (Decision explains why)
  • pricing curve fee varies by utilization
  • market clears dynamically

Consumers
  Settlement (L7), Compiler (liquidity_optimization pass)

Dependencies
  Liquidity Strategy Marketplace (L3), Capability Graph (L3)

Milestone
  M-RT-3
```

### Treasury Intelligence · Economic Score

```
Purpose
  Treasury = Capital Allocator + Growth (network steward, not profit center).
  Economic Score = per-corridor 9-dimension score powering routing + recs.

Inputs
  (Treasury) Reserve Market + Economic Score + Knowledge Graph
  (Score) Knowledge Graph + Runtime Memory

Outputs
  (Treasury) AllocationDecision + TreasuryGrowthPlan
  (Score) EconomicScore (9 dimensions + composite)

Invariants
  • Treasury optimizes network health, not merely profitability
  • Economic Score drives BOTH routing weights AND recommendation ranking

Consumers
  Compiler (treasury pass), Economic Health (L10), Opportunity Discovery (L9)

Dependencies
  L3 + L5 primitives

Milestone
  Treasury: M-RT-8; Economic Score: M-RT-9
```

---

## L9 — Economic Intelligence (closed loop)

### Economic Intelligence · Opportunity Discovery · LP/Treasury Growth · Counterfactual · Recommendation Lifecycle

```
Purpose
  The closed loop: Discover → Recommend → Validate → Learn. Coordinates 9
  subsystems. Never stops; independent from payment execution.

Inputs
  Knowledge Graph + Runtime Memory (3 tiers) + Economic Score + existing
  Recommendations + Compiler (optimization mode for validation)

Outputs
  Recommendations (Graph Transformations: GraphDiff + expectedValue + simulation
                   + implementationPlan + passedSimulationThreshold)
  ConfidenceFeedback (adaptive confidence: prediction vs reality)
  ImpactMeasurement (post-implementation outcome)

Invariants
  • closed-loop (Learn feeds back into Observe → Discover)
  • 4 validators gate every Recommendation (Digital Twin + Counterfactual +
    Economic Score + Compiler)
  • confidence is adaptive (no ML — pure prediction-vs-reality)
  • 9-stage lifecycle: Detected → Scored → Simulated → Recommended → Accepted
    → Implemented → Observed → Measured → Learning stored

Consumers
  operators (via Economic Health), LPs/Treasury (via Growth engines)

Dependencies
  Knowledge Graph (L5), Runtime Memory (L3), Economic Score (L8), Compiler (L6)

Milestone
  Opportunity Discovery + Recommendation Lifecycle: M-RT-6
  LP Growth: M-RT-7; Treasury Growth: M-RT-8
  Counterfactual: M-RT-10
```

---

## L10 — Simulation & Health

### Digital Twin · Economic Health Dashboard

```
Purpose
  Digital Twin = autonomous 24/7 sandbox world + recommendation testing ground
  (simulation gate). Economic Health = Network Scorecard (operating console).

Inputs
  (Twin) Compiler + Clock + Knowledge Graph + WorldAssumptions
  (Health) Economic Score + Recommendation Lifecycle + Knowledge Graph

Outputs
  (Twin) Counterfactual + Forecast + RecommendationSimulationResult
  (Health) EconomicHealthSnapshot (network efficiency, idle reserves,
           concentration, capital velocity, missed revenue, backlog, adoption)

Invariants
  • Twin = compiler sandbox (same compiler, different world state)
  • only Recommendations passing simulation thresholds surface
  • Health is network scorecard, NOT payment statistics

Consumers
  operators, Recommendation Lifecycle (validation gate)

Dependencies
  Compiler (L6), Clock (L0), Knowledge Graph (L5), Economic Score (L8)

Milestone
  Digital Twin + Counterfactual: M-RT-10; Economic Health: M-RT-9
```

---

## Appendix A — Measurable Milestone Exit Criteria

Every milestone is **DONE when** all criteria pass:

### M-RT-1 Runtime Skeleton ✅
- ✓ dispatch a no-op intent → 15 stages → 12 events → trace
- ✓ lint clean + tsc clean
- ✓ existing app unbroken (browser 200)

### M-RT-2 Capability Graph
- ✓ publish/withdraw LP capabilities
- ✓ `canMove('GHS','TwinGHS')` returns the right LPs
- ✓ capability add/remove updates the graph
- ✓ lint + tsc clean; kernel untouched

### M-RT-3 Reserve Market + Liquidity Market + Reserve Engine
- ✓ every reserve publishes Market State + Shadow Price
- ✓ LPs publish strategies + pricing curves
- ✓ `ReserveEngine.lock()` succeeds and updates state
- ✓ a $500 clear excludes an LP with "only > $1000" strategy
- ✓ lint + tsc clean

### M-RT-4 Minimal Financial Compiler (pulled earlier)
- ✓ `compiler.compile(intent)` produces an ExecutionPlan
- ✓ deterministic replay passes (same inputs → same plan)
- ✓ Inspector shows every compiler pass
- ✓ `compile()` < 100 ms
- ✓ lint + tsc clean

### M-RT-5 Full Compiler (reserve-aware routing)
- ✓ ExecutionPlan carries ReserveAwareRoutingPassResult
- ✓ CostDecomposition (7 components) exposed
- ✓ Route B (higher fee, lower reserve cost) beats Route A; Decision explains why
- ✓ counterfactual compilation works (optimization mode)
- ✓ 100% test coverage on compiler contracts

### M-RT-6 Opportunity Discovery + Recommendation Lifecycle
- ✓ `discover()` returns Recommendations across 12 kinds
- ✓ "Building Twin GHS→Twin XOF, +42% volume, 91% confidence" is tracked
- ✓ 9-stage lifecycle transitions correctly
- ✓ only recs passing simulation threshold surface

### M-RT-7 LP Growth · M-RT-8 Treasury Growth
- ✓ `lpGrowth.growthPlan(lpId)` returns prioritized recs + counterfactual
- ✓ `treasuryGrowth.temporaryLPProposal(corridor)` returns quantified rec
- ✓ Treasury recs optimize network throughput, not merely profitability

### M-RT-9 Economic Health + Economic Score
- ✓ `economicScore.score(corridor)` returns 9-dimension score
- ✓ `economicHealth.snapshot()` returns Network Scorecard
- ✓ Economic Score drives routing weights AND recommendation ranking

### M-RT-10 Digital Twin + Counterfactual
- ✓ `counterfactual.evaluate(hypothesis)` returns Current vs Alternative deltas
- ✓ `digitalTwin.whatIf("LP A exits")` returns forecast deltas
- ✓ Recommendation Simulation Gate suppresses weak recs, surfaces strong ones

### M-RT-11 Runtime Memory (3-tier)
- ✓ `recall({tier:'operational'|'economic'|'learning'})` returns tier-specific facts
- ✓ `confidenceFeedback` adjusts `typeConfidence(kind)` after a measured rec
- ✓ a rec that predicted +40% and delivered +38% increases confidence

### M-RT-12 One Vertical Slice — Payments (THE golden path)
- ✓ real payment: Intent → Compiler (8 passes) → ExecutionPlan → Pipeline (14 stages) → Settlement → Ledger → Events → Projections → Inspector
- ✓ Inspector shows: intent, policies, why this LP (and why not others), reserve allocation (shadow prices + cost decomposition), settlement path, events, projections, missed opportunities, counterfactual projections
- ✓ replayable in sandbox
- ✓ economic integrity (trial balance + twin supply) reconciles after every commit

### M-RT-13 Simulator Integration
- ✓ twin dispatches same PaymentIntent with `source:'twin'`
- ✓ twin trace structurally identical to live trace

### M-RT-14 Full Inspector + Three Graphs
- ✓ Inspector renders OptimizationExplanation for any operation
- ✓ all three graphs (Resource + Economic + Capability/Route) queryable

### M-RT-15 API Gateway + Scheduling
- ✓ correlationId on every request; rate-limit + idempotency in one middleware
- ✓ "settle in 4 hours" fires at the right Runtime Clock time

### M-RT-16 Multi-hop (future) · M-RT-17 Read Models · M-RT-18 Capability Migration · M-RT-19 Integrity Hardening
- (criteria in Dependency Map §3)

---

## Appendix B — Build Order vs Deployment Order

**Build order** (what to implement first) ≠ **deployment order** (how to migrate the existing app safely).

### Build order (critical path)
```
M-RT-2 Capability Graph
M-RT-3 Reserve Market + Liquidity Market + Reserve Engine
M-RT-4 Minimal Compiler        ← pulled earlier; reduces integration risk
M-RT-5 Full Compiler (reserve-aware routing)
M-RT-6 Opportunity Discovery + Recommendation Lifecycle
M-RT-10 Digital Twin + Counterfactual
M-RT-11 Runtime Memory (3-tier)
M-RT-12 Payments vertical slice
```

### Deployment order (safe migration of the existing app)
```
1. Capability Graph            (pure addition; existing app untouched)
2. Reserve Market              (pure addition)
3. Read-only Compiler          (compile + log ExecutionPlan; don't execute)
4. Shadow Compiler             (run alongside existing payment flow; compare)
5. Production Compiler         (switch payment creation to Compiler)
6. Pipeline switch-over        (existing paymentService.create() → dispatch Intent)
```

The shadow-compiler step is what lets you validate the Compiler produces correct
plans against real intents without risking production. Only when shadow + prod
agree on N consecutive payments do you switch over.

---

## Appendix C — Runtime Coverage (maturity matrix)

Generated after every milestone. Tracks **per-primitive maturity** across eight
dimensions — a much clearer picture than a single percentage. A primitive is
"production-ready" only when all columns are ✅. **Projection**, **Invariants**,
and **Replay** are explicit because the architecture is fundamentally
event-driven and built around compiled projections — replay correctness is part
of the implementation, not just a test.

Legend: ✅ done · ⏳ in progress · ⬜ not started · n/a not applicable

| Primitive | Contracts | Logic | Events | Projection | Invariants | Replay | API | Prod |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Runtime Clock | ✅ | ✅ | n/a | n/a | n/a | n/a | n/a | ⏳ |
| Event Store | ✅ | ✅ | ✅ | n/a | n/a | n/a | ⬜ | ⬜ |
| Intent Engine | ✅ | ✅ | ✅ | n/a | n/a | n/a | ⬜ | ⬜ |
| Policy Engine | ✅ | ✅ | ✅ | n/a | n/a | n/a | ⬜ | ⬜ |
| Decision Engine | ✅ | ✅ | n/a | n/a | n/a | n/a | n/a | ⬜ |
| Projection Engine | ✅ | ✅ | ✅ | n/a | n/a | n/a | ⬜ | ⬜ |
| Protocol Inspector | ✅ | ⏳ | ⏳ | ⬜ | n/a | ⬜ | ⬜ | ⬜ |
| **Capability Graph** | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ⏳ |
| **Reserve Ledger** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏳ |
| **Reserve Market** | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ⏳ |
| **Liquidity Marketplace** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⏳ |
| **Route Graph + Routing** | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ⏳ |
| **Financial Compiler** | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ✅ | ⬜ |
| **Opportunity Discovery** | ✅ | ✅ | n/a | n/a | n/a | ✅ | ✅ | ⬜ |
| **Recommendation Lifecycle** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ |
| **Digital Twin** | ✅ | ✅ | n/a | n/a | n/a | ✅ | ✅ | ⬜ |
| **Execution Pipeline** | ✅ | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ⬜ |
| Settlement Engine | ✅ | ✅ | ✅ | n/a | n/a | ✅ | ✅ | ⬜ |
| Reserve Engine | ✅ | ⬜ | ⬜ | n/a | ⬜ | ⬜ | ⬜ | ⬜ |
| Liquidity Market | ✅ | ⬜ | ⬜ | n/a | ⬜ | ⬜ | ⬜ | ⬜ |
| Runtime Memory | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Financial Knowledge Graph | ✅ | ⬜ | ⬜ | ⬜ | n/a | ⬜ | ⬜ | ⬜ |
| Economic Intelligence | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Opportunity Discovery | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| LP Growth | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Treasury Growth | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Counterfactual Engine | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Recommendation Lifecycle | ✅ | ⏳ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Digital Twin | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |
| Economic Health Dashboard | ✅ | ⬜ | ⬜ | n/a | n/a | n/a | ⬜ | ⬜ |

**Current state (post M-RT-12):** Twelve primitives are feature-complete. The
**Execution Pipeline** (M-RT-12) is now live — the first end-to-end execution
through the real runtime stack. A single payment flows: Intent → Financial
Compiler (9 passes) → ExecutionPlan → Execution Pipeline (10 stages: Receive,
Validate, Reserve, Liquidity, Settlement, Ledger, Events, Projection, Inspector,
Complete) → Domain Events → Projections. The pipeline owns all side effects
(reserve locking, ledger updates, event emission); the compiler stays pure.
The full execution trace is inspectable: compiler passes + pipeline stages +
domain events. **The architecture is validated as an integrated runtime, not
just a collection of well-designed components.**

*End of Interface Contract Catalog. Architecture is complete. Implementation: M-RT-2 through M-RT-12 done — THE GOLDEN PATH PROVEN.*
