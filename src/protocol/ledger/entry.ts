/**
 * PaySwap Protocol — Double-Entry Ledger / Journal Entries.
 * -----------------------------------------------------------------------------
 * A LedgerEntry is a single debit OR credit line posted against one account.
 * A JournalEntry is a balanced group of LedgerEntry lines that all post together.
 *
 * INVARIANT: every JournalEntry must satisfy
 *     sum(debits) === sum(credits)  per currency
 *
 * `createJournalEntry` validates this invariant and throws if it's violated.
 * `validateBalanced` re-checks the invariant on an existing journal entry.
 *
 * All entries are deep-frozen before being returned so callers cannot mutate
 * history after the fact.
 */
import { uid, round } from '@/kernel/support';

export interface LedgerEntry {
  /** Unique line id. */
  id: string;
  /** Timestamp (ms). */
  ts: number;
  /** Monotonic sequence within the ledger (assigned at post time, 0 here). */
  ledgerSeq: number;
  /** Logical transaction id linking related journal entries. */
  txId: string;
  /** Account code from the chart of accounts (see accounts.ts). */
  accountCode: string;
  /** Debit amount (>=0). Exactly one of debit/credit must be >0 per line. */
  debit: number;
  /** Credit amount (>=0). Exactly one of debit/credit must be >0 per line. */
  credit: number;
  /** Currency code (e.g. 'GHS', 'USD', or the Twin Token asset code). */
  currency: string;
  /** Human-readable memo / description. */
  memo: string;
  /** Optional evidence id this entry cites. */
  evidenceId?: string;
  /** Optional simulation frame number. */
  frame?: number;
}

export interface JournalEntry {
  /** Unique journal id. */
  id: string;
  /** Timestamp (ms). */
  ts: number;
  /** Logical transaction id. */
  txId: string;
  /** Human-readable description of the business event. */
  description: string;
  /** The constituent debit/credit lines. */
  entries: LedgerEntry[];
  /** Whether the entry was validated as balanced. Always true after createJournalEntry. */
  balanced: boolean;
  /** Optional simulation frame number. */
  frame?: number;
}

/** A single input line — caller supplies accountCode, amount, currency, side. */
export interface JournalLineInput {
  accountCode: string;
  /** Positive amount to post. */
  amount: number;
  currency: string;
  memo?: string;
  evidenceId?: string;
  /** Side — 'debit' or 'credit'. Defaults to 'debit'. */
  side?: 'debit' | 'credit';
}

export interface CreateJournalEntryParams {
  txId?: string;
  description: string;
  ts?: number;
  frame?: number;
  lines: JournalLineInput[];
  evidenceId?: string;
}

const EPSILON = 1e-6;

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        for (const item of v) deepFreeze(item);
      } else if (v && typeof v === 'object') {
        deepFreeze(v);
      }
    }
  }
  return obj;
}

/**
 * Validate that the lines balance per currency:
 *   for each currency, sum(debit) === sum(credit)
 * Returns { balanced, byCurrency, discrepancy }.
 */
export function validateBalanced(journal: JournalEntry): {
  balanced: boolean;
  byCurrency: Record<string, { debits: number; credits: number; delta: number }>;
  discrepancy: number;
} {
  const byCurrency: Record<string, { debits: number; credits: number; delta: number }> = {};
  for (const line of journal.entries) {
    if (!byCurrency[line.currency]) {
      byCurrency[line.currency] = { debits: 0, credits: 0, delta: 0 };
    }
    byCurrency[line.currency].debits = round(byCurrency[line.currency].debits + line.debit, 6);
    byCurrency[line.currency].credits = round(byCurrency[line.currency].credits + line.credit, 6);
  }
  let maxDiscrepancy = 0;
  for (const c of Object.keys(byCurrency)) {
    const delta = round(byCurrency[c].debits - byCurrency[c].credits, 6);
    byCurrency[c].delta = delta;
    if (Math.abs(delta) > maxDiscrepancy) maxDiscrepancy = Math.abs(delta);
  }
  return { balanced: maxDiscrepancy < EPSILON, byCurrency, discrepancy: maxDiscrepancy };
}

/**
 * Create a balanced JournalEntry from input lines. Throws if the lines do not
 * balance per currency (i.e. for any currency, sum(debits) !== sum(credits)).
 */
export function createJournalEntry(params: CreateJournalEntryParams): JournalEntry {
  if (!params.lines || params.lines.length === 0) {
    throw new Error('Journal entry must have at least one line');
  }
  const ts = params.ts ?? Date.now();
  const txId = params.txId ?? uid('tx');
  const journalId = uid('journal');

  const entries: LedgerEntry[] = params.lines.map((line, idx) => {
    if (line.amount == null || !isFinite(line.amount) || line.amount < 0) {
      throw new Error(`Line ${idx}: invalid amount ${line.amount}`);
    }
    if (line.amount === 0) {
      throw new Error(`Line ${idx}: amount must be > 0 (got 0)`);
    }
    const side = line.side ?? 'debit';
    if (side !== 'debit' && side !== 'credit') {
      throw new Error(`Line ${idx}: side must be 'debit' or 'credit' (got ${side})`);
    }
    return {
      id: uid('le'),
      ts,
      ledgerSeq: 0,
      txId,
      accountCode: line.accountCode,
      debit: side === 'debit' ? round(line.amount, 6) : 0,
      credit: side === 'credit' ? round(line.amount, 6) : 0,
      currency: line.currency,
      memo: line.memo ?? params.description,
      evidenceId: line.evidenceId ?? params.evidenceId,
      frame: params.frame,
    };
  });

  const journal: JournalEntry = {
    id: journalId,
    ts,
    txId,
    description: params.description,
    entries,
    balanced: false,
    frame: params.frame,
  };

  const check = validateBalanced(journal);
  if (!check.balanced) {
    const details = Object.entries(check.byCurrency)
      .map(([c, v]) => `${c}: DR ${v.debits} / CR ${v.credits} (Δ ${v.delta})`)
      .join('; ');
    throw new Error(`Unbalanced journal entry — ${details}`);
  }
  journal.balanced = true;
  return deepFreeze(journal);
}

/** Convenience helpers for building lines. */
export const debit = (
  accountCode: string,
  amount: number,
  currency: string,
  memo?: string,
): JournalLineInput => ({ accountCode, amount, currency, memo, side: 'debit' });

export const credit = (
  accountCode: string,
  amount: number,
  currency: string,
  memo?: string,
): JournalLineInput => ({ accountCode, amount, currency, memo, side: 'credit' });
