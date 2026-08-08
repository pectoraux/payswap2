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
import { accountType, getAccount } from './accounts';
import {
  createJournalEntry,
  validateBalanced,
  type JournalEntry,
  type LedgerEntry,
  type CreateJournalEntryParams,
  type BalanceCheckResult,
} from './entry';

/**
 * P2-1 (C-4 fix): the ledger engine now persists every posted journal entry
 * to the `LedgerEntryRecord` Postgres table. The in-memory `journals` array
 * remains as a read cache; the DB is the source of truth. On startup the
 * singleton calls `rehydrateFromDB()` to reload the cache (see
 * `src/instrumentation.ts`).
 *
 * The Prisma client import is lazy — instantiating the client does not open
 * a DB connection. The connection only opens on the first query, so importing
 * this module in tests (which never call `persist()` or `rehydrateFromDB()`)
 * does not require a reachable database.
 */
import { db } from '@/lib/db';

/**
 * Options for `LedgerEngine.persist()` and `postAndPersist()`.
 *
 * - `tx`: optional Prisma transaction client. If provided, the ledger write
 *   participates in the caller's transaction. If omitted, the default `db`
 *   client is used (the ledger write runs in its own implicit transaction).
 * - `runId`: partition key for the `LedgerEntryRecord` table. The live
 *   ledger uses `'live'`; simulation runs use their own run id.
 */
export interface PersistOptions {
  tx?: any;
  runId?: string;
}

/** Default runId for the live (production) ledger. */
const LIVE_RUN_ID = 'live';

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
    /** Singular-field alias (kept for compatibility with origin/main callers). */
    totalDebits: number;
    /** Singular-field alias (kept for compatibility with origin/main callers). */
    totalCredits: number;
    /** Signed delta = totalDebit - totalCredit (0 when balanced). */
    delta: number;
    /** True when this currency's debit total equals its credit total. */
    balanced: boolean;
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
  /**
   * Guard flag: once `rehydrateFromDB()` has loaded the cache from Postgres,
   * subsequent calls become no-ops (until `reset()` clears it). Prevents
   * double-loading if `register()` runs twice in dev (Next.js HMR).
   */
  private rehydrated = false;

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

  /**
   * P2-1 (C-4 fix): persist a posted journal entry to the `LedgerEntryRecord`
   * Postgres table. Each leg becomes one row. `balanceAfter` is computed
   * from the in-memory cache (which `post()` just updated) per account.
   *
   * Best-effort: callers should wrap in try/catch — a failure here does NOT
   * unwind the in-memory cache (the cache is the read path; the DB is the
   * durable truth). On the money path this is called AFTER the Prisma
   * balance-update transaction commits, so a ledger-write failure cannot
   * un-move the money.
   *
   * @param journal  The journal entry to persist (must already be posted).
   * @param opts.tx  Optional Prisma transaction client. If provided, the
   *                 ledger rows are written within the caller's transaction.
   *                 If omitted, the default `db` client is used.
   * @param opts.runId  Partition key for `LedgerEntryRecord`. Defaults to
   *                 `'live'` for the production ledger.
   */
  async persist(journal: JournalEntry, opts?: PersistOptions): Promise<void> {
    const client = opts?.tx ?? db;
    const runId = opts?.runId ?? LIVE_RUN_ID;

    // Compute the post-balance for each leg's account from the in-memory
    // cache (which `post()` already mutated). If multiple legs of the same
    // journal touch the same account, they share the same balanceAfter
    // (the final balance after the whole journal is applied).
    const balanceByAccount = new Map<string, number>();
    for (const leg of journal.entries) {
      if (!balanceByAccount.has(leg.accountCode)) {
        const bal = this.getAccountBalance(leg.accountCode);
        balanceByAccount.set(leg.accountCode, bal.balance);
      }
    }

    const rows = journal.entries.map((leg) => {
      const def = getAccount(leg.accountCode);
      return {
        runId,
        txId: journal.txId,
        accountId: leg.accountCode,
        accountLabel: def?.label ?? null,
        accountType: def?.type ?? accountType(leg.accountCode),
        currency: leg.currency,
        debit: leg.debit,
        credit: leg.credit,
        balanceAfter: balanceByAccount.get(leg.accountCode) ?? 0,
        memo: leg.memo ?? journal.description,
        frame: leg.frame ?? journal.frame ?? 0,
      };
    });

    await client.ledgerEntryRecord.createMany({ data: rows });
  }

  /**
   * Convenience: build a journal entry from raw legs, post it to the
   * in-memory cache (sync), then persist it to Postgres (async, best-effort).
   *
   * If `persist()` throws, the error is logged but NOT re-thrown — the
   * in-memory cache is already updated, and the caller's money movement
   * (which happened before this call) is unaffected. Returns the posted
   * journal entry regardless of whether the DB write succeeded.
   */
  async postAndPersist(
    params: Omit<CreateJournalEntryParams, 'startSeq'>,
    opts?: PersistOptions,
  ): Promise<JournalEntry> {
    const journal = createJournalEntry({ ...params, startSeq: this.nextSeq });
    this.post(journal);
    try {
      await this.persist(journal, opts);
    } catch (err) {
      console.error(
        `[LedgerEngine] persist() failed for journal ${journal.id} (txId=${journal.txId}) — in-memory cache updated, DB write failed:`,
        err,
      );
    }
    return journal;
  }

  /**
   * P2-1 (C-4 fix): rehydrate the in-memory cache from the
   * `LedgerEntryRecord` Postgres table. Called once on server startup
   * (see `src/instrumentation.ts`). After this runs, the in-memory
   * `journals` + `entries` arrays mirror the DB, and `nextSeq` continues
   * past the highest persisted leg.
   *
   * Idempotent: a second call is a no-op (guarded by `rehydrated` flag,
   * cleared by `reset()`).
   *
   * @param opts.runId  If provided, only rows with this runId are loaded.
   *                    Defaults to the live run (`'live'`).
   */
  async rehydrateFromDB(opts?: PersistOptions): Promise<{ loaded: number; legs: number }> {
    if (this.rehydrated) return { loaded: 0, legs: 0 };
    this.rehydrated = true;

    const client = opts?.tx ?? db;
    const runId = opts?.runId ?? LIVE_RUN_ID;

    const records = await client.ledgerEntryRecord.findMany({
      where: { runId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    // Group records by txId to reconstruct journal entries. Each txId maps
    // to one JournalEntry; its legs are the LedgerEntryRecord rows.
    const journalsByTxId = new Map<string, JournalEntry>();
    for (const r of records) {
      const txId = r.txId ?? `orphan:${r.id}`;
      let j = journalsByTxId.get(txId);
      if (!j) {
        j = {
          id: `recovered:${txId}`,
          ts: r.createdAt.getTime(),
          txId,
          description: r.memo ?? '(rehydrated from DB)',
          entries: [],
          balanced: true,
          frame: r.frame ?? undefined,
        };
        journalsByTxId.set(txId, j);
      }
      j.entries.push({
        id: r.id,
        ts: r.createdAt.getTime(),
        ledgerSeq: this.nextSeq++,
        txId,
        accountCode: r.accountId ?? 'unknown',
        debit: Number(r.debit),
        credit: Number(r.credit),
        currency: r.currency ?? 'USD',
        memo: r.memo ?? '',
        frame: r.frame ?? undefined,
      });
    }

    for (const j of journalsByTxId.values()) {
      this.journals.push(j);
      this.entries.push(...j.entries);
    }

    return { loaded: journalsByTxId.size, legs: records.length };
  }

  /** Convenience: build and post a journal entry from raw legs in one call. */
  postFromLegs(params: Omit<CreateJournalEntryParams, 'startSeq'>): JournalEntry {
    const journal = createJournalEntry({ ...params, startSeq: this.nextSeq });
    return this.post(journal);
  }

  /**
   * Alias for `postFromLegs` — accepts the same params (with `lines` accepted
   * as an alias for `legs` inside `createJournalEntry`). Provided so callers
   * written against the `postLines` API name continue to work (test compat).
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

  /**
   * Per-account signed balance + debit/credit breakdown + per-currency detail.
   *
   * Returns an object so callers can read either the rolled-up `balance`
   * or the per-currency breakdown. (`getAccountDetail` is an alias kept
   * for compatibility with callers introduced by origin/main.)
   *
   * MON-3: `e.debit` / `e.credit` are `Money` — summed via integer minor
   * units internally, returned as `number` at the boundary.
   */
  getAccountBalance(accountCode: string, asOfTs?: number): {
    debit: number;
    credit: number;
    /** Signed balance = debit - credit. */
    balance: number;
    /** Per-currency breakdown for this account. */
    byCurrency: Record<string, { debit: number; credit: number; balance: number }>;
  } {
    let debitCents = 0, creditCents = 0;
    const byCurrency: Record<string, { debit: number; credit: number; balance: number }> = {};
    for (const e of this.entries) {
      if (e.accountCode !== accountCode) continue;
      if (asOfTs != null && e.ts > asOfTs) continue;
      // MON-3: extract minor units from Money, sum as integers.
      const dCents = Number(e.debit.minorUnits);
      const cCents = Number(e.credit.minorUnits);
      debitCents += dCents;
      creditCents += cCents;
      let cur = byCurrency[e.currency];
      if (!cur) {
        cur = { debit: 0, credit: 0, balance: 0 };
        byCurrency[e.currency] = cur;
      }
      cur.debit = Math.round(cur.debit * 100 + dCents) / 100;
      cur.credit = Math.round(cur.credit * 100 + cCents) / 100;
      cur.balance = Math.round(cur.debit * 100 - cur.credit * 100) / 100;
    }
    return {
      debit: debitCents / 100,
      credit: creditCents / 100,
      balance: (debitCents - creditCents) / 100,
      byCurrency,
    };
  }

  /** Alias for `getAccountBalance` (test compatibility — same return shape). */
  getAccountDetail(accountCode: string, asOfTs?: number): {
    debit: number; credit: number; balance: number;
    byCurrency: Record<string, { debit: number; credit: number; balance: number }>;
  } {
    return this.getAccountBalance(accountCode, asOfTs);
  }

  /** All account codes that have at least one leg, sorted alphabetically. */
  activeAccounts(): string[] {
    const set = new Set<string>();
    for (const e of this.entries) set.add(e.accountCode);
    return [...set].sort();
  }

  /** Alias for `activeAccounts()` — account codes with at least one leg (test compatibility). */
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
    const byCurrency: Record<string, { totalDebit: number; totalCredit: number; totalDebits: number; totalCredits: number; delta: number; balanced: boolean }> = {};
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
      if (!c) { c = { totalDebit: 0, totalCredit: 0, totalDebits: 0, totalCredits: 0, delta: 0, balanced: false }; byCurrency[e.currency] = c; }
      c.totalDebit = Math.round(c.totalDebit * 100 + dCents) / 100;
      c.totalCredit = Math.round(c.totalCredit * 100 + cCents) / 100;
      c.totalDebits = c.totalDebit;
      c.totalCredits = c.totalCredit;
    }
    for (const code of Object.keys(accounts)) {
      accounts[code].balance = Math.round(accounts[code].debit * 100 - accounts[code].credit * 100) / 100;
    }
    for (const ccy of Object.keys(byCurrency)) {
      const deltaCents = Math.round(byCurrency[ccy].totalDebit * 100 - byCurrency[ccy].totalCredit * 100);
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
    this.rehydrated = false;
  }

  /** Current next-sequence counter (useful for snapshots). */
  currentSeq(): number {
    return this.nextSeq;
  }

  /**
   * Alias for `getTrialBalance()` — the canonical accounting equation check
   * (sum of debits must equal sum of credits, per currency). Used by the
   * post-transaction assertion in money routes (P2-1 Part C).
   */
  trialBalance(asOfTs?: number): TrialBalance {
    return this.getTrialBalance(asOfTs);
  }

  /**
   * Alias for `getBalanceSheet()` — the canonical A = L + E check. Used by
   * the post-transaction assertion in the transfer route (P2-1 Part C).
   */
  balanceSheet(asOfTs?: number): BalanceSheet {
    return this.getBalanceSheet(asOfTs);
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
