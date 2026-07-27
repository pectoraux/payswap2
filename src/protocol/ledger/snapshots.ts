/**
 * PaySwap Protocol — In-memory Ledger Snapshots.
 *
 * Snapshots capture a point-in-time view of the ledger: every active account's
 * signed balance, the trial-balance totals, and the entry count. They are the
 * fast-resume primitive — instead of replaying thousands of events to rebuild
 * the ledger, a persistence layer can load the latest snapshot and replay only
 * the events emitted after it.
 *
 * This module provides an in-memory `SnapshotStore`. The DB-backed version
 * lives in `src/protocol/persistence/snapshot-store.ts` and is wired up by the
 * persistence layer.
 */
import { uid } from '@/kernel/support';
import type { LedgerEngine, TrialBalance } from './engine';
import type { AccountTrialBalance } from './engine';

/** A point-in-time snapshot of the ledger. */
export interface LedgerSnapshot {
  /** Unique snapshot id. */
  id: string;
  /** Timestamp the snapshot was taken. */
  ts: number;
  /** Per-account signed balance at this point. */
  accounts: Record<string, AccountTrialBalance>;
  /** Trial balance totals at this point. */
  trialBalance: TrialBalance;
  /** Number of journal entries recorded up to this point. */
  entryCount: number;
  /** Number of individual ledger legs recorded up to this point. */
  legCount: number;
  /** The next-sequence counter at this point. */
  nextSeq: number;
  /** Optional label for the snapshot (e.g. "daily-close-2024-03-15"). */
  label?: string;
}

/**
 * Capture a snapshot of the ledger at the given timestamp.
 *
 * If `ts` is provided, the snapshot reflects ledger state up to (and
 * including) that timestamp. Otherwise it captures the current state.
 */
export function takeSnapshot(ledger: LedgerEngine, ts?: number, label?: string): LedgerSnapshot {
  const trialBalance = ledger.getTrialBalance(ts);
  return {
    id: uid('snap'),
    ts: ts ?? Date.now(),
    accounts: { ...trialBalance.accounts },
    trialBalance,
    entryCount: ledger.count(),
    legCount: ledger.legCount(),
    nextSeq: ledger.currentSeq(),
    label,
  };
}

/**
 * In-memory snapshot store. Keeps the most recent N snapshots (default 100).
 * Use for testing, debugging, and fast-resume in single-process runs.
 */
export class SnapshotStore {
  private snapshots: LedgerSnapshot[] = [];
  private maxKept: number;

  constructor(maxKept = 100) {
    this.maxKept = maxKept;
  }

  /** Save a snapshot. Returns the saved snapshot. */
  save(snapshot: LedgerSnapshot): LedgerSnapshot {
    this.snapshots.push(snapshot);
    // Trim oldest beyond capacity.
    if (this.snapshots.length > this.maxKept) {
      this.snapshots.splice(0, this.snapshots.length - this.maxKept);
    }
    return snapshot;
  }

  /** Convenience: take and save a snapshot in one call. */
  capture(ledger: LedgerEngine, ts?: number, label?: string): LedgerSnapshot {
    const snap = takeSnapshot(ledger, ts, label);
    return this.save(snap);
  }

  /** Get a snapshot by id. */
  get(id: string): LedgerSnapshot | undefined {
    return this.snapshots.find((s) => s.id === id);
  }

  /** List all snapshots, oldest first. */
  list(): LedgerSnapshot[] {
    return [...this.snapshots];
  }

  /** Most recent snapshot, or undefined if none. */
  latest(): LedgerSnapshot | undefined {
    if (this.snapshots.length === 0) return undefined;
    return this.snapshots[this.snapshots.length - 1];
  }

  /** Most recent snapshot taken at or before `ts`, or undefined. */
  latestBefore(ts: number): LedgerSnapshot | undefined {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].ts <= ts) return this.snapshots[i];
    }
    return undefined;
  }

  /** Clear all stored snapshots. */
  reset(): void {
    this.snapshots = [];
  }

  /** Number of snapshots currently stored. */
  size(): number {
    return this.snapshots.length;
  }
}

/**
 * Singleton in-memory snapshot store.
 *
 * Use this for the protocol-wide snapshot cache. The persistence layer wraps
 * it (or replaces it) with a DB-backed implementation.
 */
export const snapshotStore = new SnapshotStore();
