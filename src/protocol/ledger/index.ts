/**
 * PaySwap Protocol — Double-Entry Ledger / Barrel Export.
 * -----------------------------------------------------------------------------
 * Single import surface for the ledger module:
 *
 *   import {
 *     ledgerEngine, snapshotStore,
 *     rebuildLedgerFromEvents, dailyReconciliation,
 *     generateTreasuryReport, ...
 *   } from '@/protocol/ledger';
 *
 * Re-exports everything from the constituent files and instantiates the
 * singleton `ledgerEngine` and `snapshotStore`.
 */
import { LedgerEngine, ledgerEngine } from './engine';
import { SnapshotStore, snapshotStore } from './snapshots';

// Re-export the singletons.
export { ledgerEngine, snapshotStore };
export { LedgerEngine, SnapshotStore };

// Accounts
export {
  CHART_OF_ACCOUNTS,
  getAccount,
  accountsByType,
  twinAssetToCurrency,
  CURRENCIES,
} from './accounts';
export type { LedgerAccount, AccountType, NormalBalance } from './accounts';

// Entries
export {
  createJournalEntry,
  validateBalanced,
  debit,
  credit,
} from './entry';
export type {
  LedgerEntry,
  JournalEntry,
  JournalLineInput,
  CreateJournalEntryParams,
} from './entry';

// Engine types
export type {
  JournalFilter,
  AccountBalanceResult,
  TrialBalanceResult,
  BalanceSheetResult,
  IncomeStatementResult,
  IntegrityResult,
} from './engine';

// Snapshots
export {
  takeSnapshot,
  rebuildFromSnapshots,
} from './snapshots';
export type {
  LedgerSnapshot,
  AccountSnapshot,
  TrialBalanceSnapshot,
} from './snapshots';

// Projection
export {
  rebuildLedgerFromEvents,
  rebuildLedgerFromEventsInto,
  rebuildLedgerFromEventStream,
  rebuildSnapshot,
} from './projection';
export type { LedgerSnapshotLite } from './projection';

// Reconciliation
export {
  reconcileTwinTokenBacking,
  reconcileEscrow,
  reconcilePayouts,
  reconcileMerchant,
  reconcileLP,
  reconcileTreasury,
  dailyReconciliation,
} from './reconciliation';
export type {
  TwinTokenBackingReconciliation,
  EscrowReconciliation,
  PayoutReconciliation,
  MerchantReconciliation,
  LPReconciliation,
  TreasuryReconciliation,
  DailyReconciliationReport,
} from './reconciliation';

// Reports
export {
  generateSettlementReport,
  generateTreasuryReport,
  generateLPReport,
  generateMerchantReport,
  generateOutstandingLiabilitiesReport,
  generateHistoricalSnapshotReport,
  captureSnapshot,
} from './reports';
export type {
  SettlementReport,
  TreasuryReport,
  LPReport,
  MerchantReport,
  OutstandingLiabilitiesReport,
  HistoricalSnapshotReport,
} from './reports';
