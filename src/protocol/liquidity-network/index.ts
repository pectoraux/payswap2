/**
 * Liquidity Network — barrel export.
 *
 * Public API for the real liquidity network (Task 3-D). This module replaces
 * the mocked LP selection in src/protocol/liquidity/marketplace.ts.
 *
 * Usage:
 *   import { liquidityNetwork } from '@/protocol/liquidity-network';
 *
 *   liquidityNetwork.registerLP({ id: 'lp1', name: 'Acacia', country: 'Kenya',
 *     corridors: [{fromCurrency:'GHS', toCurrency:'KES'}],
 *     capacity: {'GHS→KES': 50_000}, feeBps: 80 });
 *
 *   const plan = liquidityNetwork.getQuote({fromCurrency:'GHS', toCurrency:'KES'}, 5000);
 *   if (plan) {
 *     const exec = liquidityNetwork.executeRoute(plan);
 *     if (exec.success) {
 *       liquidityNetwork.settleRoute(plan, plan.id, [
 *         { lpId: plan.route[0].lpId, success: true, settlementMs: 3000, amount: 5000 }
 *       ]);
 *     }
 *   }
 */

// Types
export type {
  LPId,
  Corridor,
  LPNetworkState,
  LPRecord,
  CapacityQuote,
  RoutingPlan,
  LPHealth,
  LPScore,
  ForecastPoint,
} from './types';

export {
  corridorKey,
  parseCorridorKey,
  DEFAULT_RESERVATION_TTL_MS,
  DEFAULT_QUOTE_TTL_MS,
  DEFAULT_MAX_LPS_PER_ROUTE,
  DEFAULT_HEALTH_WINDOW,
  UNHEALTHY_CONSECUTIVE_FAILURES,
  UNHEALTHY_SUCCESS_RATE_THRESHOLD,
  MAX_REPUTATION,
  MIN_REPUTATION,
} from './types';

// Registry
export { LiquidityRegistry, liquidityRegistry, type LPRecordPatch, type RegisterLPParams } from './registry';

// Capacity
export {
  CapacityReservationStore,
  capacityReservations,
  reserveCapacity,
  releaseCapacity,
  consumeCapacity,
  replenishCapacity,
  releaseAllForLp,
  getAvailableCapacity,
  type Reservation,
  type ReservationResult,
} from './capacity';

// Pricing
export {
  quotePrice,
  quoteCapacity,
  computeSpread,
  getMarketSpread,
  compete,
  type PriceQuote,
  type MarketSpread,
  type CompeteBid,
} from './pricing';

// Routing
export { findBestRoute, optimizePlan, canFillSingleLP, totalAvailableCapacity, type RoutingOpts } from './routing';

// Scoring
export {
  scoreLP,
  rankLPs,
  updateReputationFromOutcome,
  setWeights,
  getWeights,
  DEFAULT_WEIGHTS,
  type ScoreWeights,
} from './scoring';

// Health
export { LPHealthMonitor, lpHealthMonitor } from './health';

// Forecast
export {
  LiquidityForecaster,
  liquidityForecaster,
  DEFAULT_FORECAST_HORIZON_MS,
  DEFAULT_FORECAST_BUCKET_MS,
} from './forecast';

// Network facade
export {
  LiquidityNetwork,
  liquidityNetwork,
  type LPSettlementOutcome,
  type ExecuteRouteResult,
  type SettleRouteResult,
  type NetworkStatus,
} from './network';
