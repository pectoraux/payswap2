/**
 * PaySwap Protocol — Ledger Engine.
 *
 * The LedgerEngine is the protocol-layer double-entry accounting engine. It
 * owns the journal of posted entries and exposes balance, trial-balance,
 * balance-sheet, income-statement, and integrity queries.
 *
 * Difference from the kernel's `LedgerEngine` (in `src/kernel/ledger.ts`):
 *   - The kernel ledger is a simulation-state bookkeeping tool — single
 *     PostInput legs, attached to a WorldState.
 *   - This protocol ledger is the canonical financial book: balanced
 *     JournalEntry postings, a chart of accounts, full reporting.
 *
 * The protocol ledger is what the reconciliation layer, the persistence
 * layer, and external auditors consult. The kernel ledger feeds it via the
 * projection layer (see `projection.ts`).
 */
import { uid, nowTs, round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { accountType } from './accounts';
import {
  createJournalEntry,
  validateBalanced,
  type JournalEntry,
  type LedgerEntry,
  type CreateJournalEntryParams,
  type BalanceCheckResult,
} from './entry';

/** Filter for `getJournal()`. */
export interface JournalFilter {
  /** Filter by transaction id. */
  txId?: string;
  /** Filter by account code (exact match on leg.accountCode). */
  accountCode?: string;
  /** Filter by currency. */
  currency?: string;
  /** Only entries at or after this timestamp. */
  fromTs?: number;
  /** Only entries at or before this timestamp. */
  toTs?: number;
  /** Only entries from this simulation frame onward. */
  fromFrame?: number;
  /** Only entries from this simulation frame or earlier. */
  toFrame?: number;
}

/** Trial balance for one account. */
export interface AccountTrialBalance {
  debit: number;
  credit: number;
  /** Signed balance: debit − credit (positive = debit-normal). */
  balance: number;
}

/** Trial balance for the whole ledger. */
export interface TrialBalance {
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  accounts: Record<string, AccountTrialBalance>;
  /** Per-currency breakdown (test compatibility). */
  byCurrency?: Record<string, { totalDebits: number; totalCredits: number; delta: number; balanced: boolean }>;
}

/** Balance sheet grouping. */
export interface BalanceSheetGroup {
  /** Account codes and their signed balances. */
  accounts: Record<string, number>;
  /** Sum of the group (with proper sign for the equation). */
  total: number;
}

export interface BalanceSheet {
  assets: BalanceSheetGroup;
  liabilities: BalanceSheetGroup;
  equity: BalanceSheetGroup;
  balanced: boolean;
  /** Discrepancy between assets and (liabilities + equity). */
  discrepancy: number;
  /** Alias for discrepancy (test compatibility). */
  delta?: number;
  /** Total assets (test compatibility). */
  totalAssets?: number;
  /** Total liabilities (test compatibility). */
  totalLiabilities?: number;
  /** Total equity (test compatibility). */
  totalEquity?: number;
}

/** Income statement. */
export interface IncomeStatement {
  fromTs: number;
  toTs: number;
  revenue: Record<string, number>;
  expenses: Record<string, number>;
  totalRevenue: number;
  totalExpenses: number;
  /** revenue − expenses (net income). */
  netIncome: number;
}

/** Integrity verification result. */
export interface IntegrityReport {
  balanced: boolean;
  totalDebits: number;
  totalCredits: number;
  /** totalDebits − totalCredits (should be 0). */
  discrepancy: number;
  /** Per-currency breakdown. */
  currencies: BalanceCheckResult['currencies'];
  /** Number of journal entries scanned. */
  entryCount: number;
}

/**
 * LedgerEngine — owns the journal, validates postings, answers queries.
 * Use the exported `ledgerEngine` singleton for the protocol-wide ledger.
 */
export class LedgerEngine {
  private journals: JournalEntry[] = [];
  private entries: LedgerEntry[] = [];
  private nextSeq = 0;

  /** Post a balanced journal entry. Validates balance, appends, emits `ledger.posted`. */
  post(journal: JournalEntry): JournalEntry {
    const check = validateBalanced(journal);
    if (!check.balanced) {
      throw new Error(
        `cannot post unbalanced journal entry ${journal.id} — ${check.mismatches
          .map((m) => `currency ${m.currency}: debit ${m.totalDebit} ≠ credit ${m.totalCredit}`)
          .join('; ')}`,
      );
    }

    // Assign canonical ledger sequences (the journal's legs may have been
    // built with a tentative startSeq — overwrite with the real counter).
    for (const leg of journal.entries) {
      leg.ledgerSeq = this.nextSeq++;
    }

    this.journals.push(journal);
    this.entries.push(...journal.entries);

    eventEngine.emit(
      'ledger.posted',
      {
        journalId: journal.id,
        txId: journal.txId,
        description: journal.description,
        legCount: journal.entries.length,
        currencies: check.currencies.map((c) => c.currency),
        ts: journal.ts,
        frame: journal.frame ?? 0,
      },
      journal.frame ?? 0,
    );

    return journal;
  }

  /** Convenience: build and post a journal entry from raw legs in one call. */
  postFromLegs(params: Omit<CreateJournalEntryParams, 'startSeq'>): JournalEntry {
    const journal = createJournalEntry({ ...params, startSeq: this.nextSeq });
    return this.post(journal);
  }

  /** Alias for postFromLegs (test compatibility). */
  postLines(params: Omit<CreateJournalEntryParams, 'startSeq'>): JournalEntry {
    return this.postFromLegs(params);
  }

  /** Return journals matching the filter, in post order. */
  getJournal(filter?: JournalFilter): JournalEntry[] {
    if (!filter) return [...this.journals];
    return this.journals.filter((j) => {
      if (filter.txId && j.txId !== filter.txId) return false;
      if (filter.fromTs != null && j.ts < filter.fromTs) return false;
      if (filter.toTs != null && j.ts > filter.toTs) return false;
      if (filter.fromFrame != null && (j.frame ?? 0) < filter.fromFrame) return false;
      if (filter.toFrame != null && (j.frame ?? 0) > filter.toFrame) return false;
      if (filter.accountCode || filter.currency) {
        const legMatch = j.entries.some(
          (e) =>
            (!filter.accountCode || e.accountCode === filter.accountCode) &&
            (!filter.currency || e.currency === filter.currency),
        );
        if (!legMatch) return false;
      }
      return true;
    });
  }

  /** Return all individual ledger legs (flat) matching the filter, in post order. */
  getEntries(filter?: JournalFilter): LedgerEntry[] {
    if (!filter) return [...this.entries];
    return this.entries.filter((e) => {
      if (filter.txId && e.txId !== filter.txId) return false;
      if (filter.accountCode && e.accountCode !== filter.accountCode) return false;
      if (filter.currency && e.currency !== filter.currency) return false;
      if (filter.fromTs != null && e.ts < filter.fromTs) return false;
      if (filter.toTs != null && e.ts > filter.toTs) return false;
      if (filter.fromFrame != null && (e.frame ?? 0) < filter.fromFrame) return false;
      if (filter.toFrame != null && (e.frame ?? 0) > filter.toFrame) return false;
      return true;
    });
  }

  /**
   * Compute the signed balance for an account at a point in time.
   * Balance is debit − credit. For debit-normal accounts (asset, expense)
   * this is a positive asset; for credit-normal accounts (liability, equity,
   * revenue) a positive balance reflects a credit balance.
   *
   * Multi-currency accounts return the sum across currencies (callers
   * filtering by currency should pass it in the filter or use getEntries).
   */
  getAccountBalance(accountCode: string, asOfTs?: number): number {
    // MON-3: sum via Money internally, return number for backwards compat.
    let balance = 0;
    for (const e of this.entries) {
      if (e.accountCode !== accountCode) continue;
      if (asOfTs != null && e.ts > asOfTs) continue;
      // e.debit and e.credit are Money — use .toNumber() for the sum.
      // The internal sum uses Math.round(v*100) to avoid float drift.
      balance = Math.round(balance * 100 + e.debit.toNumber() * 100 - e.credit.toNumber() * 100) / 100;
    }
    return balance;
  }

  /**
   * Get detailed account balance (debit, credit, balance, per-currency).
   * Test compatibility: returns an object, not just a number.
   */
  getAccountDetail(accountCode: string, asOfTs?: number): {
    debit: number; credit: number; balance: number;
    byCurrency: Record<string, { debit: number; credit: number; balance: number }>;
  } {
    let debitCents = 0, creditCents = 0;
    const byCurrency: Record<string, { debit: number; credit: number; balance: number }> = {};
    for (const e of this.entries) {
      if (e.accountCode !== accountCode) continue;
      if (asOfTs != null && e.ts > asOfTs) continue;
      // MON-3: Money.toNumber() at the boundary, integer cents internally.
      const dCents = Number(e.debit.minorUnits);
      const cCents = Number(e.credit.minorUnits);
      debitCents += dCents;
      creditCents += cCents;
      let c = byCurrency[e.currency];
      if (!c) { c = { debit: 0, credit: 0, balance: 0 }; byCurrency[e.currency] = c; }
      c.debit = Math.round(c.debit * 100 + e.debit.toNumber() * 100) / 100;
      c.credit = Math.round(c.credit * 100 + e.credit.toNumber() * 100) / 100;
      c.balance = Math.round(c.debit * 100 - c.credit * 100) / 100;
    }
    return { debit: debitCents / 100, credit: creditCents / 100, balance: (debitCents - creditCents) / 100, byCurrency };
  }

  /** All account codes that have at least one leg, sorted alphabetically. */
  activeAccounts(): string[] {
    const set = new Set<string>();
    for (const e of this.entries) set.add(e.accountCode);
    return [...set].sort();
  }

  /** Alias for activeAccounts() (test compatibility). */
  getAccountCodes(): string[] {
    return this.activeAccounts();
  }

  /** Number of entries (test compatibility). */
  size(): number {
    return this.entries.length;
  }

  /** Total number of journal entries posted. */
  count(): number {
    return this.journals.length;
  }

  /** Total number of individual legs. */
  legCount(): number {
    return this.entries.length;
  }

  /** Compute a trial balance across all accounts (or up to `asOfTs`). */
  getTrialBalance(asOfTs?: number): TrialBalance {
    const accounts: Record<string, AccountTrialBalance> = {};
    const byCurrency: Record<string, { totalDebits: number; totalCredits: number; delta: number; balanced: boolean }> = {};
    let totalDebitsCents = 0;
    let totalCreditsCents = 0;
    for (const e of this.entries) {
      if (asOfTs != null && e.ts > asOfTs) continue;
      // MON-3: extract minor units from Money, sum as integers.
      const dCents = Number(e.debit.minorUnits);
      const cCents = Number(e.credit.minorUnits);
      let t = accounts[e.accountCode];
      if (!t) {
        t = { debit: 0, credit: 0, balance: 0 };
        accounts[e.accountCode] = t;
      }
      t.debit = Math.round(t.debit * 100 + dCents) / 100;
      t.credit = Math.round(t.credit * 100 + cCents) / 100;
      totalDebitsCents += dCents;
      totalCreditsCents += cCents;
      // Per-currency breakdown.
      let c = byCurrency[e.currency];
      if (!c) { c = { totalDebits: 0, totalCredits: 0, delta: 0, balanced: false }; byCurrency[e.currency] = c; }
      c.totalDebits = Math.round(c.totalDebits * 100 + dCents) / 100;
      c.totalCredits = Math.round(c.totalCredits * 100 + cCents) / 100;
    }
    for (const code of Object.keys(accounts)) {
      accounts[code].balance = Math.round(accounts[code].debit * 100 - accounts[code].credit * 100) / 100;
    }
    for (const ccy of Object.keys(byCurrency)) {
      const deltaCents = Math.round(byCurrency[ccy].totalDebits * 100 - byCurrency[ccy].totalCredits * 100);
      byCurrency[ccy].delta = deltaCents / 100;
      byCurrency[ccy].balanced = deltaCents === 0;
    }
    const totalDebits = totalDebitsCents / 100;
    const totalCredits = totalCreditsCents / 100;
    return {
      totalDebits,
      totalCredits,
      balanced: totalDebitsCents === totalCreditsCents,
      accounts,
      byCurrency,
    };
  }

  /** Build a balance sheet: assets = liabilities + equity. */
  getBalanceSheet(asOfTs?: number): BalanceSheet {
    const tb = this.getTrialBalance(asOfTs);
    const assets: Record<string, number> = {};
    const liabilities: Record<string, number> = {};
    const equity: Record<string, number> = {};

    let assetTotal = 0;
    let liabilityTotal = 0;
    let equityTotal = 0;

    for (const code of Object.keys(tb.accounts)) {
      const t = tb.accounts[code];
      const type = accountType(code);
      // Convert to "natural" balance:
      //   asset/expense → debit-positive
      //   liability/equity/revenue → credit-positive
      const natural = type === 'asset' || type === 'expense' ? t.balance : -t.balance;
      switch (type) {
        case 'asset':
          assets[code] = natural;
          assetTotal = round(assetTotal + natural, 6);
          break;
        case 'liability':
          liabilities[code] = natural;
          liabilityTotal = round(liabilityTotal + natural, 6);
          break;
        case 'equity':
        case 'revenue':
          // Revenue closes into equity, so group it here for the balance sheet.
          equity[code] = natural;
          equityTotal = round(equityTotal + natural, 6);
          break;
        case 'expense':
          // Expenses reduce equity; subtract.
          equity[code] = -natural;
          equityTotal = round(equityTotal - natural, 6);
          break;
      }
    }

    const discrepancy = round(assetTotal - (liabilityTotal + equityTotal), 6);
    return {
      assets: { accounts: assets, total: assetTotal },
      liabilities: { accounts: liabilities, total: liabilityTotal },
      equity: { accounts: equity, total: equityTotal },
      balanced: Math.abs(discrepancy) < 1e-6,
      discrepancy,
      delta: discrepancy,
      totalAssets: assetTotal,
      totalLiabilities: liabilityTotal,
      totalEquity: equityTotal,
    };
  }

  /** Build an income statement (revenue − expenses) for a period. */
  getIncomeStatement(fromTs: number, toTs?: number): IncomeStatement {
    const revenue: Record<string, number> = {};
    const expenses: Record<string, number> = {};
    let totalRevenue = 0;
    let totalExpenses = 0;

    for (const e of this.entries) {
      if (e.ts < fromTs) continue;
      if (toTs != null && e.ts > toTs) continue;
      const type = accountType(e.accountCode);
      // For revenue: credits increase (natural credit balance).
      // For expense: debits increase (natural debit balance).
      if (type === 'revenue') {
        const amt = e.credit.subtract(e.debit).toNumber();
        if (amt === 0) continue;
        revenue[e.accountCode] = round((revenue[e.accountCode] ?? 0) + amt, 6);
        totalRevenue = round(totalRevenue + amt, 6);
      } else if (type === 'expense') {
        const amt = e.debit.subtract(e.credit).toNumber();
        if (amt === 0) continue;
        expenses[e.accountCode] = round((expenses[e.accountCode] ?? 0) + amt, 6);
        totalExpenses = round(totalExpenses + amt, 6);
      }
    }

    return {
      fromTs,
      toTs: toTs ?? nowTs(),
      revenue,
      expenses,
      totalRevenue,
      totalExpenses,
      netIncome: round(totalRevenue - totalExpenses, 6),
    };
  }

  /** Verify ledger integrity: total debits must equal total credits. */
  verifyIntegrity(): IntegrityReport {
    const tb = this.getTrialBalance();
    const check = validateBalancedInner(this.entries);
    return {
      balanced: tb.balanced,
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
      discrepancy: round(tb.totalDebits - tb.totalCredits, 6),
      currencies: check.currencies,
      entryCount: this.journals.length,
    };
  }

  /** Reset the engine — clears all journals and legs. */
  reset(): void {
    this.journals = [];
    this.entries = [];
    this.nextSeq = 0;
  }

  /** Current next-sequence counter (useful for snapshots). */
  currentSeq(): number {
    return this.nextSeq;
  }
}

/** Internal: per-currency debit/credit balance check over raw legs. */
function validateBalancedInner(entries: LedgerEntry[]): BalanceCheckResult {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    let t = totals.get(e.currency);
    if (!t) {
      t = { debit: 0, credit: 0 };
      totals.set(e.currency, t);
    }
    t.debit = round(t.debit + e.debit.toNumber(), 6);
    t.credit = round(t.credit + e.credit.toNumber(), 6);
  }

  const currencies: BalanceCheckResult['currencies'] = [];
  const mismatches: BalanceCheckResult['mismatches'] = [];
  for (const [currency, t] of totals) {
    const diff = round(t.debit - t.credit, 6);
    currencies.push({
      currency,
      totalDebit: t.debit,
      totalCredit: t.credit,
      difference: diff,
    });
    if (Math.abs(diff) > 1e-6) {
      mismatches.push({
        currency,
        totalDebit: t.debit,
        totalCredit: t.credit,
        difference: diff,
      });
    }
  }

  return { balanced: mismatches.length === 0, currencies, mismatches };
}

/**
 * Singleton protocol ledger engine.
 *
 * Use this for the canonical protocol ledger. Per-simulation instances can be
 * constructed directly with `new LedgerEngine()` (e.g. for parallel replays).
 */
export const ledgerEngine = new LedgerEngine();

/** Re-exported factory for new engines. */
export function createLedgerEngine(): LedgerEngine {
  return new LedgerEngine();
}

/** Unique-id helper, exported for downstream callers. */
export function newLedgerId(prefix: string): string {
  return uid(prefix);
}
