/**
 * PaySwap Protocol — Double-Entry Ledger / Historical Snapshots.
 * -----------------------------------------------------------------------------
 * A LedgerSnapshot is a frozen, point-in-time picture of every account's
 * debit/credit/balance plus the trial balance. Snapshots let us:
 *
 *   - Audit "what did the ledger look like at time T?"
 *   - Fast-forward rebuilds (replay only events after the latest snapshot).
 *   - Produce time-series balance sheets for the historical report.
 *
 * SnapshotStore is an in-memory, ts-sorted store. For production use, callers
 * would back this with a database, but the API is identical.
 */
import { round } from '@/kernel/support';
import type { LedgerEngine } from './engine';

export interface AccountSnapshot {
  debit: number;
  credit: number;
  /** Signed balance: debit − credit (consistent with AccountBalanceResult.balance). */
  balance: number;
}

export interface TrialBalanceSnapshot {
  totalDebits: number;
  totalCredits: number;
  /** True iff every per-currency delta is within epsilon of zero. */
  balanced: boolean;
}

export interface LedgerSnapshot {
  /** Timestamp this snapshot was taken at. */
  ts: number;
  /** Per-account debit/credit/balance at ts. */
  accounts: Record<string, AccountSnapshot>;
  /** Trial-balance totals at ts. */
  trialBalance: TrialBalanceSnapshot;
  /** Optional simulation frame. */
  frame?: number;
}

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

const EPSILON = 1e-6;

/** Capture a frozen snapshot of the ledger at `ts` (defaults to now). */
export function takeSnapshot(ledger: LedgerEngine, ts: number = Date.now(), frame?: number): LedgerSnapshot {
  const codes = ledger.getAccountCodes(ts);
  const accounts: Record<string, AccountSnapshot> = {};
  for (const code of codes) {
    const bal = ledger.getAccountBalance(code, ts);
    if (bal.debit === 0 && bal.credit === 0) continue;
    accounts[code] = {
      debit: bal.debit,
      credit: bal.credit,
      balance: bal.balance,
    };
  }
  const tb = ledger.getTrialBalance(ts);
  const snapshot: LedgerSnapshot = {
    ts,
    accounts,
    trialBalance: {
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
      balanced: tb.balanced,
    },
    frame,
  };
  return deepFreeze(snapshot);
}

/** In-memory, ts-sorted snapshot store. */
export class SnapshotStore {
  private snapshots: LedgerSnapshot[] = [];

  /** Persist a snapshot (replaces any existing snapshot at the same ts). */
  save(snapshot: LedgerSnapshot): LedgerSnapshot {
    const idx = this.snapshots.findIndex((s) => s.ts === snapshot.ts);
    if (idx >= 0) this.snapshots[idx] = snapshot;
    else this.snapshots.push(snapshot);
    this.snapshots.sort((a, b) => a.ts - b.ts);
    return snapshot;
  }

  /** Get the snapshot at exactly `ts`, or undefined. */
  get(ts: number): LedgerSnapshot | undefined {
    return this.snapshots.find((s) => s.ts === ts);
  }

  /** List all snapshots in [fromTs, toTs] (inclusive). */
  list(fromTs?: number, toTs?: number): LedgerSnapshot[] {
    return this.snapshots.filter(
      (s) => (fromTs == null || s.ts >= fromTs) && (toTs == null || s.ts <= toTs),
    );
  }

  /** Latest snapshot at or before `ts` (defaults to now). */
  latest(ts: number = Date.now()): LedgerSnapshot | undefined {
    let best: LedgerSnapshot | undefined;
    for (const s of this.snapshots) {
      if (s.ts <= ts) {
        if (!best || s.ts > best.ts) best = s;
      }
    }
    return best;
  }

  /** Earliest snapshot at or after `ts`. */
  earliest(ts: number = Date.now()): LedgerSnapshot | undefined {
    let best: LedgerSnapshot | undefined;
    for (const s of this.snapshots) {
      if (s.ts >= ts) {
        if (!best || s.ts < best.ts) best = s;
      }
    }
    return best;
  }

  /** All snapshots, sorted by ts ascending. */
  all(): LedgerSnapshot[] {
    return [...this.snapshots];
  }

  /** Number of snapshots stored. */
  size(): number {
    return this.snapshots.length;
  }

  /** Remove all snapshots. */
  reset(): void {
    this.snapshots = [];
  }

  /** Verify a stored snapshot's trial balance still reconciles. */
  verify(snapshot: LedgerSnapshot): boolean {
    let totalDebits = 0;
    let totalCredits = 0;
    for (const a of Object.values(snapshot.accounts)) {
      totalDebits = round(totalDebits + a.debit, 6);
      totalCredits = round(totalCredits + a.credit, 6);
    }
    return Math.abs(totalDebits - totalCredits) < EPSILON
      && Math.abs(totalDebits - snapshot.trialBalance.totalDebits) < EPSILON
      && Math.abs(totalCredits - snapshot.trialBalance.totalCredits) < EPSILON;
  }
}

/**
 * Fast-forward rebuild: take the latest snapshot before `targetTs`, restore
 * its state into a fresh LedgerEngine, then replay events that occurred after
 * the snapshot's ts up to `targetTs`. If no snapshot exists, falls back to a
 * full rebuild from `events`.
 *
 * Returns the rebuilt ledger. The caller-supplied `replayFn` is responsible
 * for posting events to the ledger — typically `rebuildLedgerFromEvents`
 * with the post-snapshot event slice.
 *
 * This function is a thin orchestration layer; the actual event→journal
 * mapping lives in projection.ts.
 */
export function rebuildFromSnapshots(
  events: Array<{ type: string; payload: Record<string, unknown>; ts: number; frame?: number }>,
  snapshotStore: SnapshotStore,
  targetTs: number,
  replayFn: (
    events: Array<{ type: string; payload: Record<string, unknown>; ts: number; frame?: number }>,
    ledger: LedgerEngine,
  ) => LedgerEngine,
  ledgerFactory: () => LedgerEngine,
): { ledger: LedgerEngine; usedSnapshot: LedgerSnapshot | undefined; replayedCount: number } {
  const snapshot = snapshotStore.latest(targetTs);
  const ledger = ledgerFactory();

  if (!snapshot) {
    // No snapshot — full rebuild from all events up to targetTs.
    const slice = events.filter((e) => e.ts <= targetTs);
    return { ledger: replayFn(slice, ledger), usedSnapshot: undefined, replayedCount: slice.length };
  }

  // Restore snapshot by posting a single "opening balance" journal entry per
  // currency. Each account's debit/credit at snapshot time becomes the
  // opening balance. We use a special txId `opening:${snapshot.ts}` so the
  // projection's deterministic-replay invariant is preserved (the snapshot
  // is itself derived from events, so re-deriving it from events would
  // produce the same state — but the opening-balance entry is faster).
  //
  // We materialize the snapshot as one balanced journal entry per currency:
  //   - For each account with a debit balance: DR account balance
  //   - For each account with a credit balance: CR account balance
  //   - The per-currency debits and credits are equal by the trial-balance invariant.

  // Group accounts by currency — but a snapshot stores aggregate debit/credit
  // per account, not per currency. To restore per-currency fidelity we'd need
  // the snapshot to carry per-currency detail. The current snapshot shape
  // stores aggregated debit/credit per account. We restore using a single
  // "composite currency" called 'OPENING' so the trial-balance invariant
  // (debits === credits) holds. Downstream readers can interpret the snapshot
  // as a checkpoint rather than as a regular journal entry.
  const openingLines: Array<{
    accountCode: string;
    debit: number;
    credit: number;
    currency: string;
  }> = [];
  for (const [code, bal] of Object.entries(snapshot.accounts)) {
    if (bal.debit > 0) {
      openingLines.push({ accountCode: code, debit: bal.debit, credit: 0, currency: 'OPENING' });
    }
    if (bal.credit > 0) {
      openingLines.push({ accountCode: code, debit: 0, credit: bal.credit, currency: 'OPENING' });
    }
  }
  if (openingLines.length > 0) {
    ledger.postLines({
      txId: `opening:${snapshot.ts}`,
      description: `Opening balance from snapshot @ ${snapshot.ts}`,
      ts: snapshot.ts,
      lines: openingLines.map((l) => ({
        accountCode: l.accountCode,
        amount: l.debit > 0 ? l.debit : l.credit,
        currency: l.currency,
        side: (l.debit > 0 ? 'debit' : 'credit') as 'debit' | 'credit',
      })),
    });
  }

  // Replay events strictly after the snapshot ts.
  const slice = events.filter((e) => e.ts > snapshot.ts && e.ts <= targetTs);
  return {
    ledger: replayFn(slice, ledger),
    usedSnapshot: snapshot,
    replayedCount: slice.length,
  };
}

/** Singleton snapshot store. */
export const snapshotStore = new SnapshotStore();
