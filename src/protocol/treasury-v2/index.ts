/**
 * PaySwap Protocol — Treasury Operations Center (v2) — Barrel Export.
 *
 * The treasury is PaySwap's financial control tower. It monitors
 * reserves in real-time, enforces mint/burn limits, verifies
 * stablecoin backing, forecasts liquidity, manages corridor
 * funding, tracks LP profitability, stress-tests resilience, and
 * generates daily reports.
 *
 * PUBLIC CONTRACT (stable, drop-in ready):
 *  - Reserve monitoring:    `reserveMonitor.{setReserve,getReserve,available,backingRatio,syncFromChain,alertIfLow}`
 *  - Mint/burn limits:      `mintLimitEngine.{configure,checkMint,recordMint}`, `burnLimitEngine.{configure,checkBurn,recordBurn}`
 *  - Backing verification:  `backingVerifier.{verifyBacking,verifyAll,onMint,recordMint,recordBurn}`
 *  - Liquidity forecasting: `liquidityForecaster.{recordDemand,recordSupply,forecast,shortfallAlerts,getUtilization}`
 *  - Corridor funding:      `corridorFundingService.{fundCorridor,defundCorridor,getCorridorReserve,rebalance,getFundingHistory}`
 *  - LP profitability:      `lpProfitabilityService.{recordSettlement,getProfitability,getCorridorProfitability,getTopLPs,getUnderperformingLPs}`
 *  - Stress tests:          `stressTestService.{runScenario,runAllScenarios,customScenario,getResults}`
 *  - Reports:               `treasuryReports.{generateDailyTreasuryReport,generateSettlementReport,generateCapitalReport}`
 *  - High-level facade:     `treasuryEngine.{init,preMintHook,preBurnHook,status,dailyReport,runStressTests}`
 *
 * Every mint goes through `treasuryEngine.preMintHook()` which
 * checks (in order): freeze status, daily limit, per-tx limit,
 * cooldown, backing sufficiency. If any check fails, the mint is
 * blocked and a `treasury.pre_mint_blocked` event is emitted.
 *
 * PROVIDER-READINESS:
 *  - Reserve monitoring:    `reserveMonitor.setChainSyncFn(adapter)` — wire up the
 *                            chain/bank/custodian balance adapters.
 *  - Backing verification:  `backingVerifier.setSupplySyncFn(adapter)` — wire up the
 *                            Stellar horizon adapter for on-chain TWIN supply.
 *  - Liquidity forecasting: replace the moving-average + trend with an
 *                            ARIMA / Prophet / LSTM model behind the same
 *                            `forecast(corridor, horizonMs)` contract.
 *  - Stress tests:          replace the simulated shock projection with a
 *                            Monte-Carlo simulation (correlated shocks).
 *
 * The kernel is FROZEN — this module only imports `uid`, `nowTs`,
 * `round` from `@/kernel/support` and `eventEngine` from
 * `@/kernel/event`. No kernel files are modified.
 */
export * from './types';

export {
  ReserveMonitor,
  reserveMonitor,
  type ReserveLowAlert,
} from './reserve-monitor';

// I1: per-country reserve drift monitoring with alarm threshold.
export {
  ReserveDriftMonitor,
  reserveDriftMonitor,
  newDriftAlertId,
  type DriftSample,
  type DriftState,
  type DriftStatus,
} from './reserve-drift-monitor';

// D1 + D2: stablecoin→twin composition per corridor + migration proposals (never executed).
export {
  MigrationProposalEngine,
  migrationProposalEngine,
  type CorridorComposition,
  type CompositionInput,
  type MigrationProposal,
} from './migration-proposals';

// Closed-loop controllers: pair every observer with an actuator.
// "A system that computes the right number and doesn't act on it is more
// dangerous than one that never computed it."
export {
  wireClosedLoops,
  wireRebalanceInputs,
  wireProposalInputs,
  wireNetSettleInputs,
  wireAuctionInputs,
  startNetSettlementCycle,
  stopNetSettlementCycle,
  runNetSettlementCycle,
  backingFallbackTier,
  fxBlockPayment,
  auctionTimeoutRefund,
  isCorridorPaused,
  resumeCorridor,
  pauseLoop,
  resumeLoop,
  loopStatus,
  loopCapsConfig,
  closedLoopAuditLog,
  type ClosedLoopAction,
  type RebalanceInputs,
  type ProposalApplyInputs,
  type NetSettleInputs,
  type AuctionRefundInputs,
} from './closed-loop-controllers';

export {
  MintLimitEngine,
  BurnLimitEngine,
  mintLimitEngine,
  burnLimitEngine,
  DEFAULT_MINT_LIMITS,
  DEFAULT_BURN_LIMITS,
  DEFAULT_DAILY_MINT_LIMIT,
  DEFAULT_PER_TX_MINT_LIMIT,
  type MintLimitConfig,
  type BurnLimitConfig,
} from './limits';

export {
  BackingVerifier,
  backingVerifier,
  type BackingState,
  type BackingVerification,
  type BackingAssetInput,
  type ReserveResolver,
} from './backing';

export {
  LiquidityForecaster,
  liquidityForecaster,
  type ShortfallAlert,
} from './forecasting';

export {
  CorridorFundingService,
  corridorFundingService,
  type LiquidityNetworkView,
  type FundingResult,
} from './corridor-funding';

export {
  LPProfitabilityService,
  lpProfitabilityService,
  type LPSortKey,
  DEFAULT_RANGE_MS,
  DEFAULT_COST_OF_CAPITAL_APR,
  DEFAULT_OPEX_PER_SETTLEMENT,
} from './lp-profitability';

export {
  StressTestService,
  stressTestService,
  DEFAULT_STRESS_SCENARIOS,
} from './stress-test';

export {
  TreasuryReports,
  treasuryReports,
} from './reports';

export {
  TreasuryEngine,
  treasuryEngine,
  type HookResult,
} from './treasury';

// M-RT-20 fix: re-export emergencyFreezeEngine (needed by /api/treasury/freeze).
export { EmergencyFreezeEngine, emergencyFreezeEngine } from './freezes';

// Re-export alertEngine + yieldEngine (used by treasury dashboard + tests).
export { AlertEngine, alertEngine } from './alerts';
export { YieldEngine, yieldEngine } from './yield';
