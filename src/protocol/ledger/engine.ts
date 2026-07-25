/**
 * PaySwap Protocol — Double-Entry Ledger Engine.
 * -----------------------------------------------------------------------------
 * The LedgerEngine holds an append-only journal of balanced JournalEntry
 * objects and exposes derived views:
 *   - getJournal(filter?)            — filtered list of journal entries
 *   - getAccountBalance(code, ts?)   — per-currency + aggregate balance
 *   - getTrialBalance(ts?)           — per-currency trial balance (must sum to zero)
 *   - getBalanceSheet(ts?)           — assets = liabilities + equity
 *   - getIncomeStatement(from, to?)  — revenue − expenses
 *   - verifyIntegrity()              — recomputes the trial balance from the journal
 *
 * INVARIANTS:
 *   1. Every JournalEntry posted is balanced per currency (validated in entry.ts).
 *   2. The trial balance always sums to zero per currency.
 *   3. The journal is append-only — no in-place mutation of historical entries.
 *
 * `post()` also emits a `ledger.posted` event through the kernel event bus so
 * other protocol modules can react (e.g. snapshot capture, reconciliation
 * triggers). The kernel is NOT mutated — only the event stream is appended to.
 */
import { round } from '@/kernel/support';
import { eventEngine } from '@/kernel/event';
import { getAccount } from './accounts';
import {
  createJournalEntry,
  validateBalanced,
  type JournalEntry,
  type JournalLineInput,
} from './entry';

export interface JournalFilter {
  txId?: string;
  accountCode?: string;
  /** Inclusive lower bound (ms). */
  fromTs?: number;
  /** Inclusive upper bound (ms). */
  toTs?: number;
  /** Restrict to entries whose `frame` matches. */
  frame?: number;
  /** Substring match on description. */
  descriptionContains?: string;
}

export interface AccountBalanceResult {
  accountCode: string;
  /** Sum of all debit lines (across currencies, summed as raw numbers). */
  debit: number;
  /** Sum of all credit lines (across currencies, summed as raw numbers). */
  credit: number;
  /** Signed balance: debit − credit (positive = debit balance, negative = credit balance). */
  balance: number;
  /** Per-currency breakdown. */
  byCurrency: Record<string, { debit: number; credit: number; balance: number }>;
}

export interface TrialBalanceResult {
  asOfTs: number | null;
  byCurrency: Record<
    string,
    {
      accounts: Array<{ accountCode: string; debit: number; credit: number; balance: number }>;
      totalDebits: number;
      totalCredits: number;
      delta: number;
      balanced: boolean;
    }
  >;
  /** Global debit total (sum of every line's debit, across all currencies). */
  totalDebits: number;
  /** Global credit total (sum of every line's credit, across all currencies). */
  totalCredits: number;
  /** True iff every per-currency delta is within epsilon of zero. */
  balanced: boolean;
}

export interface BalanceSheetResult {
  asOfTs: number | null;
  assets: AccountBalanceResult[];
  liabilities: AccountBalanceResult[];
  equity: AccountBalanceResult[];
  /** Sum of asset balances (debit-positive). */
  totalAssets: number;
  /** Sum of liability balances (credit-positive). */
  totalLiabilities: number;
  /** Sum of equity balances (credit-positive). */
  totalEquity: number;
  /** assets − liabilities − equity (must be ~0). */
  delta: number;
  balanced: boolean;
}

export interface IncomeStatementResult {
  fromTs: number;
  toTs: number;
  revenue: AccountBalanceResult[];
  expenses: AccountBalanceResult[];
  totalRevenue: number;
  totalExpenses: number;
  /** revenue − expenses. */
  netIncome: number;
}

export interface IntegrityResult {
  balanced: boolean;
  totalDebits: number;
  totalCredits: number;
  /** |totalDebits − totalCredits| — must be ~0. */
  discrepancy: number;
  /** Per-currency deltas. */
  byCurrency: Record<string, number>;
}

const EPSILON = 1e-6;

export class LedgerEngine {
  /** Append-only journal of posted entries. */
  private journal: JournalEntry[] = [];
  /** Monotonic sequence counter — assigned to each line at post time. */
  private nextSeq = 1;

  /** Post a balanced journal entry. Emits `ledger.posted` event. */
  post(entry: JournalEntry): JournalEntry {
    // Re-validate the balance invariant — defense in depth.
    const check = validateBalanced(entry);
    if (!check.balanced) {
      throw new Error(`Refusing to post unbalanced journal entry ${entry.id} — ${JSON.stringify(check.byCurrency)}`);
    }
    // Stamp each line with a monotonic ledgerSeq. We clone the entry to avoid
    // mutating the caller's frozen object.
    const seqStart = this.nextSeq;
    const stampedEntries = entry.entries.map((line, idx) => ({
      ...line,
      ledgerSeq: seqStart + idx,
    }));
    this.nextSeq += stampedEntries.length;
    const stamped: JournalEntry = {
      ...entry,
      entries: stampedEntries,
    };
    this.journal.push(stamped);

    // Notify the bus — purely additive, no kernel mutation.
    eventEngine.emit(
      'ledger.posted',
      {
        journalId: stamped.id,
        txId: stamped.txId,
        description: stamped.description,
        lineCount: stamped.entries.length,
        totalDebit: round(stamped.entries.reduce((s, e) => s + e.debit, 0), 6),
        totalCredit: round(stamped.entries.reduce((s, e) => s + e.credit, 0), 6),
        currencies: [...new Set(stamped.entries.map((e) => e.currency))],
        ts: stamped.ts,
        frame: stamped.frame ?? 0,
      },
      stamped.frame ?? 0,
    );

    return stamped;
  }

  /** Convenience: build + post in one call. */
  postLines(params: {
    txId?: string;
    description: string;
    ts?: number;
    frame?: number;
    lines: JournalLineInput[];
    evidenceId?: string;
  }): JournalEntry {
    const entry = createJournalEntry(params);
    return this.post(entry);
  }

  /** All entries matching the filter (or all entries if no filter). */
  getJournal(filter?: JournalFilter): JournalEntry[] {
    let list = [...this.journal];
    if (filter?.txId) list = list.filter((j) => j.txId === filter.txId);
    if (filter?.accountCode) {
      list = list.filter((j) => j.entries.some((e) => e.accountCode === filter.accountCode));
    }
    if (filter?.fromTs != null) list = list.filter((j) => j.ts >= filter.fromTs!);
    if (filter?.toTs != null) list = list.filter((j) => j.ts <= filter.toTs!);
    if (filter?.frame != null) list = list.filter((j) => j.frame === filter.frame);
    if (filter?.descriptionContains) {
      const needle = filter.descriptionContains.toLowerCase();
      list = list.filter((j) => j.description.toLowerCase().includes(needle));
    }
    return list.sort((a, b) => a.ts - b.ts);
  }

  /** All individual lines (flattened), optionally filtered. */
  getLines(filter?: JournalFilter): Array<JournalEntry['entries'][number] & { journalId: string; description: string }> {
    const out: Array<JournalEntry['entries'][number] & { journalId: string; description: string }> = [];
    for (const j of this.getJournal(filter)) {
      for (const line of j.entries) {
        out.push({ ...line, journalId: j.id, description: j.description });
      }
    }
    return out;
  }

  /** Compute the balance for an account (optionally up to asOfTs). */
  getAccountBalance(accountCode: string, asOfTs?: number): AccountBalanceResult {
    const byCurrency: Record<string, { debit: number; credit: number; balance: number }> = {};
    let totalDebit = 0;
    let totalCredit = 0;
    for (const j of this.journal) {
      if (asOfTs != null && j.ts > asOfTs) continue;
      for (const line of j.entries) {
        if (line.accountCode !== accountCode) continue;
        if (!byCurrency[line.currency]) byCurrency[line.currency] = { debit: 0, credit: 0, balance: 0 };
        byCurrency[line.currency].debit = round(byCurrency[line.currency].debit + line.debit, 6);
        byCurrency[line.currency].credit = round(byCurrency[line.currency].credit + line.credit, 6);
        totalDebit = round(totalDebit + line.debit, 6);
        totalCredit = round(totalCredit + line.credit, 6);
      }
    }
    for (const c of Object.keys(byCurrency)) {
      byCurrency[c].balance = round(byCurrency[c].debit - byCurrency[c].credit, 6);
    }
    return {
      accountCode,
      debit: totalDebit,
      credit: totalCredit,
      balance: round(totalDebit - totalCredit, 6),
      byCurrency,
    };
  }

  /**
   * Compute the aggregate balance for an account-code PREFIX.
   * E.g. `twintoken:circulating:` sums every line whose accountCode starts
   * with `twintoken:circulating:` (covers the parent + any holder sub-accounts).
   */
  getAccountBalanceByPrefix(prefix: string, asOfTs?: number): AccountBalanceResult {
    const byCurrency: Record<string, { debit: number; credit: number; balance: number }> = {};
    let totalDebit = 0;
    let totalCredit = 0;
    let matchedCode = prefix;
    for (const j of this.journal) {
      if (asOfTs != null && j.ts > asOfTs) continue;
      for (const line of j.entries) {
        if (!line.accountCode.startsWith(prefix)) continue;
        matchedCode = line.accountCode.slice(0, prefix.length);
        if (!byCurrency[line.currency]) byCurrency[line.currency] = { debit: 0, credit: 0, balance: 0 };
        byCurrency[line.currency].debit = round(byCurrency[line.currency].debit + line.debit, 6);
        byCurrency[line.currency].credit = round(byCurrency[line.currency].credit + line.credit, 6);
        totalDebit = round(totalDebit + line.debit, 6);
        totalCredit = round(totalCredit + line.credit, 6);
      }
    }
    for (const c of Object.keys(byCurrency)) {
      byCurrency[c].balance = round(byCurrency[c].debit - byCurrency[c].credit, 6);
    }
    return {
      accountCode: matchedCode,
      debit: totalDebit,
      credit: totalCredit,
      balance: round(totalDebit - totalCredit, 6),
      byCurrency,
    };
  }

  /** All distinct account codes seen in the journal (optionally up to asOfTs). */
  getAccountCodes(asOfTs?: number): string[] {
    const set = new Set<string>();
    for (const j of this.journal) {
      if (asOfTs != null && j.ts > asOfTs) continue;
      for (const line of j.entries) set.add(line.accountCode);
    }
    return [...set].sort();
  }

  /** Trial balance: per-currency debits === credits (must sum to zero). */
  getTrialBalance(asOfTs?: number): TrialBalanceResult {
    interface CurrencyBucket {
      accounts: Array<{ accountCode: string; debit: number; credit: number; balance: number }>;
      totalDebits: number;
      totalCredits: number;
      delta: number;
      balanced: boolean;
    }
    const acc: Record<string, CurrencyBucket> = {};
    let totalDebits = 0;
    let totalCredits = 0;

    for (const code of this.getAccountCodes(asOfTs)) {
      const bal = this.getAccountBalance(code, asOfTs);
      for (const [currency, v] of Object.entries(bal.byCurrency)) {
        if (v.debit === 0 && v.credit === 0) continue;
        if (!acc[currency]) {
          acc[currency] = {
            accounts: [],
            totalDebits: 0,
            totalCredits: 0,
            delta: 0,
            balanced: false,
          };
        }
        acc[currency].accounts.push({
          accountCode: code,
          debit: v.debit,
          credit: v.credit,
          balance: v.balance,
        });
        acc[currency].totalDebits = round(acc[currency].totalDebits + v.debit, 6);
        acc[currency].totalCredits = round(acc[currency].totalCredits + v.credit, 6);
        totalDebits = round(totalDebits + v.debit, 6);
        totalCredits = round(totalCredits + v.credit, 6);
      }
    }

    let balanced = true;
    for (const c of Object.keys(acc)) {
      acc[c].delta = round(acc[c].totalDebits - acc[c].totalCredits, 6);
      acc[c].balanced = Math.abs(acc[c].delta) < EPSILON;
      if (!acc[c].balanced) balanced = false;
      // Sort accounts within currency by code for determinism.
      acc[c].accounts.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    }

    return {
      asOfTs: asOfTs ?? null,
      byCurrency: acc,
      totalDebits,
      totalCredits,
      balanced,
    };
  }

  /** Balance sheet: A = L + E (must hold).
   *
   * Revenue and expense accounts (the "nominal" accounts) are treated as
   * current-period retained earnings — revenue (credit-normal) adds to
   * equity, expense (debit-normal) subtracts. This is the standard
   * "unclosed net income" treatment and makes the balance sheet balance
   * without requiring an explicit period-close journal entry.
   */
  getBalanceSheet(asOfTs?: number): BalanceSheetResult {
    const codes = this.getAccountCodes(asOfTs);
    const assets: AccountBalanceResult[] = [];
    const liabilities: AccountBalanceResult[] = [];
    const equity: AccountBalanceResult[] = [];
    let retainedRevenue = 0;
    let retainedExpense = 0;
    for (const code of codes) {
      const bal = this.getAccountBalance(code, asOfTs);
      // Skip accounts with zero net balance AND zero movement.
      if (bal.debit === 0 && bal.credit === 0) continue;
      const meta = getAccount(code);
      switch (meta.type) {
        case 'asset':
          assets.push(bal);
          break;
        case 'liability':
          liabilities.push(bal);
          break;
        case 'equity':
          equity.push(bal);
          break;
        case 'revenue':
          // Revenue is credit-normal → balance (DR − CR) is negative when there's
          // revenue. Negate to get the positive contribution to equity.
          retainedRevenue = round(retainedRevenue - bal.balance, 6);
          break;
        case 'expense':
          // Expense is debit-normal → balance is positive when there's expense.
          retainedExpense = round(retainedExpense + bal.balance, 6);
          break;
        default:
          break;
      }
    }
    const totalAssets = round(assets.reduce((s, a) => s + a.balance, 0), 6);
    // Liabilities and equity have credit-normal balances, so the "balance"
    // (debit − credit) is negative when the account has its normal balance.
    // We negate so that positive = liability/equity balance.
    const totalLiabilities = round(liabilities.reduce((s, a) => s - a.balance, 0), 6);
    const totalEquity = round(
      equity.reduce((s, a) => s - a.balance, 0) + retainedRevenue - retainedExpense,
      6,
    );
    const delta = round(totalAssets - totalLiabilities - totalEquity, 6);
    return {
      asOfTs: asOfTs ?? null,
      assets: assets.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      liabilities: liabilities.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      equity: equity.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      totalAssets,
      totalLiabilities,
      totalEquity,
      delta,
      balanced: Math.abs(delta) < EPSILON,
    };
  }

  /** Income statement: revenue − expenses for [fromTs, toTs]. */
  getIncomeStatement(fromTs: number, toTs?: number): IncomeStatementResult {
    const upper = toTs ?? Date.now();
    const codes = this.getAccountCodes(upper);
    const revenue: AccountBalanceResult[] = [];
    const expenses: AccountBalanceResult[] = [];
    for (const code of codes) {
      const meta = getAccount(code);
      if (meta.type !== 'revenue' && meta.type !== 'expense') continue;
      // Recompute balance for the [fromTs, toTs] window.
      const byCurrency: Record<string, { debit: number; credit: number; balance: number }> = {};
      let totalDebit = 0;
      let totalCredit = 0;
      for (const j of this.journal) {
        if (j.ts < fromTs || j.ts > upper) continue;
        for (const line of j.entries) {
          if (line.accountCode !== code) continue;
          if (!byCurrency[line.currency]) byCurrency[line.currency] = { debit: 0, credit: 0, balance: 0 };
          byCurrency[line.currency].debit = round(byCurrency[line.currency].debit + line.debit, 6);
          byCurrency[line.currency].credit = round(byCurrency[line.currency].credit + line.credit, 6);
          totalDebit = round(totalDebit + line.debit, 6);
          totalCredit = round(totalCredit + line.credit, 6);
        }
      }
      if (totalDebit === 0 && totalCredit === 0) continue;
      for (const c of Object.keys(byCurrency)) {
        byCurrency[c].balance = round(byCurrency[c].debit - byCurrency[c].credit, 6);
      }
      const bal: AccountBalanceResult = {
        accountCode: code,
        debit: totalDebit,
        credit: totalCredit,
        balance: round(totalDebit - totalCredit, 6),
        byCurrency,
      };
      if (meta.type === 'revenue') revenue.push(bal);
      else expenses.push(bal);
    }
    const totalRevenue = round(revenue.reduce((s, r) => s - r.balance, 0), 6); // credit-normal: negate
    const totalExpenses = round(expenses.reduce((s, e) => s + e.balance, 0), 6); // debit-normal: positive
    return {
      fromTs,
      toTs: upper,
      revenue: revenue.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      expenses: expenses.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
      totalRevenue,
      totalExpenses,
      netIncome: round(totalRevenue - totalExpenses, 6),
    };
  }

  /** Recompute the trial balance from the journal and assert it balances. */
  verifyIntegrity(): IntegrityResult {
    const tb = this.getTrialBalance();
    const byCurrency: Record<string, number> = {};
    for (const [c, v] of Object.entries(tb.byCurrency)) byCurrency[c] = v.delta;
    return {
      balanced: tb.balanced,
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
      discrepancy: round(Math.abs(tb.totalDebits - tb.totalCredits), 6),
      byCurrency,
    };
  }

  /** Number of journal entries posted. */
  size(): number {
    return this.journal.length;
  }

  /** Total number of debit/credit lines. */
  lineCount(): number {
    return this.journal.reduce((s, j) => s + j.entries.length, 0);
  }

  /** Reset the engine (clears the journal). Mainly for tests / rebuilds. */
  reset(): void {
    this.journal = [];
    this.nextSeq = 1;
  }

  /** Internal: assign a deterministic id-seed for reproducible projections. */
  _seedSeq(seed: number): void {
    this.nextSeq = seed;
  }
}

/** Singleton instance — used by callers who want a shared ledger.
 *  The event-projection rebuild path creates fresh instances. */
export const ledgerEngine = new LedgerEngine();

/** Re-export types & helpers for callers. */
export { createJournalEntry, validateBalanced };
export type { JournalEntry, JournalLineInput, LedgerEntry } from './entry';
