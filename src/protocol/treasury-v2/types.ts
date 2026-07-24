/**
 * PaySwap Protocol — Treasury v2 (Task 3-E).
 *
 * Core types for the production treasury operations module. This module
 * SUPERSEDES the old src/protocol/treasury.ts (which is left 100% intact).
 * All NEW code lives in src/protocol/treasury-v2/.
 *
 * Treasury v2 governs:
 *   - Reserve monitoring (per currency / asset, on-chain synchronized)
 *   - Twin Token backing verification (circulating + escrowed ≤ reserve)
 *   - Mint / burn limits (daily cap, per-tx cap, cooldown)
 *   - Emergency freezes (account / asset / corridor — auditable)
 *   - Reserve alerts (low_reserve, backing_mismatch, mint_limit_exceeded,
 *     freeze_triggered, rebalance_needed)
 *   - Yield accounting (gross / net / APY per asset)
 *   - Capital efficiency (reserve ratio, utilization, velocity, composite)
 *   - Automatic corridor balancing (pull liquidity from over-reserved corridors)
 *   - Daily treasury reports (full state snapshot)
 *
 * Constraints honored:
 *  - Kernel is FROZEN — only imports `eventEngine`, `evidence` primitives,
 *    `uid`, `round`, `nowTs` from kernel. No kernel state is mutated.
 *  - Old src/protocol/treasury.ts is left 100% intact.
 *  - All NEW files live in src/protocol/treasury-v2/.
 */

/** A corridor — directed currency pair, mirroring liquidity-network's Corridor. */
export interface TreasuryCorridor {
  from: string;
  to: string;
}

/**
 * ReserveAccount — the treasury's view of reserves for one currency / asset.
 *
 *   - `balance`     : total reserve currently held (fiat + stablecoin + on-chain)
 *   - `reserved`    : portion already committed to in-flight Twin Tokens
 *                     (escrowed + circulating liabilities ≤ balance)
 *   - `available`   : balance - reserved (free for new mints)
 *   - `backingRatio`: reserve.available / (circulating + escrowed) — must be ≥ 1.0
 *                     for full backing. If circulating + escrowed = 0, ratio = 1
 *                     (no liabilities, fully backed trivially).
 */
export interface ReserveAccount {
  currency: string;
  assetCode: string;
  balance: number;
  reserved: number;
  available: number;
  lastReconciledTs: number;
  backingRatio: number;
}

/**
 * MintLimit — per-asset mint limits.
 *   - `dailyLimit`   : max amount mintable in a rolling 24h window
 *   - `dailyUsed`    : amount minted in the current window
 *   - `windowStartTs`: when the current window started (rolls over every 24h)
 *   - `perTxLimit`   : max amount mintable per single mint operation
 *   - `cooldownMs`   : minimum time between mints to the same recipient (0 = none)
 *   - `lastMintTs`   : timestamp of last successful mint (for cooldown)
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
 * BurnLimit — per-asset burn limits. Burns are bounded because burning destroys
 * the protocol's liability to redeem, so unbounded burns could mask insolvency.
 */
export interface BurnLimit {
  assetCode: string;
  dailyLimit: number;
  dailyUsed: number;
  windowStartTs: number;
  perTxLimit: number;
}

/**
 * CorridorTarget — the target reserve envelope for a corridor.
 *   - `targetReserve`      : the "ideal" reserve amount on each side
 *   - `minReserve`         : floor — below this triggers `rebalance_needed`
 *   - `maxReserve`         : ceiling — above this the corridor is "over-reserved"
 *                            and can donate liquidity to under-reserved corridors
 *   - `rebalanceThreshold` : fraction (0..1) of target — if reserve falls below
 *                            target × (1 - rebalanceThreshold), rebalance triggers
 *   - `lastBalancedTs`     : timestamp of the last successful rebalance
 */
export interface CorridorTarget {
  corridor: TreasuryCorridor;
  targetReserve: number;
  minReserve: number;
  maxReserve: number;
  rebalanceThreshold: number;
  lastBalancedTs: number | null;
}

/** Alert severity levels. */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** Alert type tags. */
export type AlertType =
  | 'low_reserve'
  | 'backing_mismatch'
  | 'mint_limit_exceeded'
  | 'freeze_triggered'
  | 'rebalance_needed';

/**
 * ReserveAlert — an actionable treasury alert. Deduplicated by (type, target).
 * Once `resolved` is true, the alert is retained for audit history but no
 * longer appears in `active()`.
 */
export interface ReserveAlert {
  id: string;
  severity: AlertSeverity;
  type: AlertType;
  currency?: string;
  assetCode?: string;
  message: string;
  ts: number;
  resolved: boolean;
}

/** The scope of an emergency freeze. */
export type FreezeScope = 'account' | 'asset' | 'corridor';

/**
 * EmergencyFreeze — an auditable freeze record. Every freeze / lift emits a
 * `treasury.freeze_triggered` / `treasury.freeze_lifted` event with the
 * initiator + reason so the action is fully traceable.
 */
export interface EmergencyFreeze {
  id: string;
  scope: FreezeScope;
  target: string;
  reason: string;
  initiatedBy: string;
  initiatedAt: number;
  expiresAt?: number;
  liftedAt?: number;
  active: boolean;
}

/**
 * YieldRecord — one period's yield for an asset.
 *   - `period`   : label like '2024-06-01' or '2024-W22'
 *   - `grossYield`: total yield earned (before protocol fee)
 *   - `netYield` : yield net of protocol fee share
 *   - `source`   : 'reserve_staking' | 'defi_deployment' | 'fx_hedging' | ...
 *   - `apy`      : annualized percentage yield (0.05 = 5%)
 */
export interface YieldRecord {
  period: string;
  assetCode: string;
  grossYield: number;
  netYield: number;
  source: string;
  apy: number;
}

/**
 * CapitalEfficiency — composite efficiency for one asset.
 *   - `reserveRatio` : reserve.available / circulating (≥1 = fully backed)
 *   - `utilization`  : circulating / (circulating + escrowed) — how much of
 *                      total supply is in active circulation (vs locked)
 *   - `velocity`     : tx volume / reserve (annualized turnover)
 *   - `efficiency`   : composite 0..1 — higher = more capital-efficient
 */
export interface CapitalEfficiency {
  assetCode: string;
  reserveRatio: number;
  utilization: number;
  velocity: number;
  efficiency: number;
}

/**
 * TreasuryReport — the daily treasury report. A pure snapshot of treasury state
 * at a point in time, assembled from every subsystem.
 */
export interface TreasuryReport {
  asOfTs: number;
  reserves: ReserveAccount[];
  backingVerified: boolean;
  mintUsage: { assetCode: string; dailyUsed: number; dailyLimit: number; remaining: number }[];
  burnUsage: { assetCode: string; dailyUsed: number; dailyLimit: number; remaining: number }[];
  alerts: ReserveAlert[];
  yields: YieldRecord[];
  capitalEfficiency: CapitalEfficiency[];
  corridors: CorridorTarget[];
  frozenAssets: string[];
}

/* ========================================================================== */
/* Engine configuration types                                                  */
/* ========================================================================== */

/** Configuration for a single asset's mint limits. */
export interface MintLimitConfig {
  assetCode: string;
  dailyLimit: number;
  perTxLimit: number;
  cooldownMs?: number;
}

/** Configuration for a single asset's burn limits. */
export interface BurnLimitConfig {
  assetCode: string;
  dailyLimit: number;
  perTxLimit: number;
}

/** Configuration for a corridor target envelope. */
export interface CorridorTargetConfig {
  corridor: TreasuryCorridor;
  targetReserve: number;
  minReserve: number;
  maxReserve: number;
  rebalanceThreshold: number;
}

/** Result of a limit check — does a mint/burn pass the limits? */
export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  remainingDaily?: number;
}

/** Result of a backing verification. */
export interface BackingVerification {
  verified: boolean;
  assetCode: string;
  circulating: number;
  escrowed: number;
  reserve: number;
  backingRatio: number;
  /** (circulating + escrowed) − reserve — positive = shortfall. */
  discrepancy: number;
}

/** Result of a corridor rebalance attempt. */
export interface RebalanceResult {
  rebalanced: boolean;
  from?: string;
  to?: string;
  amount?: number;
  route?: string;
  reason?: string;
}

/** Result of a pre-mint / pre-burn hook. */
export interface HookResult {
  allowed: boolean;
  reason?: string;
}

/** Milliseconds in a day — used by limit window roll-overs. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Default daily mint limit (10 000 in asset units). */
export const DEFAULT_DAILY_MINT_LIMIT = 10_000;

/** Default per-tx mint limit (1 000 in asset units). */
export const DEFAULT_PER_TX_MINT_LIMIT = 1_000;

/** Default daily burn limit. */
export const DEFAULT_DAILY_BURN_LIMIT = 10_000;

/** Default per-tx burn limit. */
export const DEFAULT_PER_TX_BURN_LIMIT = 1_000;

/** Default mint cooldown (0 = no cooldown between mints). */
export const DEFAULT_MINT_COOLDOWN_MS = 0;

/** Default low-reserve threshold ratio (10% of circulating). */
export const DEFAULT_LOW_RESERVE_THRESHOLD_RATIO = 0.1;

/** Default minimum backing ratio (1.0 = fully backed). */
export const MIN_BACKING_RATIO = 1.0;

/** Default reserve alert threshold (absolute amount). */
export const DEFAULT_RESERVE_ALERT_THRESHOLD = 1_000;

/** Protocol fee share of gross yield (10%). */
export const PROTOCOL_FEE_SHARE = 0.10;
