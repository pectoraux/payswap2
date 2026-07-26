# PaySwap Runtime — Architecture (v1.4 Runtime Constitution, True Permanent Freeze)

> **Runtime Constitution PERMANENTLY FROZEN — v1.4 (True Final Freeze).**
> This is the **actual final** architecture amendment. The Runtime
> Constitution is now frozen **permanently**. No further architectural
> redesigns — ever. All future work must fit within this architecture,
> implemented as engines, plugins, strategies, graph projections, or compiler
> passes **within** the Constitution. The Constitution itself does not change.
>
> v1.4 adds the **unifying abstraction** that ties every engine together:
> the **Financial Network Compiler** — the layer that turns a business Intent
> into an executable financial program (an Execution Plan). Every engine
> becomes a **compiler optimization pass**. It also introduces the
> **Financial Knowledge Graph** as the single root over the five existing
> graphs, elevates the **Recommendation to a first-class Protocol Object**
> with identity + lifecycle, and adds the fourth Runtime responsibility:
> **Coordinate**.
>
> **Status:** Implementation-ready. Phase 2 resumes from M-RT-1 with all
> amendment interfaces (including the Compiler + Knowledge Graph) in the
> skeleton.
> **Supersedes:** v1 (Stripe-mirror), v2 (programmable-network reframe),
> Amendment 1 (Liquidity Intelligence + Reserve-Aware Routing), Amendment 2
> (Economic Operating System + Economic Health + Multi-hop design), Final
> Amendment (Economic Discovery & Network Evolution + Capability/Route split).
> **Philosophy (one sentence, v1.4):** *The Runtime executes financial
> intents, optimizes execution, coordinates independent economic actors, and
> continuously evolves the financial network — compiling every intent into an
> explainable execution.*
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

### Principle 12 — Economic Operating System *(Amendment 2)*
Liquidity is not just execution capacity — it is an evolving market the
Runtime continuously improves. The Runtime has two simultaneous
responsibilities: (1) execute today's payment optimally, and (2) improve
tomorrow's liquidity network. It discovers new economic opportunities and
helps every participant (LPs, treasury, merchants) become more profitable.

### Principle 13 — Economic Discovery & Network Evolution *(Final Amendment)*
The Runtime has **three** continuous responsibilities — execute, optimize,
and **evolve** the network. The liquidity network is an evolving ecosystem,
not a static graph: LPs join/leave, reserves grow/shrink, corridors appear/
disappear, demand shifts. The Runtime continuously discovers missing
liquidity, missing reserves, missing corridors, missing FX bridges, and
missing LP capabilities — and transforms those discoveries into executable,
measured recommendations. Crucially, **what an LP is capable of** (Capability
Graph) is separated from **what routes currently exist** (Route Graph), so
the Runtime can discover routes that *could* exist, not just route through
routes that *do* exist.

### Principle 14 — Financial Compilation *(v1.4 True Final Freeze)*
Turning a business Intent into an executable settlement is not routing — it
is **compilation**. The Runtime compiles an Intent into an Execution Plan
through a sequence of optimization passes (policy, compliance, fraud,
reserve optimization, liquidity optimization, FX optimization, settlement
planning). Every engine is a **compiler optimization pass**. The Digital
Twin is a **compiler sandbox** — the same compiler, different world state.
This one abstraction unifies every engine under a single mental model:
`Intent → Compiler → Execution Plan → Runtime → Settlement`, exactly like
`Source Code → Compiler → Machine Code → CPU`.

### Principle 15 — Coordination *(v1.4 True Final Freeze)*
The Runtime has **four** continuous responsibilities — Execute, Optimize,
**Coordinate**, and Evolve. The Runtime is not merely executing; it is
coordinating independent economic actors (LPs, Treasury, banks, merchants,
connectors, regulators, customers, reserves, FX providers) toward shared
outcomes. Coordination is a first-class responsibility equal to execution,
optimization, and evolution.

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
| **Economic Intelligence Runtime** *(Amendment 2)* | The renamed Economic Runtime. Its responsibility is no longer merely routing money — it optimizes the entire financial network: which LPs should exist, which reserves should grow, which corridors are under-served, which bridges are missing. |
| **Economic Health** *(Amendment 2)* | A first-class Runtime surface (the operating console of the financial network). Shows network efficiency, unused liquidity, idle reserves, utilization, concentration, capital velocity, route efficiency, missed revenue, lost volume, optimization backlog, recommendation impact. Not analytics — the operating console. |
| **Multi-hop Liquidity Composition** *(Amendment 2, design only)* | A payment route may compose across multiple LPs and reserve pools (Buyer→LP A→LP B→LP C→Merchant). The architecture supports it; implementation deferred. The Liquidity Intelligence Engine discovers missing bridges that would enable more composite routes. |
| **Missing Bridge** *(Amendment 2)* | An Opportunity Discovery kind: a liquidity link between two nodes (e.g. Twin GHS→Twin XOF) whose absence forces extra settlement hops. Building it eliminates hops and unlocks composite routes. |
| **Economic Discovery** *(Final Amendment)* | The third Runtime responsibility: continuously discovering missing liquidity, missing reserves, missing corridors, missing FX bridges, missing LP capabilities, idle capital, capital bottlenecks, and profitable expansion opportunities — and transforming them into executable recommendations. |
| **Network Evolution** *(Final Amendment)* | The liquidity network is modeled as an evolving ecosystem, not a static graph. LPs join/leave, reserves grow/shrink, corridors appear/disappear, demand shifts. The Runtime models and drives this evolution. |
| **Capability Graph** *(Final Amendment)* | What each LP CAN do (e.g. LP A supports GHS→Twin GHS; LP A supports Twin GHS→XOF). Every capability is an explicit, discoverable object. The source of truth for "what's possible." |
| **Route Graph** *(Final Amendment)* | What routes currently exist. Generated FROM the Capability Graph (never manually maintained). The source of truth for "what's routable right now." |
| **Capability Discovery** *(Final Amendment)* | The Runtime continuously asks "what capability is missing?" — e.g. an LP supports Twin GHS→XOF but not Twin GHS→Twin XOF. Generates recommendations to expose latent capabilities. |
| **Corridor Discovery** *(Final Amendment)* | The Runtime discovers corridors that do not yet exist (e.g. GHS→KES demand with no direct route), proposes composite paths, and recommends opening the corridor with estimated volume/revenue/capital/utilization/confidence. |
| **Reserve Discovery** *(Final Amendment)* | The Runtime discovers new reserve pools that should exist (e.g. "Open Twin XOF reserve, $200k capital, +$18k/mo, +$2.1M throughput, 92% confidence"). |
| **LP Growth Engine** *(Final Amendment)* | A first-class Runtime engine whose job is growing LP businesses — what corridor to open next, what reserve to fund, which pricing strategy increases profit, which capability is missing, which connectors to integrate. |
| **Treasury Growth Engine** *(Final Amendment)* | A first-class Runtime engine giving treasury growth recommendations — where to deploy capital, which reserve to expand/shrink, which corridor to bootstrap, whether to temporarily become an LP, whether to incentivize LP participation. |
| **Economic Score** *(Final Amendment)* | A per-corridor score (demand/supply/competition/capital-efficiency/reserve-health/risk/latency/profitability/growth) that powers BOTH routing AND recommendations. |
| **Counterfactual** *(Final Amendment)* | A what-if simulation comparing the Current Network vs an Alternative Network (e.g. "what if LP A had funded XOF?") across revenue/volume/latency/capital/reserve-utilization. Powers the Digital Twin's counterfactual evolution. |
| **Recommendation Lifecycle** *(Final Amendment)* | The 9-stage lifecycle of a Recommendation: Detected → Scored → Simulated → Recommended → Accepted → Implemented → Observed → Measured → Learning stored. The Runtime learns which recommendation types create real value. |
| **Financial Network Compiler** *(v1.4)* | The unifying abstraction above the engines. Turns a business Intent into an executable Execution Plan through a sequence of optimization passes. Every engine is a compiler optimization pass. `Intent → Compiler → Execution Plan → Runtime → Settlement`, exactly like `Source Code → Compiler → Machine Code → CPU`. |
| **Execution Plan** *(v1.4)* | The output of the Financial Compiler — the "machine code" the Runtime executes. A complete, executable financial program: which reserves, which LPs, how many, what FX path, what settlement plan, what collateral, what capital allocation, what execution timing. |
| **Compilation Pass** *(v1.4)* | One stage of the Financial Compiler. Each existing engine (Policy, Compliance, Fraud, Reserve, Liquidity, FX, Settlement) is a compilation pass: resolve identities → policy → compliance → fraud → reserve optimization → liquidity optimization → FX optimization → settlement planning → Execution Plan. |
| **Financial Knowledge Graph** *(v1.4)* | The single root graph containing all five existing graphs (Capability, Route, Liquidity, Resource, Economic). Answers cross-graph queries no individual graph can (e.g. "Which LPs could become profitable if Treasury opened an XOF reserve?" traverses Capability → Reserve → Economic → Route → Opportunity). |
| **Coordinate** *(v1.4)* | The fourth Runtime responsibility. The Runtime coordinates independent economic actors (LPs, Treasury, banks, merchants, connectors, regulators, customers, reserves, FX providers) toward shared outcomes — equal to Execute, Optimize, and Evolve. |
| **Protocol Object** *(v1.4)* | A first-class runtime citizen with identity, lifecycle, and learnability. Recommendations are Protocol Objects: searchable, versionable, assignable, discussable, acceptable, rejectable, measurable, and learnable. |

---

## v1.4 True Final Freeze — Financial Compiler + Knowledge Graph + Coordination

This is the **actual final** architecture amendment. The Constitution is now
frozen **permanently**. v1.4 adds the unifying abstraction that ties every
engine together and closes the last conceptual gap.

**The missing abstraction:** the Runtime is not routing — it is **compiling**.
A merchant says "charge customer 100 GHS"; the Runtime solves an optimization
problem (which reserve, which LPs, how many LPs, what FX path, what settlement
plan, what collateral, what capital allocation, what execution timing,
whether future expected traffic changes today's decision). That is
compilation, not routing. The **Financial Network Compiler** turns a business
Intent into an executable Execution Plan; every engine becomes a compiler
optimization pass.

**The root graph:** five graphs (Capability, Route, Liquidity, Resource,
Economic) exist, but relationships span them ("LP A supports Twin GHS,
supports Instant Settlement, owns Reserve R, connects Connector X, serves
Merchant M"). The **Financial Knowledge Graph** is the single root with
multiple projections — one API, cross-graph queries.

**Recommendation as Protocol Object:** Recommendations get identity +
lifecycle (Proposal → Decision → Acceptance → Implementation → Outcome →
Learning). Searchable, versionable, assignable, discussable, measurable,
learnable.

**The fourth responsibility:** Execute / Optimize / **Coordinate** / Evolve.
The Runtime coordinates independent economic actors toward shared outcomes.

| # | Addition | Effect |
|---|---|---|
| 1 | **Financial Network Compiler** | The unifying abstraction. `Intent → Compiler → Execution Plan → Runtime → Settlement`. Every engine is a compiler optimization pass. |
| 2 | **Compilation Passes** | The existing engines (Policy, Compliance, Fraud, Reserve, Liquidity, FX, Settlement) become ordered compiler passes: resolve identities → policy → compliance → fraud → reserve → liquidity → FX → settlement → Execution Plan. |
| 3 | **Execution Plan** | New first-class artifact — the compiler's output. The "machine code" the Runtime executes. |
| 4 | **Digital Twin = Compiler Sandbox** | The twin compiles using different assumptions — same compiler, different world state. Unifies simulation and production. |
| 5 | **Financial Knowledge Graph** | The single root over all five graphs. One API, cross-graph queries ("which LPs become profitable if Treasury opens an XOF reserve?" traverses Capability→Reserve→Economic→Route→Opportunity). |
| 6 | **Recommendation = Protocol Object** | Identity + lifecycle (Proposal → Decision → Acceptance → Implementation → Outcome → Learning). Searchable, versionable, assignable, discussable, measurable, learnable. |
| 7 | **Fourth responsibility: Coordinate** | Execute / Optimize / Coordinate / Evolve. The Runtime coordinates independent economic actors toward shared outcomes. |
| 8 | **18 permanent primitives** | The canonical frozen set: Intent Engine, Financial Compiler, Runtime Pipeline, Settlement Engine, Reserve Engine, Liquidity Market, Treasury Intelligence, Economic Intelligence, Decision Engine, Policy Engine, Event Store, Projection Engine, Runtime Memory, Protocol Inspector, Financial Knowledge Graph, Digital Twin, Recommendation Lifecycle, Runtime Clock. Everything else is a plugin/strategy/optimizer/graph-projection/compiler-pass built on these. |
| 9 | **True permanent freeze** | No further architectural redesigns — ever. All future work fits within the 18 primitives as plugins/passes/projections. |

---

## Final Amendment — Economic Discovery & Network Evolution

This is the **final** architecture amendment. After it, the Runtime
Constitution is frozen **permanently**. The amendment introduces the last
missing primitive and closes the last conceptual gap.

**The Core Realization:** The Runtime is not merely responsible for executing
financial intents. It is responsible for **continuously improving the
financial network itself.** Execution and optimization are only two of its
responsibilities. There is a third: **Economic Discovery.**

**The Runtime now has three continuous responsibilities:**
1. **Execute today's payment.**
2. **Optimize today's execution.**
3. **Improve tomorrow's network.**

These responsibilities are equally important. The Runtime is the economic
intelligence layer of the network.

**The crucial conceptual shift:** separate **what an LP is capable of**
(Capability Graph) from **what routes currently exist** (Route Graph). That
distinction unlocks automatic discovery of new corridors, LP expansion
recommendations, reserve recommendations, multi-hop synthesis, and a
self-improving liquidity marketplace.

| # | Addition | Effect |
|---|---|---|
| 1 | **Three responsibilities** | Execute + Optimize + **Evolve**. Philosophy amended to make evolution equal to execution. |
| 2 | **Network Evolution** | The liquidity network is modeled as an evolving ecosystem (LPs join/leave, reserves grow/shrink, corridors appear/disappear, demand shifts). |
| 3 | **Capability Graph** (split from Liquidity Graph) | What each LP CAN do — explicit, discoverable capability objects. The source of truth for "what's possible." |
| 4 | **Route Graph** (split from Liquidity Graph) | What routes currently exist. Generated FROM the Capability Graph, never manually maintained. |
| 5 | **Capability Discovery** | Detects latent capabilities ("LP supports Twin GHS→XOF but not Twin GHS→Twin XOF") and recommends exposing them. |
| 6 | **Corridor Discovery** | Discovers corridors that don't yet exist (GHS→KES demand, no direct route), proposes composite paths, recommends opening with quantified estimates. |
| 7 | **Reserve Discovery** | Discovers new reserve pools that should exist (open Twin XOF reserve, $200k, +$18k/mo, +$2.1M throughput, 92% confidence). |
| 8 | **LP Growth Engine** | First-class engine growing LP businesses — next corridor, next reserve, pricing strategy, missing capability, connector integration, utilization target, available yield. |
| 9 | **Treasury Growth Engine** | First-class engine giving treasury growth recommendations — capital deployment, reserve expand/shrink, corridor bootstrap, temporary LP role, LP incentivization. |
| 10 | **Liquidity Marketplace Analytics** | The Runtime understands the marketplace: most profitable/underutilized LP, fastest growing/highest spread/least competitive corridor, biggest liquidity gap, highest missed revenue/routing cost/unrealized volume. |
| 11 | **Economic Score** | Per-corridor score (demand/supply/competition/capital-efficiency/reserve-health/risk/latency/profitability/growth) powering BOTH routing AND recommendations. |
| 12 | **Reserve-Aware Multi-Hop** (extended) | Routing optimizes overall network value, not just fees/latency. Route B ($0.04 more expensive but preserves critical liquidity) beats Route A. Tradeoff exposed. |
| 13 | **Recommendation Lifecycle** (9 stages) | Detected → Scored → Simulated → Recommended → Accepted → Implemented → Observed → Measured → Learning stored. |
| 14 | **Runtime Memory extension** | Memory learns which recommendations succeed. Accepted+implemented recs that generated +38% volume increase future confidence; rejected/no-improvement recs decrease it. |
| 15 | **Digital Twin extension** | Counterfactual evolution: "what if this recommendation had been accepted?" / "what if LP A had funded XOF?" Compare Current Network vs Alternative Network across revenue/volume/latency/capital/reserve-utilization. |
| 16 | **Inspector extension** | Every recommendation is inspectable: why generated, what evidence/data/simulation, what tradeoffs, expected revenue, confidence, counterfactual, learning history. |
| 17 | **Counterfactual Engine** | Powers the Digital Twin's counterfactual evolution and the Recommendation "Simulated" lifecycle stage. |
| 18 | **Roadmap reorder** | Economic-network milestones (Capability Graph → Reserve Market → Route Graph → Reserve-aware Routing → Opportunity Discovery → LP Growth → Treasury Growth → Economic Health → Economic Twin) inserted BEFORE the payment vertical slice, because payments should execute on top of a fully modeled economic network. |
| 19 | **Permanent freeze** | After this amendment, the Constitution is frozen permanently. All future work fits within this architecture as engines/plugins/policies/strategies. |

---

## Amendment 2 — Economic Operating System

This amendment completes the transition from a **payment runtime** to an
**economic operating system**. The realization behind it:

> **Liquidity is not just execution capacity. Liquidity is an evolving
> market that the Runtime should continuously improve.**

The Runtime therefore has **two simultaneous responsibilities**:
1. **Execute today's payment optimally.**
2. **Improve tomorrow's liquidity network.**

Stripe never attempts #2. The Runtime becomes a continuously self-improving
financial network with two feedback loops:

```
Payment → Optimal execution today → Network learns →
LP recommendations → Reserve recommendations → Strategy improvements →
Better network tomorrow
```

| # | Addition | Effect |
|---|---|---|
| 1 | **Economic Intelligence Runtime** (renamed) | The Economic Runtime becomes the Economic Intelligence Runtime. Its job is optimizing the entire financial network, not merely routing money. |
| 2 | **Liquidity Intelligence — network analyzer** | Runs every few minutes analyzing the **network** (not payments): discover, predict, recommend, score, rank, simulate. Outputs Findings, Recommendations, Predictions, Opportunities, Warnings. |
| 3 | **Opportunity Discovery — expanded kinds** | 12 opportunity kinds: missing bridge, missing LP capability, missing reserve, unused reserve, expensive corridor, LP underpricing, LP overpricing, unbalanced corridor, missing FX pair, unused connector, slow connector, unnecessary settlement hop. |
| 4 | **Recommendation — protocol object** | Enriched: type, title, description, estimated impact/revenue/volume, confidence, supporting evidence, affected LP/treasury/corridor/reserve, implementation complexity, lifecycle (accepted/rejected/implemented/expired). Tracked + measured. |
| 5 | **LP Business Advisor** | The Runtime actively grows LP businesses ("Add Twin GHS→Twin XOF, +42% volume, +$24k/mo, 91% confidence"). |
| 6 | **Reserve Advisor** | Treasury receives quantified reserve recommendations (increase/decrease/move/pre-fund/open/close with expected volume/fees/risk/utilization). |
| 7 | **Reserve-aware routing — mandatory** | Routing minimizes execution cost × shadow price × risk × capital cost. Every reserve publishes available/locked/forecast-demand/replenishment-time/utilization/cost-of-capital/risk/confidence/shadow-price. |
| 8 | **LP Pricing Curves** | LPs publish utilization-tiered pricing curves (0-30%: 0.15%, 30-70%: 0.20%, 70-95%: 0.60%, 95%+: 1.5%). Market clears dynamically. |
| 9 | **Strategy Marketplace** | LPs publish programmable strategies (Maximize utilization/yield, Avoid payroll days/weekends, Only high-value/GHS/XOF, Prefer short/stable). Evaluated during clearing. |
| 10 | **Economic Digital Twin — whole network** | Twin simulates the entire liquidity network: reserve growth, LP growth, yield, profitability, capital utilization, reserve exhaustion, LP exits, treasury injections, new corridors, FX shocks. |
| 11 | **Liquidity Memory** | Runtime Memory gains Liquidity Facts: LP congestion windows, reserve depletion cycles, connector recovery time, corridor concentration, FX spread patterns, missed opportunities. |
| 12 | **Liquidity Graph (third graph)** | Corridors, bridges, LP capabilities, reserve connectivity, pricing, capacity, latency, yield. Opportunity Discovery operates primarily here. |
| 13 | **Decision Engine — expanded** | Routing decisions explain: execution cost, reserve cost, capital consumed, shadow price, expected LP profitability, expected treasury profitability, market utilization, alternative routes, opportunity cost. |
| 14 | **Protocol Inspector — expanded** | Every payment shows: market state, reserve state, LP bids, shadow prices, rejected routes, chosen route, treasury decision, capital consumed, expected profitability, missed opportunities. |
| 15 | **Economic Health Dashboard** | New first-class Runtime surface: network efficiency, unused liquidity, idle reserves, utilization, concentration, capital velocity, route efficiency, missed revenue, lost volume, optimization backlog, recommendation impact. The operating console of the financial network. |
| 16 | **Philosophy amendment** | "The Runtime continuously executes financial intents, optimizes the financial network, discovers new economic opportunities, and helps every participant become more profitable." |
| 17 | **Roadmap reorder** | Economic milestones (Reserve Market, Liquidity Graph, Strategy Marketplace, Reserve-aware Routing, Liquidity Intelligence, Opportunity Discovery, Economic Health) placed immediately after M-RT-1, before the payments vertical slice. |
| 18 | **Multi-hop Liquidity Composition (design only)** | Routes may compose across multiple LPs/reserve pools. The architecture supports it; implementation deferred. Liquidity Intelligence discovers missing bridges that unlock composite routes. |

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

## Implementation Order (revised — Final Amendment)

Per the Final Amendment, the economic-network milestones are placed
**immediately after M-RT-1** (before the payments vertical slice), because
payments should execute on top of a fully modeled economic network. The
payments slice then lands on a runtime that already reasons about
capabilities, routes, reserves, liquidity, opportunities, and growth.

| Milestone | Goal | Exit criteria |
|---|---|---|
| **M-RT-1** Runtime Skeleton *(done)* | Runtime container, Intent Engine, Runtime Clock, Pipeline scaffold, Event/Decision/Policy interfaces, + all amendment interfaces (Liquidity Intelligence, Opportunity Discovery, Reserve Market/Shadow Price, Capability Graph, Route Graph, Liquidity Strategy Marketplace, Recommendations, Economic Health, Multi-hop route types, LP/Treasury Growth, Economic Score, Corridor/Capability/Reserve Discovery, Recommendation Lifecycle, Counterfactual). **No business logic.** | Skeleton compiles, imports, dispatches a no-op intent through all 14 stages, appends a no-op event. All interfaces importable. Existing app untouched. |
| **M-RT-2** Capability Graph *(Final)* | LP capabilities as explicit, discoverable objects (what each LP CAN do). The source of truth for "what's possible." | Every LP's capabilities are queryable; a capability can be added/removed and the graph updates. |
| **M-RT-3** Reserve Market + Liquidity Market *(Am1/2)* | Reserve Market State + Shadow Price published continuously; Liquidity Strategy Marketplace with pricing curves. | Every reserve publishes state; LPs publish strategies + pricing curves; market evaluates eligibility at clearing. |
| **M-RT-4** Route Graph *(Final)* | Routes generated FROM the Capability Graph (never manually maintained). The source of truth for "what's routable right now." | Adding/removing a capability automatically adds/removes routes; the Route Graph is queryable. |
| **M-RT-5** Reserve-Aware Routing *(Am1/2)* | Routes scored on 9+ dimensions (fee/latency/reserve-util/shadow-price/LP-util/profitability/resilience/compliance/CX/opportunity-cost). Routing minimizes execution cost × shadow price × risk × capital cost — optimizing overall network value, not just fees. | Route B ($0.04 more expensive but preserves critical liquidity) beats Route A; the Decision exposes the tradeoff. |
| **M-RT-6** Opportunity Discovery *(Am2 + Final)* | 12+ opportunity kinds + Capability Discovery + Corridor Discovery + Reserve Discovery. Produces protocol-object Recommendations with the 9-stage lifecycle. | "Building Twin GHS→Twin XOF eliminates one hop, +42% volume, +$24k/mo, 91% confidence" is a tracked Recommendation; "open Twin XOF reserve, $200k, +$18k/mo, 92% confidence" is another. |
| **M-RT-7** LP Growth Engine *(Final)* | First-class engine growing LP businesses — next corridor, next reserve, pricing strategy, missing capability, connector integration, utilization target, available yield. | An LP receives a growth plan with quantified recommendations + counterfactual projections. |
| **M-RT-8** Treasury Growth Engine *(Final)* | First-class engine giving treasury growth recommendations — capital deployment, reserve expand/shrink, corridor bootstrap, temporary LP role, LP incentivization. | Treasury receives a growth plan; "become a temporary LP on corridor X" is a tracked, simulated Recommendation. |
| **M-RT-9** Economic Health + Economic Score *(Am2 + Final)* | Economic Health Dashboard (operating console) + per-corridor Economic Score (demand/supply/competition/capital-efficiency/reserve-health/risk/latency/profitability/growth) powering routing AND recommendations. | The Economic Health console renders; Economic Score drives both routing weights and recommendation ranking. |
| **M-RT-10** Economic Digital Twin + Counterfactual *(Am2 + Final)* | Twin simulates the whole network with counterfactual evolution: "what if this recommendation had been accepted?" / "what if LP A had funded XOF?" Compare Current vs Alternative Network. | A counterfactual returns revenue/volume/latency/capital/reserve-utilization deltas vs the baseline. |
| **M-RT-11** Runtime Memory + Learning *(Final)* | Fact store with Liquidity Memory + Recommendation Learning (successful recs increase future confidence; rejected/no-improvement recs decrease it). | The Runtime's recommendation confidence adjusts based on measured historical impact. |
| **M-RT-12** One Vertical Slice (Payments) | Payment Intent → pipeline → Settlement → Reserve → Liquidity Market → Ledger → Events → Projections → Inspector. End-to-end on the fully-modeled economic runtime. | A real payment is inspectable end-to-end incl. reserve-aware routing, LP selection rationale, shadow prices, missed opportunities, Economic Score. Replayable in sandbox. |
| **M-RT-13** Simulator Integration | Simulator's payment generation replaced with Payment Intents through the runtime. | A twin payment trace is structurally identical to a live payment trace. Architecture proven. |
| **M-RT-14** Full Inspector + Three Graphs | Resource Graph + Economic Graph + Capability/Route Graphs projections; full Inspector UI with recommendation inspection (why/evidence/data/simulation/tradeoffs/expected-revenue/confidence/counterfactual/learning-history). | Inspector shows all graphs + full economic reasoning + recommendation provenance for any operation. |
| **M-RT-15** API Gateway + Scheduling Engine | Auth/rate-limit/idempotency/versioning/correlationId in one middleware; deferred/recurring jobs dispatch Intents. | No route owns cross-cutting concerns; "settle in 4 hours" fires correctly. |
| **M-RT-16** Multi-hop Liquidity Composition *(future)* | Routes may compose across multiple LPs/reserve pools (Buyer→LP A→LP B→LP C→Merchant). Direct vs multi-hop, scored on overall network value. | A payment can route through 3 LPs; the Decision explains why direct lost to multi-hop. |
| **M-RT-17** Read Models migration | Pages migrated off direct Prisma onto read-model façades. Lint rule forbids `db.<DomainTable>` outside runtime. | Zero direct Prisma calls in pages. |
| **M-RT-18** Capability Migration | Migrate one capability at a time: refunds → payouts → invoices → subscriptions → wallets → treasury → LPs. | Each capability runs on the same execution model. No new architecture invented. |
| **M-RT-19** Economic Integrity Hardening | Continuous reconciliation (trial balance + twin supply) at every commit; halt-on-violation; alert. | Injected imbalance halts the environment + alerts. |

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

## 0. The Philosophy (v1.4 True Final Freeze)

> **The Runtime executes financial intents, optimizes execution, coordinates
> independent economic actors, and continuously evolves the financial network
> — compiling every intent into an explainable execution.**

The Runtime has **four continuous responsibilities**, equally important:
1. **Execute** today's payment.
2. **Optimize** today's execution.
3. **Coordinate** independent economic actors (LPs, Treasury, banks,
   merchants, connectors, regulators, customers, reserves, FX providers)
   toward shared outcomes.
4. **Evolve** tomorrow's network.

And the unifying mechanism: **every intent is compiled** into an Execution
Plan by the Financial Network Compiler, where every engine is a compiler
optimization pass. This makes PaySwap an economic network that can evolve
itself — not a payment runtime, not merely an economic operating system, but
a **compiling, coordinating, self-evolving financial network**. Stripe
attempts none of #2/#3/#4. PaySwap does all four.

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

## 7. Economic Intelligence Runtime — Engines *(Amendment 2: renamed)*

*(Amendment 2 renames the Economic Runtime to the **Economic Intelligence
Runtime**. Its responsibility is no longer merely routing money — it
optimizes the entire financial network: which LPs should exist, which
reserves should grow, which corridors are under-served, which bridges are
missing.)*

Owns capital, liquidity, and reserves. Called by the Execution pipeline at
stages 6–7. **Amendment 1** expanded this runtime with Liquidity Intelligence,
Opportunity Discovery, Reserve Market State, and the Liquidity Strategy
Marketplace. **Amendment 2** makes Liquidity Intelligence a network analyzer
(§7A), enriches Recommendations into protocol objects (§7B), and adds the
Economic Health Dashboard (§7E) + Multi-hop Composition design (§7F).

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

## 7A. Liquidity Intelligence Engine *(Amendment 1, expanded Amendment 2)*

A first-class engine that **continuously analyzes the liquidity network and
improves it**. It does not route payments; it improves the network that
routing uses. **(Amendment 2)** It runs **every few minutes analyzing the
network** (not payments), with six capabilities: **discover, predict,
recommend, score, rank, simulate**.

**It continuously analyzes:**
completed settlements · failed settlements · unused corridors · reserve
pressure · LP utilization · FX spreads · connector usage · missed routing
opportunities · market concentration · capital efficiency.

**It answers (the network questions):**
```
Which LP should exist?
Which reserve should grow?
Which corridor is under-served?
Which LP is missing revenue?
Which reserve is idle?
Which corridor is expensive?
Which bridge is missing?
Which FX pool should exist?
Which LP should add another capability?
```

**Outputs (every few minutes):** Findings · Recommendations · Predictions ·
Opportunities · Warnings.

**Contract:**
```ts
interface LiquidityIntelligenceEngine {
  // Continuous analysis every few minutes — on the NETWORK, not payments.
  analyze(): Promise<IntelligenceReport>;

  // Six capabilities (Amendment 2).
  discover(): Promise<IntelligenceFinding[]>;     // surface new facts
  predict(): Promise<Prediction[]>;               // forecast the network
  recommend(): Promise<Recommendation[]>;          // propose actions
  score(subject: string): Promise<ScoreCard>;     // rank LPs/corridors/reserves
  rank(dimension: string): Promise<Ranking[]>;    // leaderboard
  simulate(whatIf: WhatIf): Promise<Forecast>;    // economic what-if

  // Per-subject diagnostics (for the Inspector + LP/Treasury dashboards).
  explainLP(lpId: string): Promise<LPDiagnostics>;
  explainCorridor(corridorId: string): Promise<CorridorDiagnostics>;
  explainReserve(reserveId: string): Promise<ReserveDiagnostics>;

  // Feed Opportunity Discovery (§7B).
  findings(): Promise<IntelligenceFinding[]>;
}
```

Findings become Evidence for the Decision Engine and inputs to Opportunity
Discovery. The engine reads the Liquidity Graph (§16) and Runtime Memory
(§12) to produce its analysis. **(Amendment 2)** It also discovers
**missing bridges** — liquidity links whose absence forces extra settlement
hops and blocks multi-hop composite routes (§7F).

---

## 7B. Opportunity Discovery + Advisors *(Amendment 1, expanded Amendment 2)*

A first-class capability that continuously searches for ways to make the
network cheaper, faster, and more resilient. It produces **Recommendations** —
first-class, versioned, explainable, actionable **protocol objects** (not
notifications). **(Amendment 2)** expands discovery to **12 kinds** and
enriches the Recommendation object into a tracked, measured protocol artifact.

**The 12 opportunity kinds (Amendment 2):**
1. **Missing bridge** — a liquidity link whose absence forces extra settlement hops (e.g. Twin GHS→Twin XOF missing).
2. **Missing LP capability** — an LP could add a corridor/rail and capture volume.
3. **Missing reserve** — a corridor has no backing reserve; opening one unlocks volume.
4. **Unused reserve** — a reserve is >80% idle; capital should move.
5. **Expensive corridor** — a corridor's avg cost is above market; competition or re-pricing needed.
6. **LP underpricing** — an LP's fees are below the market-clearing price; revenue left on the table.
7. **LP overpricing** — an LP's fees are above market and losing share.
8. **Unbalanced corridor** — one direction has 10× the volume of the reverse.
9. **Missing FX pair** — traffic routes through an extra hop because a direct FX pair doesn't exist.
10. **Unused connector** — a registered connector handles 0% of eligible volume.
11. **Slow connector** — a connector's p99 latency is 2× the corridor median.
12. **Unnecessary settlement hop** — a route uses 3 hops where 2 would suffice.

**Worked examples:**

*Missing bridge:*
```
Current:   GHS → Twin GHS → Twin XOF → XOF   (3 hops)
Detects:   "Building Twin GHS → Twin XOF eliminates one settlement hop."
Recommendation: deploy LP on Twin GHS → Twin XOF.
  Estimated: 35% cheaper · 48% faster · 27% more volume.
```

*LP Business Advisor (Amendment 2):*
```
LP currently provides: Twin GHS → XOF
Runtime detects: 95% of traffic passes through Twin XOF
Recommendation: also support Twin GHS → Twin XOF
  Expected volume +42% · revenue +$24k/month · confidence 91%
  Supporting evidence: nearby LPs already perform this path;
                       merchant demand increasing; treasury has reserves.
  Implementation complexity: medium (new trustline + $220k capital).
```

*Reserve Advisor (Amendment 2):*
```
"Increase GHS reserve 250k → +17% network throughput, +$9k/mo fees"
"Reduce EUR reserve 150k (82% idle) → free $150k capital for 8% yield elsewhere"
"Pre-fund Nigeria 500k before Q4 payroll season → avoids projected +120bps shadow price"
"Open reserve in Togo → unlocks 3 corridors currently routed through Benin"
```

**Contract (Amendment 2 enriched):**
```ts
interface OpportunityDiscoveryEngine {
  discover(): Promise<Recommendation[]>;
  bySubject(subjectId: string): Promise<Recommendation[]>;
  byAudience(audience: RecommendationAudience): Promise<Recommendation[]>;
  // Amendment 2: track lifecycle + measure post-implementation impact.
  setStatus(id: string, status: RecommendationStatus): void;
  measureImpact(id: string): Promise<ImpactMeasurement | null>;
}

type RecommendationAudience = 'merchant' | 'lp' | 'treasury' | 'ops' | 'compliance' | 'developer';

type RecommendationKind =
  | 'missing_bridge' | 'missing_lp_capability' | 'missing_reserve' | 'unused_reserve'
  | 'expensive_corridor' | 'lp_underpricing' | 'lp_overpricing' | 'unbalanced_corridor'
  | 'missing_fx_pair' | 'unused_connector' | 'slow_connector' | 'unnecessary_settlement_hop';

type RecommendationStatus = 'proposed' | 'accepted' | 'rejected' | 'implemented' | 'expired';

/** A protocol object (Amendment 2: enriched). Tracked + measured. */
interface Recommendation {
  id: string;
  version: number;
  type: RecommendationKind;
  audience: RecommendationAudience;
  title: string;
  description: string;
  subject: string;
  // Quantified estimates:
  estimatedImpact: { dimension: string; delta: string }[];   // +42% volume
  estimatedRevenue?: number;                                  // +$24k/month
  estimatedVolume?: number;                                   // +$220k/month
  confidence: number;                                         // 0.91
  // Affected entities (for routing to the right advisor):
  affectedLP?: string;
  affectedTreasury?: string;
  affectedCorridor?: string;
  affectedReserve?: string;
  // Actionability:
  requiredAction: string;
  capitalRequired?: number;
  implementationComplexity?: 'low' | 'medium' | 'high';
  // Evidence + lifecycle:
  evidence: EvidenceCitation[];      // from Liquidity Intelligence + Memory
  status: RecommendationStatus;
  createdAt: number;
  decidedAt?: number;
  implementedAt?: number;
  measuredImpact?: ImpactMeasurement;   // filled after implementation
}

interface ImpactMeasurement {
  recommendationId: string;
  actualVolumeDelta: number;
  actualRevenueDelta: number;
  actualCostDeltaBps: number;
  measuredAt: number;
}
```

Recommendations are stored, versioned, tracked (proposed → accepted/rejected
→ implemented → expired), and **measured** post-implementation — so the
network's improvement history is auditable and the Runtime learns which
recommendation types produce real impact.

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

## 7E. Economic Health Dashboard *(Amendment 2)*

A first-class Runtime surface — **the operating console of the financial
network**, not an analytics page. It renders the live state of the Economic
Intelligence Runtime so operators can see the network's health at a glance
and act on Recommendations.

**It shows:**
```
Network efficiency         — avg route cost (bps) + trend
Unused liquidity           — $ idle across all LPs
Idle reserves              — reserves >80% idle, with capital $ at risk
Reserve utilization        — per-reserve bar (available/locked/shadow-price)
LP utilization             — per-LP bar vs target
Market concentration       — HHI per corridor + top-share warnings
Capital velocity           — $ settled per $ of reserve per day
Average route efficiency   — actual cost vs optimal cost (gap = opportunity)
Missed revenue             — $ left on the table from rejected/expired recs
Lost volume                — payments that failed or rerouted due to gaps
Optimization backlog       — open Recommendations by audience + confidence
Recommendation impact      — measured $ volume/revenue/cost delta post-impl
```

**Contract:**
```ts
interface EconomicHealthDashboard {
  snapshot(): Promise<EconomicHealthSnapshot>;
  // Drill-downs:
  reserves(): Promise<ReserveHealthRow[]>;
  lps(): Promise<LPHealthRow[]>;
  corridors(): Promise<CorridorHealthRow[]>;
  backlog(audience?: RecommendationAudience): Promise<Recommendation[]>;
  impact(sinceTs: number): Promise<RecommendationImpactSummary>;
}

interface EconomicHealthSnapshot {
  networkEfficiencyBps: number;
  unusedLiquidity: number;
  idleReserves: { reserveId: string; idlePct: number; capital: number }[];
  marketConcentration: { corridor: string; hhi: number; topShare: number }[];
  capitalVelocity: number;
  avgRouteEfficiencyPct: number;        // actual / optimal
  missedRevenue: number;
  lostVolume: number;
  optimizationBacklogCount: number;
  ts: number;
}
```

The Economic Health Dashboard is the operator-facing surface of the Economic
Intelligence Runtime. It is fed by read models that projections build from
Domain Events + Liquidity Intelligence findings + Recommendation lifecycle.

---

## 7F. Multi-hop Liquidity Composition *(Amendment 2 — design only, not implemented yet)*

A payment route is not limited to one LP. The architecture supports
**composing routes across multiple LPs and reserve pools**:

```
Buyer (GHS)
   │
   ▼
LP A   GHS → Twin GHS
   │
   ▼
LP B   Twin GHS → Twin XOF
   │
   ▼
LP C   Twin XOF → XOF
   │
   ▼
Merchant (XOF)
```

The routing engine evaluates **direct vs multi-hop** routes across:
- execution cost (sum of LP fees + connector fees)
- capital cost (sum of reserve shadow prices consumed)
- reserve availability (each LP's reserve must have headroom)
- settlement latency (sum of hops)
- reliability (compounded)
- opportunity cost (does this route consume scarce reserves?)

**Design principle:** the Liquidity Graph (§16) already models edges between
LPs/currencies/reserves; multi-hop composition is a path search over that
graph, scored by the same 9+ dimension objective as direct routing. The
Decision artifact for a multi-hop route lists every hop, its LP, its
reserve consumption, and its contribution to the total cost/risk — so the
Inspector renders the full composite path.

**Liquidity Intelligence discovers missing bridges** that would unlock more
composite routes:
> "LP B currently supports Twin GHS → XOF. By also supporting Twin GHS →
> Twin XOF, it could participate in 31% more composite routes."

These become first-class `missing_bridge` Recommendations (§7B).

**Status:** design only. The architecture supports multi-hop; implementation
is deferred to **M-RT-14** (future). Until then, routing is single-hop
direct. No code path exists for multi-hop execution yet — only the types and
graph queries that will enable it.

---

## 7G. Capability Graph + Route Graph *(Final Amendment — the crucial split)*

The Final Amendment's key conceptual shift: **separate what an LP is capable
of from what routes currently exist.** The Liquidity Graph (Amendment 1) is
split into two distinct graphs.

### Capability Graph — what each LP CAN do

Every LP capability is an explicit, discoverable object. The source of truth
for "what's possible."

```ts
interface LPCapability {
  id: string;
  lpId: string;
  from: string;          // currency or twin-currency (e.g. 'GHS', 'TwinGHS')
  to: string;            // currency or twin-currency (e.g. 'TwinGHS', 'XOF')
  rail: Rail;            // mobile_money | bank | card | stablecoin | blockchain
  maxAmount: number;
  latencyMs: number;
  active: boolean;
}

interface CapabilityGraph {
  // LPs publish capabilities (what they CAN do).
  publish(capability: LPCapability): void;
  withdraw(capabilityId: string): void;
  // Query: all capabilities of an LP, or all LPs that can move X→Y.
  forLP(lpId: string): LPCapability[];
  canMove(from: string, to: string): LPCapability[];
  all(): LPCapability[];
}
```

### Route Graph — what routes currently exist

Routes are **generated FROM the Capability Graph**, never manually
maintained. The source of truth for "what's routable right now." When an LP
publishes or withdraws a capability, the Route Graph updates automatically.

```ts
interface Route {
  id: string;
  from: string;
  to: string;
  hops: { lpId: string; capabilityId: string }[];   // 1 hop = direct; N = composite
  isDirect: boolean;
  generatedFrom: string[];   // capability ids
  active: boolean;
}

interface RouteGraph {
  // Regenerate routes from the current Capability Graph.
  regenerate(): Promise<void>;
  // Query: direct routes, multi-hop routes, all routes X→Y.
  direct(from: string, to: string): Route[];
  multiHop(from: string, to: string, maxHops?: number): Route[];
  all(from: string, to: string): Route[];
}
```

**Why the split matters:** with capabilities explicit, the Runtime can
discover routes that *could* exist (by composing latent capabilities), not
just route through routes that *do* exist. This unlocks Capability Discovery
(§7H), Corridor Discovery (§7I), and multi-hop synthesis.

---

## 7H. Capability Discovery *(Final Amendment)*

The Runtime continuously asks: **what capability is missing?**

```
LP A supports: Twin GHS → XOF
LP A does NOT support: Twin GHS → Twin XOF
Runtime detects: "LP A could expose Twin GHS→Twin XOF with almost no additional capital."
→ Recommendation generated.

LP B settles: GHS → Twin GHS  AND  Twin GHS → NGN
Runtime discovers: "Enable GHS→NGN (composite via existing capabilities)."
→ Recommendation generated.
```

```ts
interface CapabilityDiscoveryEngine {
  discover(): Promise<Recommendation[]>;
  // For a specific LP: what capabilities could it add?
  forLP(lpId: string): Promise<Recommendation[]>;
  // Latent composite routes enabled by a new capability.
  latentRoutes(capabilityId: string): Promise<Route[]>;
}
```

---

## 7I. Corridor Discovery *(Final Amendment)*

Current routing chooses the best corridor. The new responsibility: **discover
corridors that do not yet exist.**

```
Demand: GHS → KES exists (merchants asking for it).
No direct route.
Runtime discovers composite paths:
  GHS → Twin GHS → USDC → KES
  GHS → Twin GHS → Twin KES → KES
  GHS → USD → KES
→ Proposes: "Open corridor GHS→KES."
  Estimated volume: $1.2M/mo · revenue: +$14k/mo ·
  required capital: $300k · expected utilization: 68% · confidence: 88%.
```

```ts
interface CorridorDiscoveryEngine {
  discover(): Promise<Recommendation[]>;
  // For a demand signal (from→to with no direct route), propose corridors.
  proposeCorridor(from: string, to: string): Promise<Recommendation>;
  // Composite paths that would work if the corridor opened.
  candidatePaths(from: string, to: string): Promise<Route[]>;
}
```

---

## 7J. Reserve Discovery *(Final Amendment)*

Extends the Reserve Advisor (Amendment 2) from reallocating existing
reserves to **discovering new reserve pools that should exist.**

```
Open reserve: Twin XOF
  Required capital: $200k
  Expected monthly revenue: +$18k
  Expected throughput: +$2.1M
  Confidence: 92%
```

```ts
interface ReserveDiscoveryEngine {
  discover(): Promise<Recommendation[]>;
  // Propose opening a new reserve.
  proposeReserve(currency: string, region?: string): Promise<Recommendation>;
  // What corridors/volume would a new reserve unlock?
  unlockedCorridors(reserveId: string): Promise<{ corridor: string; volume: number }[]>;
}
```

---

## 7K. LP Growth Engine *(Final Amendment)*

A first-class Runtime engine whose job is **growing LP businesses** — not
routing.

**It answers:**
```
What corridor should this LP open next?
What reserve should this LP fund?
Which pricing strategy would increase profit?
Which capability is missing?
Which connectors should this LP integrate?
What utilization target should this LP pursue?
How much more yield is available?
```

```ts
interface LPGrowthEngine {
  // A growth plan for an LP: prioritized recommendations + counterfactual projections.
  growthPlan(lpId: string): Promise<LPGrowthPlan>;
  // Drill-down: best next corridor for this LP.
  nextCorridor(lpId: string): Promise<Recommendation>;
  // Drill-down: pricing-strategy optimization.
  pricingOptimization(lpId: string): Promise<Recommendation>;
}

interface LPGrowthPlan {
  lpId: string;
  recommendations: Recommendation[];
  projectedRevenueDelta: number;
  projectedVolumeDelta: number;
  projectedYieldDelta: number;
  counterfactual: Counterfactual;   // §7N
}
```

---

## 7L. Treasury Growth Engine *(Final Amendment)*

A first-class Runtime engine giving treasury **growth** recommendations — not
merely optimization.

**It answers:**
```
Where should capital be deployed?
What reserve should expand?
What reserve should shrink?
Which corridor deserves bootstrap liquidity?
Should Treasury temporarily become an LP?
Should Treasury incentivize LP participation?
```

```ts
interface TreasuryGrowthEngine {
  growthPlan(): Promise<TreasuryGrowthPlan>;
  // Should Treasury become a temporary LP on a corridor? (With quantified upside.)
  temporaryLPProposal(corridorId: string): Promise<Recommendation>;
  // Should Treasury incentivize LP participation? (E.g. fee rebates to attract LPs.)
  incentivizationProposal(corridorId: string): Promise<Recommendation>;
}

interface TreasuryGrowthPlan {
  recommendations: Recommendation[];
  projectedThroughputDelta: number;
  projectedRevenueDelta: number;
  capitalReallocation: { from: string; to: string; amount: number }[];
  counterfactual: Counterfactual;
}
```

---

## 7M. Economic Score + Marketplace Analytics *(Final Amendment)*

Every corridor receives an **Economic Score** that powers BOTH routing AND
recommendations.

**Score factors:** demand · supply · competition · capital efficiency ·
reserve health · risk · latency · profitability · growth.

```ts
interface EconomicScoreEngine {
  score(corridorId: string): Promise<EconomicScore>;
  rank(by: ScoreDimension): Promise<{ corridor: string; score: EconomicScore }[]>;
}

interface EconomicScore {
  corridor: string;
  demand: number;            // 0..1
  supply: number;            // 0..1
  competition: number;       // 0..1 (higher = more competitive)
  capitalEfficiency: number; // 0..1
  reserveHealth: number;     // 0..1
  risk: number;              // 0..1 (lower = safer)
  latency: number;           // ms
  profitabilityBps: number;
  growth: number;            // 0..1 (trend)
  composite: number;         // weighted 0..1 — powers routing + recommendations
}

type ScoreDimension = 'demand' | 'supply' | 'competition' | 'capitalEfficiency'
                     | 'reserveHealth' | 'risk' | 'latency' | 'profitability' | 'growth';
```

**Liquidity Marketplace Analytics** (powered by the Economic Score):
most profitable LP · most underutilized LP · fastest growing corridor ·
highest spread corridor · least competitive corridor · highest reserve
utilization · biggest liquidity gap · highest missed revenue · highest
routing cost · highest unrealized volume. These are queries over the
Economic Score, surfaced on the Economic Health Dashboard (§7E).

---

## 7N. Counterfactual Engine *(Final Amendment)*

Powers the Digital Twin's counterfactual evolution (§9.7) and the
Recommendation "Simulated" lifecycle stage. Compares the **Current Network**
vs an **Alternative Network** across revenue/volume/latency/capital/
reserve-utilization.

```ts
interface CounterfactualEngine {
  // "What if this recommendation had been accepted?"
  evaluate(hypothesis: CounterfactualHypothesis): Promise<Counterfactual>;
}

interface CounterfactualHypothesis {
  description: string;          // "LP A funds XOF reserve"
  mutations: NetworkMutation[]; // the changes to apply to the network
  durationMs: number;           // how long to simulate
}

interface NetworkMutation {
  kind: 'add_capability' | 'remove_capability' | 'add_reserve' | 'resize_reserve'
      | 'add_lp' | 'remove_lp' | 'change_pricing' | 'fx_shock';
  target: string;
  params: Record<string, unknown>;
}

interface Counterfactual {
  hypothesis: string;
  baseline: NetworkSnapshot;     // Current Network
  alternative: NetworkSnapshot;  // Alternative Network
  deltas: {
    revenue: number; volume: number; latency: number;
    capital: number; reserveUtilization: Record<string, number>;
  };
  confidence: number;
  simulatedAt: number;
}

interface NetworkSnapshot {
  revenue: number; volume: number; avgLatencyMs: number;
  capitalDeployed: number; reserveUtilization: Record<string, number>;
  corridorCount: number; lpCount: number;
}
```

---

## 7O. Recommendation Lifecycle *(Final Amendment — 9 stages)*

Recommendations are protocol objects with a **9-stage lifecycle**. The
Runtime learns which recommendation types create real value.

```
Detected → Scored → Simulated → Recommended → Accepted →
Implemented → Observed → Measured → Learning stored
```

```ts
type RecommendationLifecycleStage =
  | 'detected'    // Opportunity Discovery found it
  | 'scored'      // Economic Score + confidence assigned
  | 'simulated'   // Counterfactual run (§7N)
  | 'recommended' // Presented to the audience
  | 'accepted'    // Actor accepted
  | 'implemented' // Action taken (capability added, reserve opened, etc.)
  | 'observed'    // Post-implementation observation window
  | 'measured'    // ImpactMeasurement recorded
  | 'learned';    // Learning stored in Runtime Memory (§12)

interface RecommendationLifecycle {
  transition(id: string, to: RecommendationLifecycleStage, evidence?: EvidenceCitation): void;
  history(id: string): RecommendationLifecycleEvent[];
}

interface RecommendationLifecycleEvent {
  recommendationId: string;
  stage: RecommendationLifecycleStage;
  ts: number;
  evidence: EvidenceCitation[];
  note?: string;
}
```

The "learned" stage feeds Runtime Memory (§12): accepted+implemented recs
that generated +38% volume increase future confidence for that rec type;
rejected or no-improvement recs decrease it. The Runtime continuously learns
which recommendations actually create value.

---

## 7P. Financial Network Compiler *(v1.4 — the unifying abstraction)*

The Runtime is not routing — it is **compiling**. A merchant says "charge
customer 100 GHS"; the Runtime solves an optimization problem (which reserve,
which LPs, how many LPs, what FX path, what settlement plan, what collateral,
what capital allocation, what execution timing, whether future expected
traffic changes today's decision). That is compilation.

```
Intent → Compiler → Execution Plan → Runtime → Settlement
```

Exactly like:

```
Source Code → Compiler → Machine Code → CPU
```

The compiler is the heart of PaySwap. It unifies every engine under a single
mental model: **every engine is a compiler optimization pass.**

### Compilation phases (every engine is a pass)

```
Payment Intent
      ↓
  resolve identities       (Intent Engine)
      ↓
  policy pass              (Policy Engine)
      ↓
  compliance pass          (Compliance)
      ↓
  fraud pass               (Risk & Fraud Engine)
      ↓
  reserve optimization     (Reserve Engine + Reserve Market + Shadow Price)
      ↓
  liquidity optimization   (Liquidity Market + Strategy evaluation)
      ↓
  FX optimization          (FX path selection)
      ↓
  settlement planning      (Settlement Engine)
      ↓
  Execution Plan           (the compiler's output — "machine code")
      ↓
  Runtime executes         (Runtime Pipeline → Settlement)
```

### The Execution Plan — the compiler's output

The Execution Plan is a first-class artifact: a complete, executable financial
program. It is the "machine code" the Runtime executes.

```ts
interface ExecutionPlan {
  id: string;
  intentId: string;
  // The compiled decisions (one per pass):
  reserveAllocations: ReserveAllocation[];
  lpAllocations: LPAllocation[];
  fxHops: FXHop[];
  settlementLegs: SettlementLeg[];
  collateral: CollateralPlan;
  capitalAllocation: CapitalAllocation;
  executionTiming: ExecutionTiming;
  // The passes that produced this plan (for inspection/replay):
  passes: CompilationPassResult[];
  // Explainability:
  rationale: string;
  alternativesConsidered: ExecutionPlanAlternative[];
  estimatedCostBps: number;
  estimatedRisk: number;
  expectedProfitability: number;
  compiledAt: number;
}

interface CompilationPassResult {
  pass: CompilationPassName;
  decision: Decision;          // the universal explainability record
  durationMs: number;
}

type CompilationPassName =
  | 'resolve_identities' | 'policy' | 'compliance' | 'fraud'
  | 'reserve_optimization' | 'liquidity_optimization'
  | 'fx_optimization' | 'settlement_planning';
```

### The Financial Compiler contract

```ts
interface FinancialCompiler {
  /** Compile a TypedIntent into an Execution Plan. */
  compile(intent: TypedIntent, ctx: CompilerContext): Promise<ExecutionPlan>;
  /** Re-compile from a given pass (for partial replay / what-if). */
  recompileFrom(plan: ExecutionPlan, fromPass: CompilationPassName, ctx: CompilerContext): Promise<ExecutionPlan>;
  /** Compile under different assumptions (Digital Twin sandbox). */
  compileWithAssumptions(intent: TypedIntent, assumptions: WorldAssumptions): Promise<ExecutionPlan>;
}

interface CompilerContext {
  clock: RuntimeClock;
  knowledgeGraph: FinancialKnowledgeGraph;   // §7Q
  reserveMarket: ReserveMarket;
  liquidityStrategyMarketplace: LiquidityStrategyMarketplace;
  economicScore: EconomicScoreEngine;
  runtimeMemory: RuntimeMemory;
  environment: Environment;
}
```

### Digital Twin = Compiler Sandbox

The twin compiles using **different assumptions** — the same compiler,
different world state. This unifies simulation and production: a twin run is
the production compiler run against a sandbox world. "What if reserve GHS
were exhausted?" = compile the same intent with a `WorldAssumptions` mutation.

```ts
interface WorldAssumptions {
  reserveOverrides?: Record<string, Partial<ReserveMarketState>>;
  capabilityOverrides?: LPCapability[];
  fxOverrides?: Record<string, number>;
  scenarioId?: string;          // a Scenario from the Simulation Runtime
}
```

### Why this unifies everything

- Every engine (Policy, Compliance, Fraud, Reserve, Liquidity, FX, Settlement)
  is a **compiler pass** — not an independent island.
- The Execution Plan is the single handoff between "thinking" (compilation)
  and "doing" (execution). The Runtime Pipeline executes the plan; it does
  not re-decide.
- The Inspector renders the plan + every pass's Decision.
- Replay = recompile from a pass. What-if = compile with assumptions.
- The twin = the compiler in a sandbox. Sim = prod, structurally.

---

## 7Q. Financial Knowledge Graph *(v1.4 — the root graph)*

Five graphs exist (Capability, Route, Liquidity, Resource, Economic), but
relationships span them:

```
LP A  ──supports──→  Twin GHS
LP A  ──supports──→  Instant Settlement
LP A  ──owns──→      Reserve R
LP A  ──connects──→  Connector X
LP A  ──serves──→    Merchant M
```

That query traverses Capability, Reserve, Economic, Route, and Opportunity
graphs. You don't want five graph APIs — you want **one knowledge graph with
multiple projections.**

```ts
interface FinancialKnowledgeGraph {
  // The five projections (each is a view over the same underlying graph):
  capability(): CapabilityGraph;
  route(): RouteGraph;
  liquidity(): LiquidityGraphQuery;
  resource(): ResourceGraphQuery;
  economic(): EconomicGraphQuery;

  // Cross-graph queries no individual graph can answer:
  query(q: KnowledgeQuery): Promise<KnowledgeQueryResult>;

  // "Which LPs could become profitable if Treasury opened an XOF reserve?"
  //   → traverses Capability → Reserve → Economic → Route → Opportunity
  whatIf(opensReserve: string): Promise<{ lpId: string; projectedProfitability: number }[]>;
}

interface KnowledgeQuery {
  subject: string;                 // "lp:Acacia"
  relationships: string[];         // ['supports', 'owns', 'connects', 'serves']
  traverse: GraphProjection[];     // ['capability', 'reserve', 'economic', 'route', 'opportunity']
  filter?: Record<string, unknown>;
}

type GraphProjection = 'capability' | 'route' | 'liquidity' | 'resource' | 'economic' | 'opportunity';

interface KnowledgeQueryResult {
  subject: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  derivedFacts: { claim: string; evidence: EvidenceCitation[]; confidence: number }[];
}
```

The Financial Knowledge Graph is the **single source of truth** the Financial
Compiler reads at compile time (§7P's `CompilerContext.knowledgeGraph`). All
five projections are views over it; cross-graph queries power Opportunity
Discovery, LP/Treasury Growth, and Counterfactual evaluation.

---

## 7R. Recommendation as Protocol Object *(v1.4 — first-class citizen)*

Recommendations are not merely objects — they are **Protocol Objects** with
identity, lifecycle, and learnability. First-class citizens: searchable,
versionable, assignable, discussable, acceptable, rejectable, measurable,
and learnable.

```
Recommendation
  ↓ Proposal      (detected + scored + simulated)
  ↓ Decision      (accepted or rejected, with reason)
  ↓ Acceptance    (assigned to an actor + deadline)
  ↓ Implementation (action taken — capability added, reserve opened, etc.)
  ↓ Outcome       (observed post-implementation)
  ↓ Learning      (measured impact → Runtime Memory confidence adjustment)
```

The Recommendation type (Final Amendment §7B) already carries identity +
lifecycle + measuredImpact. v1.4 makes the **Protocol Object** semantics
explicit: every Recommendation is searchable, versionable, assignable,
discussable, and its Learning feeds Runtime Memory (§12) so the Runtime
continuously learns which recommendation types create real value.

---

## 7S. The 18 Permanent Primitives *(v1.4 — the frozen canonical set)*

The Constitution freezes around these 18 permanent primitives. **Everything
else** is a plugin, strategy, optimizer, graph projection, or compiler pass
built on top of these — never a change to the Constitution itself.

| # | Primitive | Role |
|---|---|---|
| 1 | **Intent Engine** | Ingests a raw request → typed Intent (the universal input) |
| 2 | **Financial Compiler** | Compiles an Intent → Execution Plan via optimization passes (§7P) |
| 3 | **Runtime Pipeline** | Executes an Execution Plan through the 14 stages |
| 4 | **Settlement Engine** | Moves value to fulfill obligations (the product) |
| 5 | **Reserve Engine** | Locks/releases/mints/burns reserves; publishes Reserve Market State + Shadow Price |
| 6 | **Liquidity Market** | LPs publish strategies + pricing curves; market clears; winner executes |
| 7 | **Treasury Intelligence** | Capital Allocator + Treasury Growth Engine |
| 8 | **Economic Intelligence** | Liquidity Intelligence + Opportunity Discovery + Economic Score |
| 9 | **Decision Engine** | Universal explainability record (9+ dimensions) |
| 10 | **Policy Engine** | Explicit, evaluable rules gating execution |
| 11 | **Event Store** | Append-only source of truth (audit/replay/sim/debug/inspect) |
| 12 | **Projection Engine** | Subscribes to events → writes read models (immediate) |
| 13 | **Runtime Memory** | Learned operational facts + recommendation learning |
| 14 | **Protocol Inspector** | Expandable trace tree per execution |
| 15 | **Financial Knowledge Graph** | Root over all 5 graphs; cross-graph queries (§7Q) |
| 16 | **Digital Twin** | Autonomous 24/7 sandbox world + counterfactual evolution |
| 17 | **Recommendation Lifecycle** | 9-stage protocol-object lifecycle with learning |
| 18 | **Runtime Clock** | Virtual time; sandbox 10×/100×/1000×; Time Machine |

**The rule:** any future capability must be expressible as one of: a compiler
pass, a graph projection, a plugin, a strategy, or an optimizer built on
these 18 primitives. The primitives themselves do not change.

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
| **Economic operating system** *(Am2)* | payment runtime | **full** (Economic Intelligence Runtime + Economic Health Dashboard + LP/Reserve Advisors + 12 Opportunity kinds + measured Recommendations) |
| **Network self-improvement** *(Am2)* | absent | **full** (two feedback loops: execution → network learns → recommendations → better network tomorrow) |
| **Multi-hop composition** *(Am2)* | absent | **designed** (architecture supports it; implementation deferred to M-RT-16) |
| **Economic Discovery & Network Evolution** *(Final)* | absent | **full** (three responsibilities; Capability/Route Graph split; Capability/Corridor/Reserve Discovery; LP/Treasury Growth Engines; Economic Score; Counterfactual; 9-stage Recommendation Lifecycle with learning) |
| **Self-evolving network** *(Final)* | absent | **full** (the Runtime discovers what's missing and grows the network itself; it is an economic network that evolves itself) |
| **Financial compilation** *(v1.4)* | routing | **full** (Financial Network Compiler; every engine is a compiler pass; Intent → Execution Plan → Runtime) |
| **Unified knowledge graph** *(v1.4)* | 5 separate graphs | **full** (Financial Knowledge Graph root; cross-graph queries) |
| **Coordination** *(v1.4)* | absent | **full** (fourth Runtime responsibility; coordinates independent economic actors toward shared outcomes) |

The architecture no longer optimizes for Stripe parity. It is an **economic
network that can evolve itself** with clear principles: intent first, four
runtimes, a virtual clock, an autonomous economic twin with counterfactual
evolution, learned memory (including liquidity memory and recommendation
learning), three graphs (Resource + Economic + Capability/Route), reserve-
aware routing optimizing overall network value, a liquidity strategy
marketplace, universal explainability, and continuous economic discovery.
Stripe remains the benchmark for developer experience; PaySwap differentiates
through programmable settlement, liquidity orchestration, transparent
execution, simulation, explainability, and **network self-evolution** —
capabilities Stripe, Paystack, Flutterwave, and today's DEXs do not expose
in this combination.

The remaining gap to 100% is external systems (real Stellar mainnet, real
bank APIs, real KYC, regulatory licensing) — explicitly out of scope for
application architecture.

---

## 26. Runtime Constitution PERMANENTLY FROZEN (v1.4 True Final Freeze applied).

The v1.4 True Final Freeze is applied. The Runtime Constitution is **frozen
permanently** as the v1.4 edition. The architecture is frozen around the
**18 permanent primitives** (§7S): Intent Engine, Financial Compiler, Runtime
Pipeline, Settlement Engine, Reserve Engine, Liquidity Market, Treasury
Intelligence, Economic Intelligence, Decision Engine, Policy Engine, Event
Store, Projection Engine, Runtime Memory, Protocol Inspector, Financial
Knowledge Graph, Digital Twin, Recommendation Lifecycle, Runtime Clock.

The v1.4 additions — the **Financial Network Compiler** (the unifying
abstraction; every engine is a compiler pass), the **Financial Knowledge
Graph** (the root over all five graphs), **Recommendation as a Protocol
Object** (identity + lifecycle + learning), and the **fourth responsibility:
Coordinate** — close the last conceptual gap. The Runtime is now a
**compiling, coordinating, self-evolving financial network**.

**No further architectural redesigns — ever.** All future work must fit
within the 18 primitives, implemented as compiler passes, graph projections,
plugins, strategies, or optimizers **within** the Constitution. The
Constitution itself does not change. The remaining risks are execution
risks: implementing the compiler incrementally without disrupting existing
behavior, validating economic algorithms with real data, proving reserve-
aware routing and LP market clearing under load, and hardening for production
scale. The fastest way to improve the design now is to build it, measure it,
and let operational experience inform future plugins — not change the
Constitution.

**M-RT-1 is already built** (with Amendment 1, 2, and Final Amendment
interfaces). The skeleton now needs the v1.4 interfaces added (Financial
Compiler, Execution Plan, Financial Knowledge Graph, enriched Recommendation
Protocol Object) — all interface-only, no business logic — then
implementation resumes at **M-RT-2: Capability Graph** (the first economic-
network milestone, per the reordered roadmap). The payments vertical slice
(M-RT-12) will compile through the Financial Compiler.

*The Runtime executes financial intents, optimizes execution, coordinates
independent economic actors, and continuously evolves the financial network
— compiling every intent into an explainable execution.*

---

*End of v1.4 Runtime Constitution (True Final Freeze). Architecture PERMANENTLY frozen around 18 primitives. No further redesigns — ever.*
