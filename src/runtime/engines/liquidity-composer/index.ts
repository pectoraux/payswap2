/**
 * Liquidity Composer — barrel. (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * Public surface:
 *   - LiquidityComposer   — the orchestrator (compose(request, graph) → plan)
 *   - buildGraph          — build a LiquidityGraph from LP offers + bridges
 *   - findPaths           — bounded DFS pathfinder (max 4 hops, no cycles)
 *   - optimizeSplit       — split optimizer (greedy: cost + resilience benefit)
 *   - rankPaths           — score + rank paths by cost/latency/risk/reliability
 *   - decomposeCost       — cost decomposition (reuses existing model)
 *
 * The composer is additive to the Financial Compiler. The compiler's API is
 * UNCHANGED — it can call `composer.compose(request, graph)` to get candidate
 * plans, then select the winner using its existing scoring logic.
 */

export * from './types';
export { buildGraph, outgoingEdges, allCurrencies, edgeCount } from './graph';
export type { LPOfferInput, ReserveBridgeInput, GraphBuildInputs } from './graph';
export { findPaths, buildPath, DEFAULT_MAX_HOPS } from './pathfinder';
export { decomposeCost, scorePath, rankPaths } from './optimizer';
export { optimizeSplit } from './splitter';
export { LiquidityComposer } from './composer';
