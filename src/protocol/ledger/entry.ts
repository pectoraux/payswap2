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

/**
 * Helper: build a debit leg. `debit('cash:bank:GHS', 100, 'GHS')` is shorthand
 * for `{ accountCode: 'cash:bank:GHS', debit: 100, credit: 0, currency: 'GHS' }`.
 * Keeps journal-entry construction readable in tests + integration code.
 */
export function debit(accountCode: string, amount: number, currency: string, memo?: string): JournalLegInput {
  return { accountCode, debit: amount, credit: 0, currency, memo };
}

/**
 * Helper: build a credit leg. Mirrors `debit()` — see above.
 */
export function credit(accountCode: string, amount: number, currency: string, memo?: string): JournalLegInput {
  return { accountCode, debit: 0, credit: amount, currency, memo };
}

/** Input for `createJournalEntry()`. */
export interface CreateJournalEntryParams {
  /** Transaction id linking to the originating domain operation. */
  txId?: string;
  /** Human-readable description. */
  description: string;
  /** The legs (debit/credit movements). */
  legs: JournalLegInput[];
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
  const txId = params.txId ?? uid('tx');
  let seq = params.startSeq ?? 0;

  // Accept `lines` as an alias for `legs` (test + integration compatibility).
  // Also accept the alternate {amount, side:'debit'|'credit'} leg shape and
  // normalize it to {debit, credit}.
  type AltLeg = { accountCode: string; amount?: number; side?: 'debit' | 'credit'; debit?: number; credit?: number; currency: string; memo?: string; evidenceId?: string; frame?: number };
  const rawLegs = (params.legs ?? (params as { lines?: AltLeg[] }).lines ?? []) as AltLeg[];
  if (!rawLegs.length) {
    throw new Error('journal entry has no legs');
  }
  const legs: JournalLegInput[] = rawLegs.map((leg) => {
    if (leg.amount != null && leg.side) {
      return leg.side === 'debit'
        ? { accountCode: leg.accountCode, debit: leg.amount, credit: 0, currency: leg.currency, memo: leg.memo, evidenceId: leg.evidenceId, frame: leg.frame }
        : { accountCode: leg.accountCode, debit: 0, credit: leg.amount, currency: leg.currency, memo: leg.memo, evidenceId: leg.evidenceId, frame: leg.frame };
    }
    return leg as JournalLegInput;
  });

  // Validate legs and build the entries array.
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
      debit: round(debit, 6),
      credit: round(credit, 6),
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
  /** Per-currency map view (currency → debit/credit totals + signed delta). */
  byCurrency: Record<string, {
    totalDebit: number;
    totalCredit: number;
    /** Signed difference = totalDebit - totalCredit (positive = debit-heavy). */
    delta: number;
  }>;
}

/**
 * Re-check that a JournalEntry is balanced across every currency.
 * Does not throw — returns the per-currency breakdown instead.
 */
export function validateBalanced(journal: JournalEntry): BalanceCheckResult {
  return validateBalancedInner(journal.entries);
}

/** Internal: per-currency debit/credit balance check. */
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
  const byCurrency: BalanceCheckResult['byCurrency'] = {};
  for (const [currency, t] of totals) {
    const diff = round(t.debit - t.credit, 6);
    currencies.push({
      currency,
      totalDebit: t.debit,
      totalCredit: t.credit,
      difference: diff,
    });
    byCurrency[currency] = { totalDebit: t.debit, totalCredit: t.credit, delta: diff };
    if (Math.abs(diff) > 1e-6) {
      mismatches.push({
        currency,
        totalDebit: t.debit,
        totalCredit: t.credit,
        difference: diff,
      });
    }
  }

  return {
    balanced: mismatches.length === 0,
    currencies,
    mismatches,
    byCurrency,
  };
}
