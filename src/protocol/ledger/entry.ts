/**
 * PaySwap Protocol — Ledger Journal Entries.
 *
 * A LedgerEntry is the atomic unit of the protocol ledger: a single
 * debit or credit against one account, in one currency, at one instant.
 *
 * A JournalEntry is a balanced group of LedgerEntries describing one
 * business transaction (e.g. "mint TWINGHS 1000"). Every JournalEntry must
 * satisfy, per currency:
 *
 *     sum(debits) === sum(credits)
 *
 * This is the fundamental invariant of double-entry bookkeeping. The
 * `createJournalEntry()` constructor enforces it; `validateBalanced()`
 * re-checks an existing entry.
 */
import { uid, nowTs, round } from '@/kernel/support';

/** Helper: create a debit leg. */
export function debit(accountCode: string, amount: number, currency: string, memo?: string): {
  accountCode: string; debit: number; credit: number; currency: string; memo?: string;
} {
  return { accountCode, debit: amount, credit: 0, currency, memo };
}

/** Helper: create a credit leg. */
export function credit(accountCode: string, amount: number, currency: string, memo?: string): {
  accountCode: string; debit: number; credit: number; currency: string; memo?: string;
} {
  return { accountCode, debit: 0, credit: amount, currency, memo };
}

/** A single debit or credit against one account. Exactly one of debit/credit is non-zero. */
export interface LedgerEntry {
  /** Unique id of this leg. */
  id: string;
  /** Timestamp (ms since epoch). */
  ts: number;
  /** Monotonically increasing ledger sequence number, assigned on post. */
  ledgerSeq: number;
  /** Id of the parent transaction this leg belongs to. */
  txId: string;
  /** Fully-qualified account code (see CHART_OF_ACCOUNTS). */
  accountCode: string;
  /** Debit amount (zero for a credit-only leg). */
  debit: number;
  /** Credit amount (zero for a debit-only leg). */
  credit: number;
  /** ISO currency code (or asset code for twin-token accounts). */
  currency: string;
  /** Free-form memo describing the leg. */
  memo: string;
  /** Optional evidence id cited by this leg (audit chain). */
  evidenceId?: string;
  /** Optional simulation frame this leg belongs to. */
  frame?: number;
}

/** A balanced group of LedgerEntries describing one business transaction. */
export interface JournalEntry {
  /** Unique journal id. */
  id: string;
  /** Timestamp (ms since epoch). */
  ts: number;
  /** Transaction id — links back to the originating domain operation. */
  txId: string;
  /** Human-readable description of the transaction. */
  description: string;
  /** The debit/credit legs of the journal entry. */
  entries: LedgerEntry[];
  /** Whether the entry is balanced (sum debits === sum credits per currency). */
  balanced: boolean;
  /** Optional simulation frame this journal belongs to. */
  frame?: number;
  /** Optional evidence id cited by this journal entry. */
  evidenceId?: string;
}

/** Input leg for constructing a journal entry. */
export interface JournalLegInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  currency: string;
  memo?: string;
  evidenceId?: string;
  frame?: number;
}

/** Input for `createJournalEntry()`. */
export interface CreateJournalEntryParams {
  /** Transaction id linking to the originating domain operation. */
  txId?: string;
  /** Human-readable description. */
  description: string;
  /** The legs (debit/credit movements). */
  legs?: JournalLegInput[];
  /** Alias for legs (test compatibility). */
  lines?: JournalLegInput[];
  /** Optional explicit timestamp (defaults to now). */
  ts?: number;
  /** Optional explicit journal id (defaults to generated). */
  id?: string;
  /** Optional simulation frame. */
  frame?: number;
  /** Optional evidence id cited by the whole journal entry. */
  evidenceId?: string;
  /** Starting ledger sequence number (defaults to 0). */
  startSeq?: number;
}

/**
 * Build a balanced JournalEntry from a set of legs.
 *
 * Validates that, for every currency, the sum of debits equals the sum of
 * credits. Throws if unbalanced. Each leg must have exactly one of debit or
 * credit non-zero (and that value must be positive).
 *
 * `ledgerSeq` is assigned incrementally starting from `startSeq` (default 0).
 * The caller is responsible for using a startSeq that continues from the
 * engine's current sequence counter; the LedgerEngine wrapper does this
 * automatically.
 */
export function createJournalEntry(params: CreateJournalEntryParams): JournalEntry {
  const ts = params.ts ?? nowTs();
  const txId = params.txId;
  let seq = params.startSeq ?? 0;

  // Validate legs and build the entries array.
  // Accept both `legs` and `lines` (test compatibility).
  const legs = params.legs ?? params.lines ?? [];
  if (legs.length === 0) {
    throw new Error('journal entry has no legs');
  }
  const entries: LedgerEntry[] = [];
  for (const leg of legs) {
    const debit = leg.debit ?? 0;
    const credit = leg.credit ?? 0;
    if (debit < 0 || credit < 0) {
      throw new Error(`ledger leg cannot have negative amounts (debit=${debit}, credit=${credit})`);
    }
    if (debit > 0 && credit > 0) {
      throw new Error(`ledger leg cannot be both debit and credit (account=${leg.accountCode})`);
    }
    if (debit === 0 && credit === 0) {
      throw new Error(`ledger leg has zero debit and zero credit (account=${leg.accountCode})`);
    }
    if (!leg.currency) {
      throw new Error(`ledger leg missing currency (account=${leg.accountCode})`);
    }
    entries.push({
      id: uid('le'),
      ts,
      ledgerSeq: seq++,
      txId,
      accountCode: leg.accountCode,
      // MON-4: round to integer micro-units (1e-6) for exact storage.
      // No float tolerance — the balance check uses exact integer comparison.
      debit: Math.round(debit * 1e6) / 1e6,
      credit: Math.round(credit * 1e6) / 1e6,
      currency: leg.currency,
      memo: leg.memo ?? params.description,
      evidenceId: leg.evidenceId ?? params.evidenceId,
      frame: leg.frame ?? params.frame,
    });
  }

  if (entries.length === 0) {
    throw new Error('journal entry has no legs');
  }

  const balanced = validateBalancedInner(entries);
  if (!balanced.balanced) {
    throw new Error(
      `Unbalanced journal entry — ${balanced.mismatches
        .map((m) => `currency ${m.currency}: debit ${m.totalDebit} ≠ credit ${m.totalCredit}`)
        .join('; ')}`,
    );
  }

  return {
    id: params.id ?? uid('je'),
    ts,
    txId,
    description: params.description,
    entries,
    balanced: true,
    frame: params.frame,
    evidenceId: params.evidenceId,
  };
}

/** Per-currency balance check result for a journal entry. */
export interface BalanceCheckResult {
  balanced: boolean;
  /** Per-currency totals. */
  currencies: {
    currency: string;
    totalDebit: number;
    totalCredit: number;
    difference: number;
  }[];
  /** Only the currencies that did not balance (empty when balanced). */
  mismatches: {
    currency: string;
    totalDebit: number;
    totalCredit: number;
    difference: number;
  }[];
  /** Per-currency map (test compatibility). */
  byCurrency?: Record<string, { totalDebit: number; totalCredit: number; difference: number; delta: number; balanced: boolean }>;
}

/**
 * Re-check that a JournalEntry is balanced across every currency.
 * Does not throw — returns the per-currency breakdown instead.
 */
export function validateBalanced(journal: JournalEntry): BalanceCheckResult {
  return validateBalancedInner(journal.entries);
}

/** Internal: per-currency debit/credit balance check.
 *
 * MON-4: exact integer comparison. Previously used `round(x, 6)` + `1e-6`
 * tolerance — a tolerance that could conceal a one-cent-per-transaction
 * leak. Now: sums are rounded to integer micro-units (1e-6) and compared
 * with exact equality. A one-micro-unit discrepancy fails the check.
 */
function validateBalancedInner(entries: LedgerEntry[]): BalanceCheckResult {
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const e of entries) {
    let t = totals.get(e.currency);
    if (!t) {
      t = { debit: 0, credit: 0 };
      totals.set(e.currency, t);
    }
    t.debit += e.debit;
    t.credit += e.credit;
  }

  const currencies: BalanceCheckResult['currencies'] = [];
  const mismatches: BalanceCheckResult['mismatches'] = [];
  for (const [currency, t] of totals) {
    // Round to integer micro-units for exact comparison.
    const debitMicro = Math.round(t.debit * 1e6);
    const creditMicro = Math.round(t.credit * 1e6);
    const diffMicro = debitMicro - creditMicro;
    const diff = diffMicro / 1e6;
    currencies.push({
      currency,
      totalDebit: debitMicro / 1e6,
      totalCredit: creditMicro / 1e6,
      difference: diff,
    });
    if (diffMicro !== 0) {
      mismatches.push({
        currency,
        totalDebit: debitMicro / 1e6,
        totalCredit: creditMicro / 1e6,
        difference: diff,
      });
    }
  }

  const byCurrency: Record<string, { totalDebit: number; totalCredit: number; difference: number; delta: number; balanced: boolean }> = {};
  for (const c of currencies) {
    byCurrency[c.currency] = {
      totalDebit: c.totalDebit,
      totalCredit: c.totalCredit,
      difference: c.difference,
      delta: c.difference,
      balanced: c.difference === 0,
    };
  }

  return {
    balanced: mismatches.length === 0,
    currencies,
    mismatches,
    byCurrency,
  };
}
