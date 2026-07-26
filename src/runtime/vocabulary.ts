/**
 * The frozen Runtime Vocabulary. Every term has a fixed meaning across every
 * document, API, SDK, UI, extension, and AI agent.
 *
 * From PROTOCOL-RUNTIME-ARCHITECTURE.md → "Runtime Vocabulary (Frozen)".
 * Terminology never drifts.
 */

export interface VocabTerm {
  term: string;
  meaning: string;
}

export const RUNTIME_VOCABULARY: readonly VocabTerm[] = [
  { term: 'Intent', meaning: 'A typed desire to perform a financial operation. The universal input. Never executed directly — normalized, resolved, validated, then handed to the pipeline.' },
  { term: 'Command', meaning: 'The internal execution primitive (kernel). A Command is produced from a validated Intent; it expresses "do X", not "I want Y".' },
  { term: 'Decision', meaning: 'A recorded, explainable artifact produced by every decision-producing stage. Answers Why / Why-not / Alternative / Evidence / Confidence / Policy / Cost / Risk.' },
  { term: 'Policy', meaning: 'An explicit, evaluable rule that gates execution (can-settle / can-mint / can-refund / can-release / can-retry). Data, not hardcoded branches.' },
  { term: 'Workflow', meaning: 'A declared, multi-step, resumable operation with compensation. Sub-commands flow through the same pipeline.' },
  { term: 'Execution', meaning: 'The act of running a validated Intent through the pipeline to completion or declared failure.' },
  { term: 'Settlement', meaning: 'The movement of value to fulfill an obligation. The product. Every money movement flows through the Settlement Engine.' },
  { term: 'Reserve', meaning: 'Fiat collateral backing twin tokens and operations. Locked, released, minted against, burned. Owned by the Reserve Engine.' },
  { term: 'Liquidity', meaning: 'LP-provided capital offered in a market. LPs publish strategies; the market clears; the winner executes.' },
  { term: 'Treasury', meaning: "PaySwap's own capital position. Optimized (not just displayed) across corridors, LPs, FX, float, yield, risk." },
  { term: 'Projection', meaning: 'A function that subscribes to Domain Events and writes a read model. The only writer of read-model tables.' },
  { term: 'Read Model', meaning: 'A query façade over projection-maintained tables. The only thing interfaces read. Never the Event Store.' },
  { term: 'Event', meaning: 'An immutable recorded fact. Domain Event = business state (replayed). Runtime Event = operational (not replayed).' },
  { term: 'Behavior', meaning: 'A named pattern an actor exhibits that produces Intents per tick (MorningRush, SalaryDay, Aggressive, …). Not a random probability.' },
  { term: 'Scenario', meaning: "A first-class versioned object describing a world's initial conditions and evolution rules." },
  { term: 'Actor', meaning: 'A participant in a scenario (merchant, customer, LP, connector). Actors own behaviors.' },
  { term: 'Resource Graph', meaning: 'The business-object graph (Payment → Refund → Invoice → Customer → Merchant → Subscription → Dispute).' },
  { term: 'Economic Graph', meaning: 'The money graph (Reserve → LP → Wallet → Treasury → FX → Settlement → Escrow → TwinToken).' },
  { term: 'Protocol Trace', meaning: 'The expandable tree of every stage, decision, event, and connector call for one execution. Powers the Inspector.' },
  { term: 'Runtime Memory', meaning: 'The structured store of learned operational facts (corridor congestion, LP reliability, …). Consulted, not obeyed.' },
  { term: 'Twin', meaning: 'The autonomous 24/7 sandbox world (SimCity model). A runtime client, not a parallel universe.' },
  { term: 'Environment', meaning: 'sandbox or live. Same runtime, same code; only data, connectors, credentials, and clock differ.' },
  { term: 'Connector', meaning: 'A uniform driver implementing authorize / capture / refund / webhook / health / capabilities.' },
  { term: 'Runtime Clock', meaning: 'The virtual clock. Everything reads clock.now(), never Date.now(). Live = 1× real time; sandbox = 10×/100×/1000×.' },
  // Amendment 1 terms:
  { term: 'Liquidity Intelligence', meaning: 'The continuous engine that analyzes the liquidity network and improves it. Answers why corridors are expensive, which reserves are exhausted, where LPs should deploy capital.' },
  { term: 'Opportunity Discovery', meaning: 'The continuous search for missing corridors, LP opportunities, treasury opportunities, and connector gaps. Produces Recommendations.' },
  { term: 'Reserve Shadow Price', meaning: 'The internal opportunity cost of consuming one more unit of a reserve. An optimization signal, not customer pricing. Routing minimizes (execution cost + shadow price + capital cost + risk cost).' },
  { term: 'Reserve Market State', meaning: 'The continuously-published state of a reserve: available, locked, utilization, forecast depletion, refill rate, capital cost, risk, confidence, shadow price. A runtime input, not a dashboard metric.' },
  { term: 'Liquidity Graph', meaning: 'The third graph. Nodes: LPs, corridors, currencies, twin currencies, reserves, connectors. Edges carry capacity/cost/risk/latency/confidence/profitability/availability. Opportunity Discovery operates on it.' },
  { term: 'Liquidity Strategy', meaning: 'A programmable strategy an LP publishes alongside liquidity ("Maximize yield", "Only operate when reserve utilization < 60%"). Strategies are evaluated during market clearing.' },
  { term: 'Recommendation', meaning: 'A first-class runtime object advising an actor (merchant/LP/treasury/ops/compliance/developer) to act. Versioned, explainable, actionable.' },
  { term: 'Liquidity Memory', meaning: 'Runtime Memory facts specific to liquidity: LP congestion windows, reserve depletion cycles, connector recovery times, corridor concentration, FX spread patterns, missed opportunities.' },
  // Amendment 2 terms:
  { term: 'Economic Intelligence Runtime', meaning: 'The renamed Economic Runtime. Its responsibility is no longer merely routing money — it optimizes the entire financial network: which LPs should exist, which reserves should grow, which corridors are under-served, which bridges are missing.' },
  { term: 'Economic Health', meaning: 'A first-class Runtime surface (the operating console of the financial network). Shows network efficiency, unused liquidity, idle reserves, utilization, concentration, capital velocity, route efficiency, missed revenue, lost volume, optimization backlog, recommendation impact. Not analytics — the operating console.' },
  { term: 'Multi-hop Liquidity Composition', meaning: 'A payment route may compose across multiple LPs and reserve pools (Buyer→LP A→LP B→LP C→Merchant). The architecture supports it; implementation deferred to M-RT-14.' },
  { term: 'Missing Bridge', meaning: 'An Opportunity Discovery kind: a liquidity link between two nodes (e.g. Twin GHS→Twin XOF) whose absence forces extra settlement hops. Building it eliminates hops and unlocks composite routes.' },
  // Final Amendment terms:
  { term: 'Economic Discovery', meaning: 'The third Runtime responsibility: continuously discovering missing liquidity, missing reserves, missing corridors, missing FX bridges, missing LP capabilities, idle capital, capital bottlenecks, and profitable expansion opportunities — and transforming them into executable recommendations.' },
  { term: 'Network Evolution', meaning: 'The liquidity network is modeled as an evolving ecosystem, not a static graph. LPs join/leave, reserves grow/shrink, corridors appear/disappear, demand shifts. The Runtime models and drives this evolution.' },
  { term: 'Capability Graph', meaning: "What each LP CAN do (e.g. LP A supports GHS→Twin GHS). Every capability is an explicit, discoverable object. The source of truth for 'what's possible.' Split from the Liquidity Graph in the Final Amendment." },
  { term: 'Route Graph', meaning: "What routes currently exist. Generated FROM the Capability Graph, never manually maintained. The source of truth for 'what's routable right now.' Split from the Liquidity Graph in the Final Amendment." },
  { term: 'Capability Discovery', meaning: 'The Runtime continuously asks "what capability is missing?" — detects latent capabilities an LP could expose and generates recommendations.' },
  { term: 'Corridor Discovery', meaning: 'The Runtime discovers corridors that do not yet exist (demand with no direct route), proposes composite paths, and recommends opening with quantified estimates.' },
  { term: 'Reserve Discovery', meaning: 'The Runtime discovers new reserve pools that should exist (open Twin XOF reserve, $200k, +$18k/mo, +$2.1M throughput, 92% confidence).' },
  { term: 'LP Growth Engine', meaning: 'A first-class Runtime engine whose job is growing LP businesses — next corridor, next reserve, pricing strategy, missing capability, connector integration, utilization target, available yield.' },
  { term: 'Treasury Growth Engine', meaning: 'A first-class Runtime engine giving treasury growth recommendations — capital deployment, reserve expand/shrink, corridor bootstrap, temporary LP role, LP incentivization.' },
  { term: 'Economic Score', meaning: 'A per-corridor score (demand/supply/competition/capital-efficiency/reserve-health/risk/latency/profitability/growth) that powers BOTH routing AND recommendations.' },
  { term: 'Counterfactual', meaning: 'A what-if simulation comparing the Current Network vs an Alternative Network across revenue/volume/latency/capital/reserve-utilization. Powers the Digital Twin counterfactual evolution and the Recommendation "Simulated" lifecycle stage.' },
  { term: 'Recommendation Lifecycle', meaning: 'The 9-stage lifecycle of a Recommendation: Detected → Scored → Simulated → Recommended → Accepted → Implemented → Observed → Measured → Learning stored. The Runtime learns which recommendation types create real value.' },
  // v1.4 True Final Freeze terms:
  { term: 'Financial Network Compiler', meaning: 'The unifying abstraction above the engines. Turns a business Intent into an executable Execution Plan through a sequence of optimization passes. Every engine is a compiler optimization pass. Intent → Compiler → Execution Plan → Runtime → Settlement, exactly like Source Code → Compiler → Machine Code → CPU.' },
  { term: 'Execution Plan', meaning: "The Financial Compiler's output — the 'machine code' the Runtime executes. A complete, executable financial program: which reserves, which LPs, how many, what FX path, what settlement plan, what collateral, what capital allocation, what execution timing." },
  { term: 'Compilation Pass', meaning: 'One stage of the Financial Compiler. Each existing engine (Policy, Compliance, Fraud, Reserve, Liquidity, FX, Settlement) is a compilation pass: resolve identities → policy → compliance → fraud → reserve optimization → liquidity optimization → FX optimization → settlement planning → Execution Plan.' },
  { term: 'Financial Knowledge Graph', meaning: 'The single root graph containing all five existing graphs (Capability, Route, Liquidity, Resource, Economic). Answers cross-graph queries no individual graph can. The single source of truth the Financial Compiler reads at compile time.' },
  { term: 'Coordinate', meaning: 'The fourth Runtime responsibility (Execute / Optimize / Coordinate / Evolve). The Runtime coordinates independent economic actors (LPs, Treasury, banks, merchants, connectors, regulators, customers, reserves, FX providers) toward shared outcomes.' },
  { term: 'Protocol Object', meaning: 'A first-class runtime citizen with identity, lifecycle, and learnability. Recommendations are Protocol Objects: searchable, versionable, assignable, discussable, acceptable, rejectable, measurable, and learnable.' },
] as const;

export const VOCABULARY_TERMS = RUNTIME_VOCABULARY.map((t) => t.term);
