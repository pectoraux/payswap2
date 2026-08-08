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
  /** Per-currency totals (debit/credit/balance) — used by tests + integrity checks. */
  byCurrency: Record<string, {
    totalDebit: number;
    totalCredit: number;
    /** Signed delta = totalDebit - totalCredit (0 when balanced). */
    delta: number;
  }>;
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
  /** Alias for `assets.total` — total asset balance (debit-positive). */
  totalAssets: number;
  /** Alias for `liabilities.total` — total liability balance (credit-positive). */
  totalLiabilities: number;
  /** Alias for `equity.total` — total equity balance (credit-positive). */
  totalEquity: number;
  /** Alias for `discrepancy` — signed difference A - (L + E). */
  delta: number;
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
        `Unbalanced: cannot post journal entry ${journal.id} — ${check.mismatches
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

  /**
   * Alias for `postFromLegs` — accepts the same params (with `lines` accepted
   * as an alias for `legs` inside `createJournalEntry`). Provided so callers
   * written against the `postLines` API name continue to work.
   */
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

  /** Per-account signed balance + debit/credit breakdown + per-currency detail. */
  getAccountBalance(accountCode: string, asOfTs?: number): {
    debit: number;
    credit: number;
    /** Signed balance = debit - credit. */
    balance: number;
    /** Per-currency breakdown for this account. */
    byCurrency: Record<string, { debit: number; credit: number; balance: number }>;
  } {
    let debit = 0;
    let credit = 0;
    const byCurrency: Record<string, { debit: number; credit: number; balance: number }> = {};
    for (const e of this.entries) {
      if (e.accountCode !== accountCode) continue;
      if (asOfTs != null && e.ts > asOfTs) continue;
      debit = round(debit + e.debit, 6);
      credit = round(credit + e.credit, 6);
      let cur = byCurrency[e.currency];
      if (!cur) {
        cur = { debit: 0, credit: 0, balance: 0 };
        byCurrency[e.currency] = cur;
      }
      cur.debit = round(cur.debit + e.debit, 6);
      cur.credit = round(cur.credit + e.credit, 6);
      cur.balance = round(cur.debit - cur.credit, 6);
    }
    return {
      debit,
      credit,
      balance: round(debit - credit, 6),
      byCurrency,
    };
  }

  /** All account codes that have at least one leg, sorted alphabetically. */
  activeAccounts(): string[] {
    const set = new Set<string>();
    for (const e of this.entries) set.add(e.accountCode);
    return [...set].sort();
  }

  /** Alias for `activeAccounts()` — account codes with at least one leg. */
  getAccountCodes(): string[] {
    return this.activeAccounts();
  }

  /** Total number of journal entries posted. */
  count(): number {
    return this.journals.length;
  }

  /** Alias for `count()` — number of journal entries. */
  size(): number {
    return this.journals.length;
  }

  /** Total number of individual legs. */
  legCount(): number {
    return this.entries.length;
  }

  /** Compute a trial balance across all accounts (or up to `asOfTs`). */
  getTrialBalance(asOfTs?: number): TrialBalance {
    const accounts: Record<string, AccountTrialBalance> = {};
    const byCurrency: Record<string, { totalDebit: number; totalCredit: number; delta: number }> = {};
    let totalDebits = 0;
    let totalCredits = 0;
    for (const e of this.entries) {
      if (asOfTs != null && e.ts > asOfTs) continue;
      let t = accounts[e.accountCode];
      if (!t) {
        t = { debit: 0, credit: 0, balance: 0 };
        accounts[e.accountCode] = t;
      }
      t.debit = round(t.debit + e.debit, 6);
      t.credit = round(t.credit + e.credit, 6);
      totalDebits = round(totalDebits + e.debit, 6);
      totalCredits = round(totalCredits + e.credit, 6);
      let c = byCurrency[e.currency];
      if (!c) {
        c = { totalDebit: 0, totalCredit: 0, delta: 0 };
        byCurrency[e.currency] = c;
      }
      c.totalDebit = round(c.totalDebit + e.debit, 6);
      c.totalCredit = round(c.totalCredit + e.credit, 6);
    }
    for (const code of Object.keys(accounts)) {
      accounts[code].balance = round(accounts[code].debit - accounts[code].credit, 6);
    }
    for (const ccy of Object.keys(byCurrency)) {
      byCurrency[ccy].delta = round(byCurrency[ccy].totalDebit - byCurrency[ccy].totalCredit, 6);
    }
    return {
      totalDebits,
      totalCredits,
      balanced: Math.abs(round(totalDebits - totalCredits, 6)) < 1e-6,
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
      totalAssets: assetTotal,
      totalLiabilities: liabilityTotal,
      totalEquity: equityTotal,
      delta: discrepancy,
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
        const amt = round(e.credit - e.debit, 6);
        if (amt === 0) continue;
        revenue[e.accountCode] = round((revenue[e.accountCode] ?? 0) + amt, 6);
        totalRevenue = round(totalRevenue + amt, 6);
      } else if (type === 'expense') {
        const amt = round(e.debit - e.credit, 6);
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
    t.debit = round(t.debit + e.debit, 6);
    t.credit = round(t.credit + e.credit, 6);
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
