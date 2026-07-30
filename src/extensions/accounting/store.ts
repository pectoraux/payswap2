/**
 * Accounting Extension — Domain Store + Logic.
 *
 * Double-entry bookkeeping with strict invariants. Every journal entry has
 * balanced debits and credits (enforced at record time). Uses Money (exact
 * BigInt) for all amounts — never float.
 */

import { uid } from '@/runtime/types';
import { Money, money } from '@/money';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AccountType = 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'EQUITY';

export interface Account {
  id: string;                  // e.g. 'acc_cash', 'acc_revenue'
  code: string;                // e.g. '1000', '4000'
  name: string;
  type: AccountType;
  normalBalance: 'DEBIT' | 'CREDIT'; // ASSET/EXPENSE → DEBIT; LIABILITY/REVENUE/EQUITY → CREDIT
  active: boolean;
  createdAt: number;
}

export interface JournalLine {
  accountId: string;
  debit: Money;                // exact; zero if this line is a credit
  credit: Money;               // exact; zero if this line is a debit
}

export interface JournalEntry {
  id: string;
  entryNumber: string;         // e.g. 'JE-20240101-001'
  date: number;
  description: string;
  lines: JournalLine[];
  total: Money;                // sum of debits (== sum of credits)
  reference?: string;          // paymentId, deliveryId, etc.
  source?: 'manual' | 'payment' | 'delivery' | 'loyalty';
  postedAt: number;
}

export type ReconciliationStatus = 'PENDING' | 'MATCHED' | 'DISCREPANCY';

export interface Reconciliation {
  id: string;
  accountId: string;
  periodStart: number;
  periodEnd: number;
  ledgerBalance: Money;        // computed from journal entries
  statementBalance: Money;     // from external statement
  difference: Money;           // exact
  status: ReconciliationStatus;
  createdAt: number;
  notes?: string;
}

export interface PnLReport {
  id: string;
  periodStart: number;
  periodEnd: number;
  totalRevenue: Money;
  totalExpenses: Money;
  netProfit: Money;            // revenue − expenses
  revenueByAccount: Array<{ account: Account; total: Money }>;
  expensesByAccount: Array<{ account: Account; total: Money }>;
  generatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

interface AccountingStore {
  accounts: Map<string, Account>;
  entries: JournalEntry[];
  reconciliations: Map<string, Reconciliation>;
  pnlReports: Map<string, PnLReport>;
  entryCounter: number;
}

const globalForAccounting = globalThis as unknown as { __ACCOUNTING_STORE__?: AccountingStore };

const store: AccountingStore = globalForAccounting.__ACCOUNTING_STORE__ ?? {
  accounts: new Map(),
  entries: [],
  reconciliations: new Map(),
  pnlReports: new Map(),
  entryCounter: 0,
};

if (!globalForAccounting.__ACCOUNTING_STORE__) {
  globalForAccounting.__ACCOUNTING_STORE__ = store;
  seedAccounts();
}

// ═══════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export const accountingService = {
  // ── Accounts ──
  listAccounts(type?: AccountType): Account[] {
    let rows = Array.from(store.accounts.values());
    if (type) rows = rows.filter((a) => a.type === type);
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  },
  getAccount(id: string): Account | undefined { return store.accounts.get(id); },

  // ── Journal entries (double-entry with ACID balance invariant) ──
  recordEntry(input: {
    date?: number; description: string; lines: Array<{ accountId: string; debit?: number; credit?: number }>;
    reference?: string; source?: 'manual' | 'payment' | 'delivery' | 'loyalty';
  }): JournalEntry {
    if (input.lines.length < 2) throw new Error('A journal entry requires at least 2 lines (debit + credit)');

    // Convert to exact Money, validate accounts exist
    const journalLines: JournalLine[] = input.lines.map((l) => {
      const account = store.accounts.get(l.accountId);
      if (!account) throw new Error(`Unknown account: ${l.accountId}`);
      if (l.debit && l.credit) throw new Error(`A line cannot be both debit and credit: ${l.accountId}`);
      const debit = l.debit ? money.usd(l.debit) : money.usd(0);
      const credit = l.credit ? money.usd(l.credit) : money.usd(0);
      if (debit.isZero() && credit.isZero()) throw new Error(`Line has zero amount: ${l.accountId}`);
      return { accountId: l.accountId, debit, credit };
    });

    // ACID invariant: debits must equal credits (exact BigInt comparison)
    const totalDebit = Money.sum(journalLines.map((l) => l.debit));
    const totalCredit = Money.sum(journalLines.map((l) => l.credit));
    if (!totalDebit.equals(totalCredit)) {
      throw new Error(`Unbalanced entry: debits ${totalDebit.toMajorString()} ≠ credits ${totalCredit.toMajorString()}`);
    }

    store.entryCounter += 1;
    const entry: JournalEntry = {
      id: uid('je'),
      entryNumber: `JE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(store.entryCounter).padStart(4, '0')}`,
      date: input.date ?? Date.now(),
      description: input.description,
      lines: journalLines,
      total: totalDebit,
      reference: input.reference,
      source: input.source ?? 'manual',
      postedAt: Date.now(),
    };
    store.entries.push(entry);
    if (store.entries.length > 10000) store.entries.length = 10000;
    return entry;
  },

  getEntry(id: string): JournalEntry | undefined {
    return store.entries.find((e) => e.id === id);
  },

  getLedger(filter?: { accountId?: string; from?: number; to?: number }): JournalEntry[] {
    let rows = [...store.entries];
    if (filter?.accountId) {
      rows = rows.filter((e) => e.lines.some((l) => l.accountId === filter.accountId));
    }
    if (filter?.from) rows = rows.filter((e) => e.date >= filter.from!);
    if (filter?.to) rows = rows.filter((e) => e.date <= filter.to!);
    return rows.sort((a, b) => a.date - b.date);
  },

  /** Compute the running balance of an account (exact Money). */
  getAccountBalance(accountId: string): Money {
    const account = store.accounts.get(accountId);
    if (!account) throw new Error(`Unknown account: ${accountId}`);
    let debitSum = money.usd(0);
    let creditSum = money.usd(0);
    for (const e of store.entries) {
      for (const l of e.lines) {
        if (l.accountId === accountId) {
          debitSum = debitSum.add(l.debit);
          creditSum = creditSum.add(l.credit);
        }
      }
    }
    // Normal balance: ASSET/EXPENSE increase on debit; LIABILITY/REVENUE/EQUITY on credit
    return account.normalBalance === 'DEBIT'
      ? debitSum.subtract(creditSum)
      : creditSum.subtract(debitSum);
  },

  // ── P&L ──
  generatePnL(periodStart: number, periodEnd: number): PnLReport {
    const entries = store.entries.filter((e) => e.date >= periodStart && e.date <= periodEnd);
    const revenueByAccount = new Map<string, Money>();
    const expensesByAccount = new Map<string, Money>();
    for (const e of entries) {
      for (const l of e.lines) {
        const account = store.accounts.get(l.accountId);
        if (!account) continue;
        if (account.type === 'REVENUE') {
          // Revenue increases on credit
          const cur = revenueByAccount.get(l.accountId) ?? money.usd(0);
          revenueByAccount.set(l.accountId, cur.add(l.credit).subtract(l.debit));
        } else if (account.type === 'EXPENSE') {
          // Expense increases on debit
          const cur = expensesByAccount.get(l.accountId) ?? money.usd(0);
          expensesByAccount.set(l.accountId, cur.add(l.debit).subtract(l.credit));
        }
      }
    }
    const revenueRows = Array.from(revenueByAccount.entries())
      .map(([accountId, total]) => ({ account: store.accounts.get(accountId)!, total }))
      .filter((r) => !r.total.isZero());
    const expenseRows = Array.from(expensesByAccount.entries())
      .map(([accountId, total]) => ({ account: store.accounts.get(accountId)!, total }))
      .filter((r) => !r.total.isZero());
    const totalRevenue = revenueRows.length > 0
      ? Money.sum(revenueRows.map((r) => r.total)) : money.usd(0);
    const totalExpenses = expenseRows.length > 0
      ? Money.sum(expenseRows.map((r) => r.total)) : money.usd(0);
    const netProfit = totalRevenue.subtract(totalExpenses);
    const report: PnLReport = {
      id: uid('pnl'),
      periodStart, periodEnd,
      totalRevenue, totalExpenses, netProfit,
      revenueByAccount: revenueRows,
      expensesByAccount: expenseRows,
      generatedAt: Date.now(),
    };
    store.pnlReports.set(report.id, report);
    return report;
  },

  // ── Reconciliation ──
  reconcile(input: {
    accountId: string; periodStart: number; periodEnd: number;
    statementBalance: number; notes?: string;
  }): Reconciliation {
    const account = store.accounts.get(input.accountId);
    if (!account) throw new Error(`Unknown account: ${input.accountId}`);
    const ledgerBalance = accountingService.getAccountBalance(input.accountId);
    const statement = money.usd(input.statementBalance);
    const difference = ledgerBalance.subtract(statement);
    const rec: Reconciliation = {
      id: uid('rec'),
      accountId: input.accountId,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      ledgerBalance, statementBalance: statement, difference,
      status: difference.isZero() ? 'MATCHED' : 'DISCREPANCY',
      createdAt: Date.now(),
      notes: input.notes,
    };
    store.reconciliations.set(rec.id, rec);
    return rec;
  },

  listReconciliations(): Reconciliation[] {
    return Array.from(store.reconciliations.values()).sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Export ──
  exportLedger(filter?: { accountId?: string; from?: number; to?: number }): {
    entries: JournalEntry[]; accounts: Account[]; exportedAt: number;
  } {
    return {
      entries: accountingService.getLedger(filter),
      accounts: accountingService.listAccounts(),
      exportedAt: Date.now(),
    };
  },

  // ── Stats ──
  stats() {
    return {
      totalAccounts: store.accounts.size,
      totalEntries: store.entries.length,
      totalReconciliations: store.reconciliations.size,
      unmatchedReconciliations: Array.from(store.reconciliations.values()).filter((r) => r.status === 'DISCREPANCY').length,
      cashBalance: accountingService.getAccountBalance('acc_cash').toJSON(),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SEED — 5 accounts (1 of each type)
// ═══════════════════════════════════════════════════════════════════════════

function seedAccounts() {
  const accounts: Account[] = [
    { id: 'acc_cash', code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', active: true, createdAt: Date.now() },
    { id: 'acc_inventory', code: '1200', name: 'Inventory', type: 'ASSET', normalBalance: 'DEBIT', active: true, createdAt: Date.now() },
    { id: 'acc_payable', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT', active: true, createdAt: Date.now() },
    { id: 'acc_revenue', code: '4000', name: 'Sales Revenue', type: 'REVENUE', normalBalance: 'CREDIT', active: true, createdAt: Date.now() },
    { id: 'acc_cogs', code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', normalBalance: 'DEBIT', active: true, createdAt: Date.now() },
    { id: 'acc_marketing', code: '6000', name: 'Marketing Expense', type: 'EXPENSE', normalBalance: 'DEBIT', active: true, createdAt: Date.now() },
    { id: 'acc_equity', code: '3000', name: 'Owner\'s Equity', type: 'EQUITY', normalBalance: 'CREDIT', active: true, createdAt: Date.now() },
  ];
  for (const a of accounts) store.accounts.set(a.id, a);
}
