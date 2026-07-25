/**
 * PaySwap Protocol — Real Liquidity Network (Task 3-D).
 *
 * Core types for the liquidity network that replaces the mocked LP selection.
 * LPs are real actors with real capacity, real corridor pricing, dynamic
 * spreads, competition, routing optimization, reserve exhaustion handling,
 * capacity reservation/release, LP health/availability/scoring, historical
 * success weighting (from settlement events), and liquidity forecasting.
 *
 * Constraints honored:
 *  - Kernel is FROZEN — no imports modify kernel state.
 *  - All NEW code lives in src/protocol/liquidity-network/ — old
 *    src/protocol/liquidity/marketplace.ts is left 100% intact.
 *  - LP scoring uses REAL settlement outcomes (via updateReputationFromOutcome
 *    which is fed by settlement events emitted through the kernel's
 *    eventEngine), not static numbers.
 */

/** LP identifier (matches kernel entity id namespace). */
export type LPId = string;

/**
 * Corridor — a directed currency pair an LP serves. E.g. {GHS → KES} means the
 * LP can deliver GHS on the buy side and receive KES on the sell side.
 */
export interface Corridor {
  fromCurrency: string;
  toCurrency: string;
}

/**
 * Stable, comparable string key for a corridor.
 * `corridorKey({fromCurrency:'GHS', toCurrency:'KES'})` → `'GHS→KES'`.
 */
export function corridorKey(c: Corridor): string {
  return `${c.fromCurrency}→${c.toCurrency}`;
}

/** Parse a corridor key back into a Corridor. */
export function parseCorridorKey(key: string): Corridor {
  const [fromCurrency, toCurrency] = key.split('→');
  return { fromCurrency, toCurrency };
}

/**
 * LP lifecycle state — narrowed to the states relevant to the liquidity
 * network. The kernel's LPLifecycle has a richer state machine (invited,
 * pending, active, paused, draining, withdraw_requested, exited, suspended,
 * slashed); only `active | paused | draining` are visible here because routing
 * only ever selects `active` LPs and treats `paused | draining` as
 * unavailable.
 */
export type LPNetworkState = 'active' | 'paused' | 'draining';

/**
 * LPRecord — the network's view of an LP. This is INDEPENDENT of the kernel's
 * LPRecord (src/protocol/lp-lifecycle-manager.ts) because the network tracks
 * capacity per corridor, reserved capacity, fee/spread, settlement speed and a
 * historical success rate derived from real settlement events — none of which
 * are in the kernel's record. The network's LPRecord can be reconciled with the
 * kernel's record by id (they share the same LPId namespace).
 */
export interface LPRecord {
  id: LPId;
  name: string;
  country: string;
  corridors: Corridor[];
  state: LPNetworkState;
  /** Total capacity the LP has staked per corridor (raw, in `fromCurrency` units). */
  capacity: Record<string, number>; // corridorKey → amount
  /** Capacity currently free for new reservations (= capacity − reserved − consumed). */
  availableCapacity: Record<string, number>;
  /** Capacity currently reserved by in-flight reservations. */
  reservedCapacity: Record<string, number>;
  /** Reputation in 0..1 — derived from historical settlement outcomes. */
  reputation: number;
  /** Tier label: 'premium' | 'trusted' | 'standard' | 'probationary'. */
  tier: string;
  /** Base fee in basis points. */
  feeBps: number;
  /** Average settlement latency, ms. */
  settlementSpeedMs: number;
  /** Rolling success rate (0..1) computed from real settlement outcomes. */
  historicalSuccessRate: number;
  /** Total volume ever settled by this LP (in `fromCurrency` units). */
  totalVolume: number;
  /** Total count of settlements (success or failure) this LP has handled. */
  totalSettlements: number;
  /** Timestamp of last settlement, or null if none. */
  lastSettlementTs: number | null;
  /** When the LP joined the network (ms epoch). */
  joinedAt: number;
}

/**
 * CapacityQuote — an LP's quote for a specific corridor + amount. Carries the
 * evidenceId of the capacity backing evidence so the kernel can audit "why did
 * we route through this LP? Because of Evidence #123".
 */
export interface CapacityQuote {
  lpId: LPId;
  corridor: Corridor;
  maxAmount: number;
  availableAmount: number;
  feeBps: number;
  spreadBps: number;
  estimatedSettlementMs: number;
  expiryTs: number;
  evidenceId: string;
}

/**
 * RoutingPlan — the output of the routing optimizer. Each route entry pairs an
 * LP with a share (0..1) and amount in `fromCurrency` units. The plan
 * aggregates total fee, settlement time, confidence, cost and reserve
 * exhaustion risk so callers can choose between alternatives.
 */
export interface RoutingPlan {
  id: string;
  corridor: Corridor;
  amount: number;
  route: {
    lpId: LPId;
    share: number;       // 0..1, sum of shares = 1
    amount: number;      // share * plan.amount
    feeBps: number;
  }[];
  totalFeeBps: number;
  estimatedSettlementMs: number;
  confidence: number;             // 0..1 — weighted by reputation × capacity coverage
  estimatedCost: number;          // amount * totalFeeBps / 10_000
  reserveExhaustionRisk: number;  // 0..1 — probability route can't fill
}

/**
 * LPHealth — rolling health snapshot for an LP. `healthy` is the conjunction
 * of "consecutiveFailures < 3" and "windowed success rate > 0.8".
 */
export interface LPHealth {
  lpId: LPId;
  healthy: boolean;
  latencyMs: number;
  successRateWindowed: number;
  consecutiveFailures: number;
  lastFailureTs: number | null;
  /** Composite 0..1 score used by routing as a reliability penalty. */
  score: number;
}

/**
 * LPScore — multi-component score for an LP. Each component is 0..1; the
 * composite `score` is a weighted sum (weights configurable in scoring.ts).
 */
export interface LPScore {
  lpId: LPId;
  score: number;
  components: {
    capacity: number;
    pricing: number;
    speed: number;
    reliability: number;
    reputation: number;
  };
}

/**
 * ForecastPoint — one point in a forecast horizon. `shortfall > 0` means
 * projected demand exceeds projected supply at time `ts`.
 */
export interface ForecastPoint {
  ts: number;
  corridor: Corridor;
  projectedDemand: number;
  projectedSupply: number;
  shortfall: number;
  confidence: number;
}

/** Default TTL for a capacity reservation (60 seconds). */
export const DEFAULT_RESERVATION_TTL_MS = 60_000;

/** Default TTL for a price quote (10 seconds — pricing is dynamic). */
export const DEFAULT_QUOTE_TTL_MS = 10_000;

/** Maximum number of LPs to split a route across by default. */
export const DEFAULT_MAX_LPS_PER_ROUTE = 5;

/** Rolling window size for windowed success rate. */
export const DEFAULT_HEALTH_WINDOW = 20;

/** Number of consecutive failures that flips an LP to unhealthy. */
export const UNHEALTHY_CONSECUTIVE_FAILURES = 3;

/** Minimum windowed success rate to be considered healthy. */
export const UNHEALTHY_SUCCESS_RATE_THRESHOLD = 0.8;

/** Maximum reputation (cap). */
export const MAX_REPUTATION = 1.0;

/** Minimum reputation (floor). */
export const MIN_REPUTATION = 0.0;
