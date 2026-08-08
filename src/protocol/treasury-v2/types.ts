/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Types.
 *
 * The treasury is PaySwap's financial control tower. It:
 *   - Monitors reserves in real time (per currency)
 *   - Enforces mint/burn limits (24h rolling window + per-tx + cooldown)
 *   - Verifies stablecoin backing (TWIN<CCY> 1:1 fiat-backed invariant)
 *   - Forecasts corridor liquidity (moving average + trend)
 *   - Manages corridor funding (auto-rebalance between corridors)
 *   - Tracks LP profitability (volume / revenue / cost / PnL / margin / APY)
 *   - Stress-tests reserve resilience (corridor drain, LP default, depeg, reserve loss)
 *   - Generates daily treasury reports
 *
 * Every mint goes through `preMintHook` which checks (in order):
 *   1. daily limit (24h rolling)
 *   2. per-tx limit
 *   3. backing sufficiency
 *   4. freeze status
 * If any check fails, the mint is blocked.
 *
 * Design notes:
 *  - All identifiers are opaque strings (`assetCode`, `currency`, `lpId`,
 *    `corridorId`, …).
 *  - Timestamps are epoch milliseconds (`Date.now()`).
 *  - All monetary amounts are plain numbers in the smallest representable
 *    unit (currency-native; e.g. GHS amount `100.50` = 100.50 GHS).
 *  - Status / state unions are string-literal types so the audit trail is
 *    self-describing.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs`, `round`
 * from `@/kernel/support` and `eventEngine` from `@/kernel/event`. No
 * kernel files are modified.
 */

// ---------------------------------------------------------------------------
// Reserve accounts
// ---------------------------------------------------------------------------

/**
 * A reserve account is the treasury's holdings of a single currency.
 *
 *  - `balance`    — gross balance (everything we hold).
 *  - `reserved`   — portion already committed to in-flight settlements
 *                   / escrows / corridor funding obligations.
 *  - `available`  — `balance - reserved`; freely spendable.
 *  - `backingRatio` — for stablecoin-backed currencies, the ratio of
 *                   fiat reserves available to circulating Twin Token
 *                   supply (1.0 = 100% backed). For non-stablecoin
 *                   reserves this is `1.0` by convention.
 *  - `lastReconciledTs` — last time on-chain balance was reconciled
 *                   against the local view.
 */
export interface ReserveAccount {
  currency: string;
  /** Mirror of the TWIN<CCY> asset code (e.g. TWINGHS). Optional —
   * populated by the v2 reserve-monitor for convenience, omitted by the
   * legacy reserve.ts implementation. Callers should not rely on this
   * field being present; derive it via `TWIN${currency}` when absent. */
  assetCode?: string;
  balance: number;
  reserved: number;
  available: number;
  lastReconciledTs: number;
  backingRatio: number;
}

// ---------------------------------------------------------------------------
// Mint / Burn limits
// ---------------------------------------------------------------------------

/**
 * Per-asset mint limit configuration + 24h rolling usage state.
 *
 * The rolling window resets when `now - windowStartTs >= 24h`. After
 * reset, `dailyUsed` returns to 0 and `windowStartTs` advances to `now`.
 *
 *  - `perTxLimit`   — hard cap on a single mint.
 *  - `cooldownMs`   — minimum gap between consecutive mints (0 = no
 *                     cooldown).
 *  - `lastMintTs`   — last mint timestamp (for cooldown enforcement).
 */
export interface MintLimit {
  assetCode: string;
  dailyLimit: number;
  dailyUsed: number;
  windowStartTs: number;
  perTxLimit: number;
  cooldownMs: number;
  lastMintTs: number;
}

/**
 * Per-asset burn limit configuration + 24h rolling usage state.
 *
 * Burns are typically less risky than mints (burning reduces supply
 * which is always backed), but we still cap them to detect anomalous
 * burn spikes (e.g. a compromised issuer account).
 */
export interface BurnLimit {
  assetCode: string;
  dailyLimit: number;
  dailyUsed: number;
  windowStartTs: number;
  perTxLimit: number;
}

/** Outcome of a mint/burn check. */
export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  remainingDaily?: number;
  nextAllowedTs?: number;
}

// ---------------------------------------------------------------------------
// Corridor funding
// ---------------------------------------------------------------------------

/** A corridor is identified by a `{ from, to }` country pair. */
export interface CorridorId {
  from: string;
  to: string;
}

/** Human-readable corridor key. */
export function corridorKey(c: CorridorId): string {
  return `${c.from}->${c.to}`;
}

/**
 * Per-corridor reserve target. The treasury auto-rebalances when actual
 * corridor reserves drift outside the `[minReserve, maxReserve]` band
 * beyond `rebalanceThreshold`.
 */
export interface CorridorTarget {
  corridor: CorridorId;
  targetReserve: number;
  minReserve: number;
  maxReserve: number;
  rebalanceThreshold: number;
}

/** A corridor funding movement (in or out). */
export interface CorridorFundingRecord {
  id: string;
  corridor: CorridorId;
  amount: number;
  direction: 'fund' | 'defund';
  source: string;
  destination: string;
  ts: number;
  reason: string;
}

/** Current reserve allocated to a corridor. */
export interface CorridorReserve {
  corridor: CorridorId;
  amount: number;
  currency: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// LP profitability
// ---------------------------------------------------------------------------

/**
 * LP profitability snapshot.
 *
 *  - `volume`   — total settlement volume routed through this LP.
 *  - `revenue`  — fees earned by the LP (settlement fees).
 *  - `costs`    — capital cost (opportunity cost of committed reserves)
 *                 + operational cost (opex allocation).
 *  - `pnl`      — `revenue - costs`.
 *  - `margin`   — `pnl / revenue` (0 if revenue is 0).
 *  - `apy`      — annualised return on committed capital
 *                 (`pnl * 365 / daysElapsed / capitalCommitted`).
 */
export interface LPProfitability {
  lpId: string;
  corridor: CorridorId;
  volume: number;
  revenue: number;
  costs: number;
  pnl: number;
  margin: number;
  apy: number;
  /** Capital committed (used for APY computation). */
  capitalCommitted: number;
  /** Number of settlements in the range. */
  settlementCount: number;
  /** Range start (inclusive). */
  fromTs: number;
  /** Range end (exclusive). */
  toTs: number;
}

/** A single settlement recorded for an LP. */
export interface LPSettlementRecord {
  id: string;
  lpId: string;
  corridor: CorridorId;
  volume: number;
  fee: number;
  cost: number;
  ts: number;
}

// ---------------------------------------------------------------------------
// Liquidity forecasting
// ---------------------------------------------------------------------------

/** A single forecast point. */
export interface ForecastPoint {
  ts: number;
  /** Forecasted demand (settlements flowing into the corridor). */
  demand: number;
  /** Forecasted supply (LP liquidity available in the corridor). */
  supply: number;
  /** Projected net reserve (supply - demand). */
  net: number;
  /** Confidence in this forecast (0–1). */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Stress tests
// ---------------------------------------------------------------------------

/** The kind of shock applied in a stress test. */
export type StressShockType =
  | 'corridor_drain'
  | 'lp_default'
  | 'currency_depeg'
  | 'reserve_loss';

/** A single shock to apply. */
export interface StressShock {
  type: StressShockType;
  /** 0–1 fraction (e.g. 0.30 = 30% drain) or absolute magnitude. */
  magnitude: number;
  /** Optional target (corridor key, lpId, currency) — depends on shock type. */
  target?: string;
}

/** A stress test scenario definition. */
export interface StressTestScenario {
  id: string;
  name: string;
  description: string;
  shock: StressShock;
  projectedImpact: string;
}

/** The result of running a stress test scenario. */
export interface StressTestResult {
  scenarioId: string;
  passed: boolean;
  /** Absolute reserve impact (positive = loss). */
  reserveImpact: number;
  /** Shortfall vs. minimum required reserves (0 if none). */
  shortfall: number;
  /** Estimated recovery time in ms (0 if no recovery needed). */
  recoveryTimeMs: number;
  recommendation: string;
  /** Post-shock reserve snapshot per currency. */
  postShockReserves: Array<{ currency: string; balance: number; available: number }>;
  ts: number;
}

// ---------------------------------------------------------------------------
// Treasury reports
// ---------------------------------------------------------------------------

/** A treasury alert. */
export interface TreasuryAlert {
  id: string;
  level: 'info' | 'warning' | 'critical';
  category: 'reserve' | 'backing' | 'limit' | 'corridor' | 'lp' | 'forecast' | 'stress';
  message: string;
  ts: number;
  /** Optional affected entity (currency, corridor key, lpId). */
  subject?: string;
}

/** A frozen asset (compliance hold / pending investigation). */
export interface FrozenAsset {
  assetCode: string;
  reason: string;
  frozenAt: number;
}

/** Mint/burn usage summary for a single asset. */
export interface LimitUsageSummary {
  assetCode: string;
  dailyLimit: number;
  dailyUsed: number;
  utilization: number;
  windowStartTs: number;
}

/** Yield summary for a corridor (APR-style). */
export interface CorridorYieldSummary {
  corridor: CorridorId;
  apr: number;
  volume: number;
  revenue: number;
  costs: number;
}

/** Capital efficiency summary. */
export interface CapitalEfficiencySummary {
  /** Total capital deployed across all corridors. */
  totalCapitalDeployed: number;
  /** Total capital sitting idle (not deployed in any corridor). */
  idleCapital: number;
  /** Efficiency ratio: deployed / (deployed + idle). */
  efficiencyRatio: number;
  /** Average utilisation across corridors (0–1). */
  averageUtilization: number;
}

/**
 * Daily treasury report — the canonical snapshot of treasury state.
 *
 * Aggregates: reserves, backing verification, mint/burn usage, alerts,
 * yields, capital efficiency, corridor funding, frozen assets, LP
 * profitability, and the latest stress test results.
 */
export interface TreasuryReport {
  asOfTs: number;
  reserves: ReserveAccount[];
  /** True when every tracked asset passes the backing verification. */
  backingVerified: boolean;
  /** Per-asset backing verification details (empty when no assets tracked). */
  backingResults?: Array<{
    assetCode: string;
    verified: boolean;
    backingRatio: number;
    discrepancy: number;
  }>;
  mintUsage: LimitUsageSummary[];
  burnUsage: LimitUsageSummary[];
  alerts: TreasuryAlert[];
  yields: CorridorYieldSummary[];
  /** Capital efficiency summary (array form for dashboard compatibility). */
  capitalEfficiency: CapitalEfficiencySummary[];
  corridors: CorridorReserve[];
  /** Asset codes currently frozen (compliance hold). */
  frozenAssets: string[];
  /** Detailed frozen-asset records (parallel to `frozenAssets`). */
  frozenAssetDetails?: FrozenAsset[];
  lpProfitability: LPProfitability[];
  stressTestResults: StressTestResult[];
}

/** A settlement report (aggregated settlement activity for a period). */
export interface SettlementReport {
  period: { fromTs: number; toTs: number };
  totalVolume: number;
  totalSettlements: number;
  totalFees: number;
  byCorridor: Array<{
    corridor: CorridorId;
    volume: number;
    settlements: number;
    fees: number;
  }>;
  byLP: Array<{
    lpId: string;
    volume: number;
    settlements: number;
    pnl: number;
  }>;
}

/** A capital report (reserves + corridor allocation + efficiency). */
export interface CapitalReport {
  asOfTs: number;
  totalReserves: number;
  totalAvailable: number;
  totalReserved: number;
  byCurrency: ReserveAccount[];
  corridorAllocation: Array<{
    corridor: CorridorId;
    amount: number;
    share: number;
  }>;
  capitalEfficiency: CapitalEfficiencySummary;
}

// ---------------------------------------------------------------------------
// TreasuryEngine init options
// ---------------------------------------------------------------------------

/** Initialization options for the TreasuryEngine facade. */
export interface TreasuryEngineOptions {
  /** Periodic check interval (ms) for reserve + alert refresh. Default 60_000. */
  checkIntervalMs?: number;
  /** Periodic check interval (ms) for liquidity forecast refresh. Default 300_000. */
  forecastIntervalMs?: number;
  /** Default reserve alert threshold (fraction of available). Default 0.20. */
  defaultReserveAlertThreshold?: number;
  /** Annualised cost of capital (used in LP profitability). Default 0.08 (8% APR). */
  costOfCapitalApr?: number;
  /** Operational cost per settlement (used in LP profitability). Default 0.10. */
  opexPerSettlement?: number;
}

/** A time range [fromTs, toTs) used in profitability + settlement queries. */
export interface TimeRange {
  fromTs: number;
  toTs: number;
}

/**
 * Minimum backing ratio for a Twin Token to be considered fully backed.
 * 1.0 means 1:1 — every issued token must be backed by an equal amount of
 * fiat reserve. The backing verifier accepts a small tolerance band
 * (configured separately) to account for rounding.
 */
export const MIN_BACKING_RATIO = 1.0;

/** Default daily mint limit (per asset). */
export const DEFAULT_DAILY_MINT_LIMIT = 100_000;

/** Default per-transaction mint limit. */
export const DEFAULT_PER_TX_MINT_LIMIT = 50_000;

/** Protocol's share of LP yield (0.20 = 20%). */
export const PROTOCOL_FEE_SHARE = 0.20;
