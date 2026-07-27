/**
 * Economic Kernel — barrel. (M-RT-25, Economic Kernel.)
 *
 * Public surface:
 *   - TwinTokenProjection — 4 token types (claim, settlement, reserve, liquidity)
 *   - LPRuntimeProjection — LPs as first-class runtime actors
 *   - EconomicMarketplace — LP auction mechanism
 *   - EconomicCompiler   — produces economic execution plans
 *   - Types              — TwinTokenPosition, LPProfile, LPOffer, etc.
 */

export * from './twin-token-types';
export { TwinTokenProjection } from './twin-token-projection';
export * from './lp-runtime';
export { EconomicMarketplace } from './marketplace';
export type { LiquidityRequest, MarketplaceResponse, ExecutionCandidate } from './marketplace';
export { EconomicCompiler } from './compiler';
export type { EconomicExecutionPlan, EconomicStep, EconomicIntent } from './compiler';
