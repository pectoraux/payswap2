/**
 * PaySwap Protocol — Ledger Reports.
 *
 * Thin report generators that wrap the LedgerEngine queries into shapes
 * suitable for export (CSV/JSON), dashboards, and the daily close pack.
 *
 * These are intentionally simple — the heavy lifting lives in the engine. The
 * report layer is where you add formatting, period partitioning, and
 * human-readable narrative.
 */
import { round, formatDuration } from '@/kernel/support';
import type {
  LedgerEngine,
  TrialBalance,
  BalanceSheet,
  IncomeStatement,
  IntegrityReport,
} from './engine';
import type { DailyReconciliationReport } from './reconciliation';
import {
  getAccount,
  twinAssetToCurrency,
} from './accounts';

/** A single row in a treasury report. */
export interface TreasuryReportRow {
  accountCode: string;
  label: string;
  type: string;
  balance: number;
  currency: string;
}

/** Daily treasury report. */
export interface DailyTreasuryReport {
  /** Report id. */
  id: string;
  /** Cutoff timestamp. */
  asOfTs: number;
  /** Trial balance totals. */
  totals: { totalDebits: number; totalCredits: number; balanced: boolean };
  /** Treasury account rows (assets, liabilities, equity). */
  rows: TreasuryReportRow[];
  /** Net asset position (assets − liabilities). */
  netAssetPosition: number;
  /** Treasury equity balance. */
  treasuryEquity: number;
  /** Generation time (ms). */
  durationMs: number;
}

/**
 * Generate a daily treasury report — every active account with its balance,
 * grouped by type, with the trial-balance totals and the net asset position.
 */
export function generateDailyTreasuryReport(
  ledger: LedgerEngine,
  asOfTs?: number,
): DailyTreasuryReport {
  const start = Date.now();
  const cutoff = asOfTs ?? Date.now();
  const tb = ledger.getTrialBalance(cutoff);
  const bs = ledger.getBalanceSheet(cutoff);

  const rows: TreasuryReportRow[] = [];
  for (const code of Object.keys(tb.accounts)) {
    const def = getAccount(code);
    const t = tb.accounts[code];
    rows.push({
      accountCode: code,
      label: def?.label ?? code,
      type: def?.type ?? 'asset',
      balance: round(t.balance, 6),
      currency: def?.currency === 'multi' ? 'multi' : (def?.currency ?? 'multi'),
    });
  }

  // Sort: assets first, then liabilities, then equity, then revenue/expense.
  const typeOrder: Record<string, number> = { asset: 0, liability: 1, equity: 2, revenue: 3, expense: 4 };
  rows.sort((a, b) => {
    const ta = typeOrder[a.type] ?? 99;
    const tb_ = typeOrder[b.type] ?? 99;
    if (ta !== tb_) return ta - tb_;
    return a.accountCode < b.accountCode ? -1 : 1;
  });

  return {
    id: `treasury-${cutoff}`,
    asOfTs: cutoff,
    totals: {
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
      balanced: tb.balanced,
    },
    rows,
    netAssetPosition: round(bs.assets.total - bs.liabilities.total, 6),
    treasuryEquity: round(bs.equity.accounts['equity:treasury'] ?? 0, 6),
    durationMs: Date.now() - start,
  };
}

/** Settlement report row — per twin-token asset. */
export interface SettlementReportRow {
  assetCode: string;
  currency: string;
  circulating: number;
  escrowed: number;
  backing: number;
  /** circulating + escrowed − backing (should be 0). */
  discrepancy: number;
}

/** Settlement report — twin token backing per asset. */
export interface SettlementReport {
  id: string;
  asOfTs: number;
  rows: SettlementReportRow[];
  /** Total backing liability across all currencies. */
  totalBacking: number;
  /** Total circulating across all assets. */
  totalCirculating: number;
  /** Total escrowed across all assets. */
  totalEscrowed: number;
  /** True if every row's discrepancy is zero. */
  balanced: boolean;
  durationMs: number;
}

/**
 * Generate a settlement report — twin token backing coverage per asset.
 * Useful for the daily close pack.
 */
export function generateSettlementReport(
  ledger: LedgerEngine,
  asOfTs?: number,
): SettlementReport {
  const start = Date.now();
  const cutoff = asOfTs ?? Date.now();
  const tb = ledger.getTrialBalance(cutoff);

  // Discover twin-token asset codes from the active accounts.
  const assetCodes = new Set<string>();
  for (const code of Object.keys(tb.accounts)) {
    if (code.startsWith('twintoken:circulating:')) {
      assetCodes.add(code.slice('twintoken:circulating:'.length));
    } else if (code.startsWith('twintoken:escrowed:')) {
      assetCodes.add(code.slice('twintoken:escrowed:'.length));
    }
  }

  const rows: SettlementReportRow[] = [];
  let totalBacking = 0;
  let totalCirculating = 0;
  let totalEscrowed = 0;
  let balanced = true;

  for (const assetCode of [...assetCodes].sort()) {
    const currency = twinAssetToCurrency(assetCode);
    const circulating = Math.max(0, tb.accounts[`twintoken:circulating:${assetCode}`]?.balance ?? 0);
    const escrowed = Math.max(0, tb.accounts[`twintoken:escrowed:${assetCode}`]?.balance ?? 0);
    const backing = Math.abs(tb.accounts[`twin:backing:${currency}`]?.balance ?? 0);
    const discrepancy = round(circulating + escrowed - backing, 6);
    if (Math.abs(discrepancy) > 1e-6) balanced = false;
    rows.push({ assetCode, currency, circulating, escrowed, backing, discrepancy });
    totalBacking = round(totalBacking + backing, 6);
    totalCirculating = round(totalCirculating + circulating, 6);
    totalEscrowed = round(totalEscrowed + escrowed, 6);
  }

  return {
    id: `settlement-${cutoff}`,
    asOfTs: cutoff,
    rows,
    totalBacking,
    totalCirculating,
    totalEscrowed,
    balanced,
    durationMs: Date.now() - start,
  };
}

/** Reconciliation summary report — human-readable. */
export interface ReconciliationSummaryReport {
  id: string;
  asOfTs: number;
  passed: boolean;
  failedCount: number;
  durationMs: number;
  checks: Array<{
    name: string;
    passed: boolean;
    discrepancyCount: number;
  }>;
  summary: string;
}

/**
 * Summarize a DailyReconciliationReport into a one-screen human-readable
 * summary. Useful for ops dashboards and audit logs.
 */
export function summarizeReconciliation(
  recon: DailyReconciliationReport,
): ReconciliationSummaryReport {
  const checks = [
    recon.twinTokenBacking,
    recon.escrow,
    recon.payouts,
    recon.treasury,
  ].map((r) => ({
    name: r.name,
    passed: r.passed,
    discrepancyCount: r.discrepancies.length,
  }));

  const summary = recon.passed
    ? `All ${checks.length} reconciliation checks passed in ${formatDuration(recon.durationMs)}.`
    : `${recon.failedCount} of ${checks.length} reconciliation checks failed in ${formatDuration(recon.durationMs)}. ` +
      checks.filter((c) => !c.passed).map((c) => `${c.name} (${c.discrepancyCount} discrepancies)`).join('; ');

  return {
    id: `recon-summary-${recon.asOfTs}`,
    asOfTs: recon.asOfTs,
    passed: recon.passed,
    failedCount: recon.failedCount,
    durationMs: recon.durationMs,
    checks,
    summary,
  };
}

/** Full close pack — treasury + settlement + integrity + income statement. */
export interface DailyClosePack {
  id: string;
  asOfTs: number;
  treasury: DailyTreasuryReport;
  settlement: SettlementReport;
  incomeStatement: IncomeStatement;
  integrity: IntegrityReport;
  /** Trial balance snapshot. */
  trialBalance: TrialBalance;
  /** Balance sheet. */
  balanceSheet: BalanceSheet;
  /** Total duration (ms). */
  durationMs: number;
}

/**
 * Generate the full daily close pack — every report needed to close the books.
 *
 * Includes treasury, settlement, income statement (from start of day),
 * integrity check, trial balance, and balance sheet.
 */
export function generateDailyClosePack(
  ledger: LedgerEngine,
  asOfTs?: number,
  dayStartTs?: number,
): DailyClosePack {
  const start = Date.now();
  const cutoff = asOfTs ?? Date.now();
  const startOfDay = dayStartTs ?? new Date(cutoff).setHours(0, 0, 0, 0);

  const treasury = generateDailyTreasuryReport(ledger, cutoff);
  const settlement = generateSettlementReport(ledger, cutoff);
  const incomeStatement = ledger.getIncomeStatement(startOfDay, cutoff);
  const integrity = ledger.verifyIntegrity();
  const trialBalance = ledger.getTrialBalance(cutoff);
  const balanceSheet = ledger.getBalanceSheet(cutoff);

  return {
    id: `close-${cutoff}`,
    asOfTs: cutoff,
    treasury,
    settlement,
    incomeStatement,
    integrity,
    trialBalance,
    balanceSheet,
    durationMs: Date.now() - start,
  };
}
