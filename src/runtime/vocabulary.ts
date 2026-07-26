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
] as const;

export const VOCABULARY_TERMS = RUNTIME_VOCABULARY.map((t) => t.term);
