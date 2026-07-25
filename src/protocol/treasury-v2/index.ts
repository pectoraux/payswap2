/**
 * Treasury v2 — barrel export.
 *
 * Public API for the production treasury operations module (Task 3-E). This
 * module SUPERSEDES the old src/protocol/treasury.ts (which is left 100%
 * intact). All NEW code lives in src/protocol/treasury-v2/.
 *
 * Usage:
 *   import { treasuryEngine } from '@/protocol/treasury-v2';
 *
 *   treasuryEngine.init({
 *     twinTokenEngine,
 *     stellarAdapter,
 *     liquidityNetwork,
 *     intervals: { reserveSyncMs: 60_000, backingVerifyMs: 30_000 },
 *     lowReserveThresholds: { GHS: 1_000, KES: 2_000 },
 *   });
 *
 *   // Pre-mint / pre-burn hooks (called by the twin-token engine):
 *   const { allowed, reason } = treasuryEngine.preMintHook('TWINGHS', 500);
 *   if (allowed) {
 *     await twinTokenEngine.mint('TWINGHS', 500, recipient);
 *     treasuryEngine.recordMint('TWINGHS', 500);
 *   }
 *
 *   // Daily report:
 *   const report = treasuryEngine.dailyReport();
 *
 * Frozen-kernel compliance:
 *   - Imports only `eventEngine`, `evidence` primitives, `uid`, `round`,
 *     `nowTs` from kernel. No kernel state is mutated.
 *   - Old src/protocol/treasury.ts is left 100% intact.
 *   - All NEW files live in src/protocol/treasury-v2/.
 */

// Types
export type {
  TreasuryCorridor,
  ReserveAccount,
  MintLimit,
  BurnLimit,
  CorridorTarget,
  AlertSeverity,
  AlertType,
  ReserveAlert,
  FreezeScope,
  EmergencyFreeze,
  YieldRecord,
  CapitalEfficiency,
  TreasuryReport,
  MintLimitConfig,
  BurnLimitConfig,
  CorridorTargetConfig,
  LimitCheckResult,
  BackingVerification,
  RebalanceResult,
  HookResult,
} from './types';

export {
  DAY_MS,
  DEFAULT_DAILY_MINT_LIMIT,
  DEFAULT_PER_TX_MINT_LIMIT,
  DEFAULT_DAILY_BURN_LIMIT,
  DEFAULT_PER_TX_BURN_LIMIT,
  DEFAULT_MINT_COOLDOWN_MS,
  DEFAULT_LOW_RESERVE_THRESHOLD_RATIO,
  MIN_BACKING_RATIO,
  DEFAULT_RESERVE_ALERT_THRESHOLD,
  PROTOCOL_FEE_SHARE,
} from './types';

// Reserve monitor
export { ReserveMonitor, reserveMonitor } from './reserve';

// Mint / burn limits
export {
  MintLimitEngine,
  BurnLimitEngine,
  mintLimitEngine,
  burnLimitEngine,
  bootstrapDefaultLimits,
} from './limits';

// Backing verifier
export { BackingVerifier, backingVerifier } from './backing';

// Corridor balancing
export {
  CorridorBalancer,
  corridorBalancer,
  treasuryCorridorKey,
  parseTreasuryCorridorKey,
  liquidityCorridorKey,
} from './balancing';

// Emergency freezes
export { EmergencyFreezeEngine, emergencyFreezeEngine } from './freezes';

// Alerts
export { AlertEngine, alertEngine, type RaiseAlertOpts } from './alerts';

// Yield
export { YieldEngine, yieldEngine } from './yield';

// Capital efficiency
export { computeCapitalEfficiency, efficiencyReport } from './efficiency';

// Reports
export {
  generateDailyTreasuryReport,
  generateSettlementReport,
  generateCapitalReport,
  type ReportDeps,
  type SettlementReport,
  type CapitalReport,
} from './reports';

// High-level facade
export {
  TreasuryEngine,
  treasuryEngine,
  type TreasuryInitOpts,
  type TreasuryInitResult,
} from './treasury';
