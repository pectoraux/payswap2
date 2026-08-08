/**
 * PaySwap Protocol — Ledger Module.
 *
 * The protocol ledger is the canonical multi-currency double-entry book for
 * the protocol layer. It mirrors every value movement (twin token mint/burn,
 * wallet credit/debit, payout, settlement, treasury allocation) into a
 * balanced set of debit/credit entries against a fixed chart of accounts.
 *
 * Architecture:
 *   - `accounts.ts`     — chart of accounts (asset / liability / equity / revenue / expense)
 *   - `entry.ts`        — LedgerEntry + JournalEntry + createJournalEntry / validateBalanced
 *   - `engine.ts`       — LedgerEngine: post, getJournal, balances, trial balance,
 *                         balance sheet, income statement, integrity, reset
 *   - `projection.ts`   — rebuildLedgerFromEvents: event → journal projection
 *   - `reconciliation.ts`— twin token backing, escrow, payouts, merchant, treasury,
 *                         dailyReconciliation aggregator
 *   - `snapshots.ts`    — in-memory snapshot store (DB-backed version in persistence/)
 *   - `reports.ts`      — daily treasury / settlement / close-pack report generators
 *
 * Singletons:
 *   - `ledgerEngine`    — the protocol-wide ledger engine
 *   - `snapshotStore`   — in-memory snapshot cache
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/support`,
 * `@/kernel/event`, and `@/kernel/types` (read-only kernel primitives). No
 * writes to `src/kernel/`.
 */

// Chart of accounts -----------------------------------------------------------
export {
  CHART_OF_ACCOUNTS,
  getAccount,
  accountType,
  twinAssetToCurrency,
  circulatingAccount,
  escrowedAccount,
  backingAccount,
  bankCashAccount,
  mmoCashAccount,
  userWalletAccount,
  merchantPayableAccount,
  feeRevenueAccount,
} from './accounts';
export type { AccountType, AccountDefinition } from './accounts';

// Journal entries -------------------------------------------------------------
export {
  createJournalEntry,
  validateBalanced,
  debit,
  credit,
} from './entry';
export type {
  LedgerEntry,
  JournalEntry,
  JournalLegInput,
  CreateJournalEntryParams,
  BalanceCheckResult,
} from './entry';

// Ledger engine ---------------------------------------------------------------
export {
  LedgerEngine,
  ledgerEngine,
  createLedgerEngine,
  newLedgerId,
} from './engine';
export type {
  JournalFilter,
  AccountTrialBalance,
  TrialBalance,
  BalanceSheetGroup,
  BalanceSheet,
  IncomeStatement,
  IntegrityReport,
} from './engine';

// Event → journal projection --------------------------------------------------
export {
  rebuildLedgerFromEvents,
  projectEvent,
  projectEventsOnto,
  sortEventsForReplay,
  newJournalId,
} from './projection';
export type { ProjectionResult } from './projection';

// Reconciliation --------------------------------------------------------------
export {
  reconcileTwinTokenBacking,
  reconcileEscrow,
  reconcilePayouts,
  reconcileMerchant,
  reconcileTreasury,
  dailyReconciliation,
} from './reconciliation';
export type {
  ReconcileResult,
  ReconcileDiscrepancy,
  TwinTokenLike,
  EscrowLike,
  PayoutLike,
  MerchantLike,
  CollateralVaultLike,
  LPLifecycleLike,
  DailyReconciliationInput,
  DailyReconciliationReport,
} from './reconciliation';

// Snapshots -------------------------------------------------------------------
export {
  takeSnapshot,
  SnapshotStore,
  snapshotStore,
} from './snapshots';
export type { LedgerSnapshot } from './snapshots';

// Reports ---------------------------------------------------------------------
export {
  generateDailyTreasuryReport,
  generateSettlementReport,
  summarizeReconciliation,
  generateDailyClosePack,
} from './reports';
export type {
  TreasuryReportRow,
  DailyTreasuryReport,
  SettlementReportRow,
  SettlementReport,
  ReconciliationSummaryReport,
  DailyClosePack,
} from './reports';
