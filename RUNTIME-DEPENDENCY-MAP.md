# PaySwap Runtime — Dependency Map & Build Matrix

> **Purpose:** Translate the frozen v1.5 Runtime Constitution into an
> implementation guide. This is **not architecture** — it is **execution
> planning**. Every primitive knows what it depends on and what depends on it.
> Every milestone knows its prerequisites, parallelization opportunities, and
> validation checkpoints.
>
> **One of three permanent documents:**
> 1. **Runtime Constitution** (`PROTOCOL-RUNTIME-ARCHITECTURE.md`) — vision, principles, primitives. Never changes.
> 2. **Runtime Dependency Map** (this doc) — who depends on whom. Changes very rarely.
> 3. **Runtime Roadmap** (§22 of the Constitution) — milestones. Can evolve.

---

## 1. Layered Dependency Graph

The 18 permanent primitives (+ supporting concepts) organize into **10 build
layers**. Build bottom-up; each layer's primitives depend only on lower
layers. Within a layer, primitives are independent and can be built in
parallel.

```
LAYER 10  ── Simulation & Health ──────────────────────────────────────
          Digital Twin · Economic Health Dashboard
LAYER 9   ── Economic Intelligence (closed loop) ──────────────────────
          Economic Intelligence · Opportunity Discovery · LP Growth ·
          Treasury Growth · Counterfactual Engine · Recommendation Lifecycle
LAYER 8   ── Economic Engines ──────────────────────────────────────────
          Reserve Engine · Liquidity Market · Treasury Intelligence ·
          Economic Score
LAYER 7   ── Pipeline & Settlement ────────────────────────────────────
          Runtime Pipeline · Settlement Engine
LAYER 6   ── Financial Compiler ────────────────────────────────────────
          Financial Compiler (dual modes: execution + optimization)
LAYER 5   ── Root Graph ────────────────────────────────────────────────
          Financial Knowledge Graph
LAYER 4   ── Derived Graphs ────────────────────────────────────────────
          Route Graph · Liquidity Graph · Resource Graph · Economic Graph
LAYER 3   ── Knowledge Substrate ───────────────────────────────────────
          Capability Graph · Reserve Market · Liquidity Strategy
          Marketplace · Runtime Memory
LAYER 2   ── Execution Substrate ───────────────────────────────────────
          Policy Engine · Decision Engine · Projection Engine ·
          Protocol Inspector
LAYER 1   ── Core Infrastructure ───────────────────────────────────────
          Event Store · Intent Engine
LAYER 0   ── Foundation ────────────────────────────────────────────────
          Runtime Clock
```

### Full dependency arrows

```
                    Runtime Clock (L0)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
   Event Store (L1)        Intent Engine (L1)
        │                        │
        ├── Policy Engine (L2)   │
        ├── Decision Engine (L2) │
        ├── Projection Engine(2) │
        ├── Protocol Inspector(2)│
        │                        │
        ├── Capability Graph (L3)│
        ├── Reserve Market (L3)  │
        ├── Liq. Strategy Mkt(3) │
        ├── Runtime Memory (L3)  │
        │                        │
        │   ┌────────────────────┘
        │   │
        ▼   ▼
   Route Graph (L4) ◄── Capability Graph
   Liquidity Graph (L4) ◄── Capability + Reserve Market + Liq. Mkt
   Resource Graph (L4) ◄── Event Store
   Economic Graph (L4) ◄── Event Store
        │
        ▼
   Financial Knowledge Graph (L5) ◄── all 5 graphs
        │
        ▼
   Financial Compiler (L6) ◄── Knowledge Graph, Policy, Reserve Market,
        │                       Liq. Mkt, Economic Score, Runtime Memory, Clock
        │
        ├── (execution mode) ──► Runtime Pipeline (L7)
        │                            │
        │                            ▼
        │                       Settlement Engine (L7) ◄── Reserve Engine,
        │                                                   Liquidity Market
        │                            │
        │                            ▼
        │                       Event Store (writes back)
        │
        └── (optimization mode) ──► Optimization Plan ──► Recommendation
                                                         Lifecycle (L9)
        │
        ▼
   Reserve Engine (L8) ◄── Reserve Market, Event Store
   Liquidity Market (L8) ◄── Liq. Strategy Mkt, Capability Graph
   Treasury Intelligence(8)◄── Reserve Market, Economic Score, Knowledge Graph
   Economic Score (L8) ◄── Knowledge Graph, Runtime Memory
        │
        ▼
   Economic Intelligence (L9) ◄── Knowledge Graph, Runtime Memory,
        │                          Economic Score
        ├── Opportunity Discovery (L9) ◄── Knowledge Graph, Memory, Score
        ├── LP Growth (L9) ◄── Opportunity Discovery, Counterfactual
        ├── Treasury Growth (L9) ◄── Opportunity Discovery, Counterfactual
        ├── Counterfactual Engine(9)◄── Knowledge Graph, Compiler (opt mode)
        └── Recommendation Lifecycle(9)◄── Runtime Memory, Counterfactual
        │
        ▼
   Digital Twin (L10) ◄── Compiler, Clock, Knowledge Graph
   Economic Health (L10) ◄── Economic Score, Rec Lifecycle, Knowledge Graph
```

---

## 2. Build Matrix

| # | Primitive | Layer | Depends On | Needed By | Milestone |
|---|---|---|---|---|---|
| 1 | **Runtime Clock** | 0 | — | everything | M-RT-1 ✅ |
| 2 | **Event Store** | 1 | Clock | Compiler, Pipeline, Projections, Inspector, all graphs, Runtime Memory | M-RT-1 ✅ |
| 3 | **Intent Engine** | 1 | Clock | Compiler, Pipeline | M-RT-1 ✅ |
| 4 | **Policy Engine** | 2 | Event Store | Compiler (policy pass), Pipeline (stage 4) | M-RT-1 ✅ |
| 5 | **Decision Engine** | 2 | — (pure record) | every stage that produces a Decision | M-RT-1 ✅ |
| 6 | **Projection Engine** | 2 | Event Store | Read Models, Inspector, all dashboards | M-RT-1 ✅ |
| 7 | **Protocol Inspector** | 2 | Projection Engine, Event Store | every operation (trace rendering) | M-RT-1 ✅ (types) / M-RT-14 (UI) |
| 8 | **Capability Graph** | 3 | Event Store | Route Graph, Liquidity Graph, Knowledge Graph, Liquidity Market | **M-RT-2** |
| 9 | **Reserve Market** | 3 | Event Store, Clock | Compiler (reserve pass), Reserve Engine, Knowledge Graph, Treasury | **M-RT-3** |
| 10 | **Liquidity Strategy Marketplace** | 3 | Event Store | Liquidity Market, Compiler (liquidity pass) | **M-RT-3** |
| 11 | **Runtime Memory** | 3 | Event Store, Clock | Compiler, Economic Intelligence, all engines (Evidence), Learning | M-RT-1 ✅ (types) / M-RT-11 (3-tier impl) |
| 12 | **Route Graph** | 4 | Capability Graph | Compiler (settlement pass), Knowledge Graph | **M-RT-4** |
| 13 | **Liquidity Graph** | 4 | Capability Graph, Reserve Market, Liquidity Marketplace | Knowledge Graph, Opportunity Discovery | M-RT-3 (with Reserve Market) |
| 14 | **Resource Graph** | 4 | Event Store | Knowledge Graph, Inspector | M-RT-14 |
| 15 | **Economic Graph** | 4 | Event Store | Knowledge Graph, Inspector, Reconciler | M-RT-14 |
| 16 | **Financial Knowledge Graph** | 5 | all 5 graphs (L4) | Compiler, Economic Intelligence, Counterfactual, Digital Twin | M-RT-14 (with graphs) / M-RT-1 ✅ (types) |
| 17 | **Financial Compiler** | 6 | Knowledge Graph, Policy, Reserve Market, Liq. Mkt, Economic Score, Runtime Memory, Clock | Pipeline (execution mode), Counterfactual (optimization mode) | M-RT-1 ✅ (NoOp) / **M-RT-5** (real) |
| 18 | **Runtime Pipeline** | 7 | Compiler, Intent Engine, Event Store, Policy | Settlement, Inspector, all execution | M-RT-1 ✅ (scaffold) / M-RT-12 (real) |
| 19 | **Settlement Engine** | 7 | Pipeline, Reserve Engine, Liquidity Market, Connector drivers | Event Store (writes events) | **M-RT-12** (payments slice) |
| 20 | **Reserve Engine** | 8 | Reserve Market, Event Store | Settlement, Compiler (reserve pass) | **M-RT-3** |
| 21 | **Liquidity Market** | 8 | Liquidity Strategy Marketplace, Capability Graph | Settlement, Compiler (liquidity pass) | **M-RT-3** |
| 22 | **Treasury Intelligence** | 8 | Reserve Market, Economic Score, Knowledge Graph | Compiler (treasury pass), Economic Health | M-RT-8 (Treasury Growth) |
| 23 | **Economic Score** | 8 | Knowledge Graph, Runtime Memory | Compiler (routing weights), Opportunity Discovery, Economic Health | **M-RT-9** |
| 24 | **Economic Intelligence** | 9 | Knowledge Graph, Runtime Memory, Economic Score | the closed loop; coordinates all L9 subsystems | M-RT-1 ✅ (types) / M-RT-6 (real) |
| 25 | **Opportunity Discovery** | 9 | Knowledge Graph, Runtime Memory, Economic Score | LP Growth, Treasury Growth, Recommendation Lifecycle | **M-RT-6** |
| 26 | **LP Growth** | 9 | Opportunity Discovery, Counterfactual | Recommendation Lifecycle (LP-audience recs) | **M-RT-7** |
| 27 | **Treasury Growth** | 9 | Opportunity Discovery, Counterfactual | Recommendation Lifecycle (treasury-audience recs) | **M-RT-8** |
| 28 | **Counterfactual Engine** | 9 | Knowledge Graph, Compiler (optimization mode) | Recommendation Lifecycle (simulate stage), Digital Twin, LP/Treasury Growth | **M-RT-10** |
| 29 | **Recommendation Lifecycle** | 9 | Runtime Memory, Counterfactual | Economic Intelligence (Learn phase), Economic Health (adoption) | M-RT-1 ✅ (types) / M-RT-6 (real) |
| 30 | **Digital Twin** | 10 | Compiler, Clock, Knowledge Graph | Recommendation validation gate, forecasting, what-if | **M-RT-10** |
| 31 | **Economic Health Dashboard** | 10 | Economic Score, Recommendation Lifecycle, Knowledge Graph | operators (network scorecard) | **M-RT-9** |

**Legend:** ✅ = already built in M-RT-1 (skeleton/interfaces). **Bold milestone** = the milestone that implements this primitive's real logic.

---

## 3. Milestone Execution Plan

Each milestone lists: **prerequisites** (must be done first), **can parallelize with** (independent work), and **validation checkpoint** (the exit test).

### M-RT-1  Runtime Skeleton ✅ DONE
- **Prerequisites:** —
- **Parallelize with:** —
- **Validation:** dispatch a no-op intent → 15 stages → 12 events → trace. Lint + tsc clean. (Passed.)

### M-RT-2  Capability Graph
- **Prerequisites:** M-RT-1 (Event Store, types)
- **Can parallelize with:** M-RT-3 (Reserve Market) — independent Layer 3 primitives
- **Validation:** publish/withdraw LP capabilities; `canMove('GHS','TwinGHS')` returns the right LPs; capability add/remove updates the graph.

### M-RT-3  Reserve Market + Liquidity Market + Reserve Engine
- **Prerequisites:** M-RT-1 (Event Store, Clock)
- **Can parallelize with:** M-RT-2 (Capability Graph)
- **Validation:** every reserve publishes Market State + Shadow Price; LPs publish strategies + pricing curves; `ReserveEngine.lock()` succeeds and updates state; a $500 clear excludes an LP with "only > $1000" strategy.

### M-RT-4  Route Graph (compiled from Capability Graph)
- **Prerequisites:** M-RT-2 (Capability Graph)
- **Can parallelize with:** M-RT-5 prep (Compiler types are ready; real impl needs L4+L5)
- **Validation:** `routeGraph.regenerate(capabilities)` produces direct routes; adding a capability auto-adds routes; removing one auto-removes them; `direct('GHS','XOF')` returns the expected routes.

### M-RT-5  Reserve-Aware Routing (Compiler: real reserve_allocation + reserve_aware_routing passes)
- **Prerequisites:** M-RT-3 (Reserve Market + Shadow Price), M-RT-4 (Route Graph), M-RT-1 (Compiler NoOp → real)
- **Can parallelize with:** M-RT-6 prep (Opportunity Discovery types ready; needs L5 Knowledge Graph)
- **Validation:** `compiler.compile(intent)` produces an ExecutionPlan with `ReserveAwareRoutingPassResult` — reserves considered/rejected, `CostDecomposition` (7 components), shadow prices used. Route B (higher fee, lower reserve cost) beats Route A; the Decision explains why.

### M-RT-6  Opportunity Discovery + Recommendation Lifecycle (real)
- **Prerequisites:** M-RT-5 (Compiler, for optimization mode), M-RT-2 (Capability Graph), M-RT-3 (Reserve Market), M-RT-4 (Route Graph) — i.e. Layer 4 + Knowledge Graph substrate
- **Can parallelize with:** M-RT-7 prep (LP Growth types ready; needs Opportunity Discovery)
- **Validation:** `opportunityDiscovery.discover()` returns Recommendations across the 12 kinds; "Building Twin GHS→Twin XOF eliminates one hop, +42% volume, +$24k/mo, 91% confidence" is a tracked Recommendation; the 9-stage lifecycle transitions correctly.

### M-RT-7  LP Growth Engine
- **Prerequisites:** M-RT-6 (Opportunity Discovery + Counterfactual stub)
- **Can parallelize with:** M-RT-8 (Treasury Growth) — both are recommendation producers over the same Discovery
- **Validation:** `lpGrowth.growthPlan(lpId)` returns prioritized recommendations with projected revenue/volume/yield deltas + counterfactual; `nextCorridor()` suggests the highest-value missing capability.

### M-RT-8  Treasury Growth Engine
- **Prerequisites:** M-RT-6 (Opportunity Discovery)
- **Can parallelize with:** M-RT-7 (LP Growth)
- **Validation:** `treasuryGrowth.growthPlan()` returns capital-deployment recs; `temporaryLPProposal(corridorId)` returns a quantified "Treasury becomes a temporary LP" rec; recs optimize network throughput, not merely profitability.

### M-RT-9  Economic Health + Economic Score
- **Prerequisites:** M-RT-6 (Opportunity Discovery + Recommendations), M-RT-3 (Reserve Market)
- **Can parallelize with:** M-RT-10 prep (Digital Twin needs Compiler; Counterfactual needs Knowledge Graph)
- **Validation:** `economicScore.score(corridorId)` returns the 9-dimension score; `economicHealth.snapshot()` returns the Network Scorecard (efficiency, idle reserves, concentration, capital velocity, missed revenue, backlog, adoption); Economic Score drives both routing weights and recommendation ranking.

### M-RT-10  Economic Digital Twin + Counterfactual Engine
- **Prerequisites:** M-RT-5 (Compiler optimization mode), M-RT-9 (Economic Score), Knowledge Graph substrate
- **Can parallelize with:** M-RT-11 (Runtime Memory 3-tier) — Memory feeds the Twin's Learning; Twin feeds Memory's Learning tier
- **Validation:** `counterfactual.evaluate(hypothesis)` returns Current vs Alternative Network deltas; `digitalTwin.whatIf("LP A exits")` returns a forecast with shadow-price/reserve/throughput/profitability deltas; the Recommendation Simulation Gate suppresses weak recs and surfaces strong ones.

### M-RT-11  Runtime Memory (3-tier) + Learning
- **Prerequisites:** M-RT-6 (Recommendation Lifecycle, for Learning tier), M-RT-10 (Counterfactual, for confidence feedback)
- **Can parallelize with:** M-RT-10 (mutual dependency — build together)
- **Validation:** `memory.recall({tier:'operational'})` returns execution facts; `tier:'economic'` returns network observations; `tier:'learning'` returns recommendation outcomes; `confidenceFeedback` adjusts `typeConfidence(kind)` after a measured rec — a rec that predicted +40% and delivered +38% increases confidence; one that delivered +5% decreases it.

### M-RT-12  One Vertical Slice — Payments (the real Compiler + Pipeline + Settlement, end-to-end)
- **Prerequisites:** M-RT-5 (Compiler real), M-RT-3 (Reserve Engine + Liquidity Market), M-RT-9 (Economic Score for routing weights)
- **Can parallelize with:** M-RT-13 prep (Simulator needs the real pipeline)
- **Validation:** **THE golden path.** A real payment in the UI: `POST /api/payments/create` → Intent Engine → Compiler (8 passes) → Execution Plan → Pipeline (14 stages) → Settlement → Ledger → Events → Projections → Inspector. The Inspector shows: original intent, every policy, why this LP (and why not others), reserve allocation (with shadow prices + cost decomposition), settlement path, every event, every projection, missed opportunities, and a counterfactual projection ("how would this look if rec #184 were implemented?"). Replayable in sandbox.

### M-RT-13  Simulator Integration
- **Prerequisites:** M-RT-12 (real pipeline)
- **Can parallelize with:** M-RT-14 (Inspector UI)
- **Validation:** the world simulator dispatches the same `PaymentIntent` with `source:'twin'`; a twin payment trace is structurally identical to a live payment trace (same stages, same decision kinds, same event types). Architecture proven: sim = prod.

### M-RT-14  Full Inspector + Three Graphs (UI)
- **Prerequisites:** M-RT-12 (real execution traces to inspect), M-RT-6 (Recommendations to inspect)
- **Can parallelize with:** M-RT-13
- **Validation:** Inspector renders for any operation: the 8-field explainability panel + `OptimizationExplanation` (why this LP/reserve/route, rejected alternatives, missed opportunities, counterfactual projections) + all three graphs (Resource + Economic + Capability/Route) + recommendation provenance.

### M-RT-15  API Gateway + Scheduling Engine
- **Prerequisites:** M-RT-12 (real routes to gate)
- **Can parallelize with:** M-RT-16 prep
- **Validation:** every request carries correlationId; rate-limit + idempotency in one middleware; "settle in 4 hours" (scheduled job) dispatches through the pipeline at the right Runtime Clock time.

### M-RT-16  Multi-hop Liquidity Composition (future)
- **Prerequisites:** M-RT-4 (Route Graph), M-RT-5 (Compiler), M-RT-14 (Inspector to render multi-hop)
- **Can parallelize with:** —
- **Validation:** a payment routes through 3 LPs (Buyer→LP A→LP B→LP C→Merchant); the Decision explains why direct lost to multi-hop (cost decomposition per hop); `routeSynthesis` produces the composite route from capabilities.

### M-RT-17  Read Models migration
- **Prerequisites:** M-RT-12 (real projections to migrate onto), M-RT-14 (Inspector proves the read models work)
- **Can parallelize with:** M-RT-18
- **Validation:** lint rule forbids `db.<DomainTable>` outside `src/runtime/`; zero direct Prisma calls in pages; every page reads through a read-model façade.

### M-RT-18  Capability Migration (refunds → payouts → invoices → subscriptions → wallets → treasury → LPs)
- **Prerequisites:** M-RT-12 (payments slice proves the pattern)
- **Can parallelize with:** M-RT-17 (one capability at a time)
- **Validation:** each capability flows through the same Compiler + Pipeline + Inspector; a refund's trace is structurally identical to a payment's trace.

### M-RT-19  Economic Integrity Hardening
- **Prerequisites:** M-RT-12 (real ledger to reconcile)
- **Can parallelize with:** M-RT-17, M-RT-18
- **Validation:** continuous trial-balance + twin-supply reconciliation at every commit; an injected ledger imbalance halts the environment + alerts.

---

## 4. Parallelization Opportunities

These milestone groups have no interdependencies and can be built concurrently:

| Parallel group | Milestones | Why they're independent |
|---|---|---|
| **A** (Layer 3) | M-RT-2 (Capability Graph) ‖ M-RT-3 (Reserve Market + Liquidity Market + Reserve Engine) | Both depend only on Event Store (L1); different graph substrates |
| **B** (Layer 4→5) | M-RT-4 (Route Graph) ‖ M-RT-9 prep (Economic Score types) | Route Graph needs only Capability Graph; Score types are ready |
| **C** (L9 producers) | M-RT-7 (LP Growth) ‖ M-RT-8 (Treasury Growth) | Both are recommendation producers over the same Opportunity Discovery |
| **D** (L10 + Memory) | M-RT-10 (Digital Twin + Counterfactual) ‖ M-RT-11 (Runtime Memory 3-tier) | Mutual dependency — build together; Twin feeds Memory's Learning tier, Memory feeds Twin's assumptions |
| **E** (post-payments) | M-RT-13 (Simulator) ‖ M-RT-14 (Inspector UI) ‖ M-RT-15 (Gateway + Scheduling) | All need the real pipeline (M-RT-12) but not each other |
| **F** (migration) | M-RT-17 (Read Models) ‖ M-RT-18 (Capability Migration) ‖ M-RT-19 (Integrity) | All post-payments; independent surfaces |

**Critical path** (longest dependency chain):
M-RT-1 → M-RT-2 → M-RT-4 → M-RT-5 → M-RT-6 → M-RT-10 → M-RT-11 → **M-RT-12** (payments) → M-RT-13/14/15 → M-RT-17/18/19

The critical path runs through the Compiler (M-RT-5), because almost everything above Layer 6 depends on it. **M-RT-5 is the highest-leverage milestone to start early.**

---

## 5. Validation Checkpoints (cross-cutting)

Every milestone must pass these before it's considered done:

| Gate | Check |
|---|---|
| **Lint** | `bun run lint` → 0 errors, 0 warnings |
| **Typecheck** | `bunx tsc --noEmit` → 0 errors |
| **Kernel untouched** | `git diff --name-only HEAD -- src/kernel/` → 0 files |
| **Existing app unbroken** | Agent Browser: homepage + merchant dashboard load 200, no console errors |
| **Trace integrity** | any dispatched intent produces a trace with the expected stages + events + decisions |
| **Economic integrity** | (after M-RT-12) trial balance + twin supply reconcile after every commit |
| **Explainability** | (after M-RT-14) every Decision answers Why/Why-not/Alternative/Evidence/Confidence/Policy/Cost/Risk |

---

## 6. The Three Permanent Documents

| Doc | Purpose | Mutability |
|---|---|---|
| **Runtime Constitution** (`PROTOCOL-RUNTIME-ARCHITECTURE.md`) | Vision, principles, 18 primitives, the closed loop | Never changes (frozen v1.5) |
| **Runtime Dependency Map** (this doc) | Who depends on whom; build matrix; milestone execution plan | Changes very rarely (only if a production lesson reveals a real dependency error) |
| **Runtime Roadmap** (§22 of the Constitution) | The 19 milestones | Can evolve (reorder, split, merge — but no new architecture) |

**Everything else is implementation documentation** — per-module READMEs, API contracts, test plans. The architecture itself is done.

---

## 7. Doc-Reduction Note

The Constitution is ~3,200 lines. That's more than engineers implement from. The recommended next pass (after this dependency map is reviewed) is a **reduction pass**: extract the contracts, state machines, and execution flows into a terse reference; move the amendment history to an appendix; keep only the current-state architecture in the main body. **Not done now** — flagged for when implementation begins, so engineers have a tight reference alongside this dependency map.

*End of Runtime Dependency Map. Architecture is complete. Implementation begins at M-RT-2.*
