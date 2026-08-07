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
import { Money } from '@/money/money';

/** Helper: create a debit leg. Returns Money-typed values — no float. */
export function debit(accountCode: string, amount: number | Money, currency: string, memo?: string): {
  accountCode: string; debit: Money; credit: Money; currency: string; memo?: string;
} {
  const money = typeof amount === 'number' ? Money.fromMajor(amount, currency as any) : amount;
  return { accountCode, debit: money, credit: Money.zero(currency as any), currency, memo };
}

/** Helper: create a credit leg. Returns Money-typed values — no float. */
export function credit(accountCode: string, amount: number | Money, currency: string, memo?: string): {
  accountCode: string; debit: Money; credit: Money; currency: string; memo?: string;
} {
  const money = typeof amount === 'number' ? Money.fromMajor(amount, currency as any) : amount;
  return { accountCode, debit: Money.zero(currency as any), credit: money, currency, memo };
}

/**
 * A single debit or credit against one account. Exactly one of debit/credit is non-zero.
 *
 * MON-3: `debit` and `credit` are `Money` — integer minor units, never float.
 * Callers that still pass `number` will get a compile error; use `Money.fromMajor()`
 * to convert. The `currency` field on the entry must match `debit.currency` /
 * `credit.currency`.
 */
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
  /** Debit amount (Money.zero for a credit-only leg). */
  debit: Money;
  /** Credit amount (Money.zero for a debit-only leg). */
  credit: Money;
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
  /** Debit amount (Money). Use Money.fromMajor(amount, currency) to convert from number. */
  debit?: Money;
  /** Credit amount (Money). Use Money.fromMajor(amount, currency) to convert from number. */
  credit?: Money;
  /** Raw amount (test compatibility — converted to debit or credit based on `side`). */
  amount?: number;
  /** Side: 'debit' or 'credit' (test compatibility — used with `amount`). */
  side?: 'debit' | 'credit';
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
    // MON-3: legs now carry Money. Default to zero if not provided.
    // Test compatibility: if `amount` + `side` are provided, convert to Money.
    let debitMoney = leg.debit ?? Money.zero(leg.currency as any);
    let creditMoney = leg.credit ?? Money.zero(leg.currency as any);
    if (leg.amount !== undefined && leg.side) {
      const amt = Money.fromMajor(leg.amount, leg.currency as any);
      if (leg.side === 'debit') debitMoney = amt;
      else creditMoney = amt;
    }
    if (debitMoney.isNegative() || creditMoney.isNegative()) {
      throw new Error(`ledger leg cannot have negative amounts (debit=${debitMoney}, credit=${creditMoney})`);
    }
    if (debitMoney.isPositive() && creditMoney.isPositive()) {
      throw new Error(`ledger leg cannot be both debit and credit (account=${leg.accountCode})`);
    }
    if (debitMoney.isZero() && creditMoney.isZero()) {
      throw new Error(`ledger leg has zero debit and zero credit (account=${leg.accountCode})`);
    }
    if (!leg.currency) {
      throw new Error(`ledger leg missing currency (account=${leg.accountCode})`);
    }
    entries.push({
      id: uid('le'),
      ts,
      ledgerSeq: seq++,
      txId: txId ?? '',
      accountCode: leg.accountCode,
      // MON-3: Money values — integer minor units, no float.
      debit: debitMoney,
      credit: creditMoney,
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
    txId: txId ?? '',
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
 * MON-3: uses Money arithmetic — sums are BigInt, comparisons are exact.
 * No float, no tolerance, no rounding. `debit.equals(credit)` is the check.
 */
function validateBalancedInner(entries: LedgerEntry[]): BalanceCheckResult {
  const totals = new Map<string, { debit: Money; credit: Money }>();
  for (const e of entries) {
    let t = totals.get(e.currency);
    if (!t) {
      t = { debit: Money.zero(e.currency as any), credit: Money.zero(e.currency as any) };
      totals.set(e.currency, t);
    }
    t.debit = t.debit.add(e.debit);
    t.credit = t.credit.add(e.credit);
  }

  const currencies: BalanceCheckResult['currencies'] = [];
  const mismatches: BalanceCheckResult['mismatches'] = [];
  for (const [currency, t] of totals) {
    // MON-3: exact comparison via Money.equals(). No tolerance.
    const balanced = t.debit.equals(t.credit);
    const debitNum = t.debit.toNumber();
    const creditNum = t.credit.toNumber();
    const diff = debitNum - creditNum;
    currencies.push({
      currency,
      totalDebit: debitNum,
      totalCredit: creditNum,
      difference: diff,
    });
    if (!balanced) {
      mismatches.push({
        currency,
        totalDebit: debitNum,
        totalCredit: creditNum,
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
