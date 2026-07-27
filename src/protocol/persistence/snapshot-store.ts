/**
 * PaySwap Protocol — Ledger Snapshot Store.
 *
 * Snapshots are point-in-time ledger states taken periodically so projection
 * rebuilds are O(post-snapshot events) instead of O(all events).
 *
 * Rebuild strategy:
 *   1. Load the latest snapshot (asOfSeq = N)
 *   2. Load all events with seq > N
 *   3. Apply those events on top of the snapshot
 *   4. Result: current ledger state
 *
 * This turns a 10,000-event O(N) rebuild into a ~50-event O(1) rebuild.
 */
import { db } from '@/lib/db';
import { uid } from '@/kernel/support';
import type { SimulationEvent } from '@/kernel/types';

export interface LedgerSnapshotData {
  snapshotId: string;
  asOfTs: number;
  asOfSeq: number;
  accounts: Record<string, { debit: number; credit: number; balance: number }>;
  trialBalance: { totalDebits: number; totalCredits: number; balanced: boolean };
  entryCount: number;
  eventCount: number;
  durationMs: number;
}

class SnapshotStore {
  /**
   * Save a snapshot to the DB.
   */
  async save(snap: LedgerSnapshotData): Promise<void> {
    await db.ledgerSnapshotRecord.create({
      data: {
        snapshotId: snap.snapshotId,
        asOfTs: snap.asOfTs, // SQLite: stored as Int (schema changed from BigInt in task 2-prisma-fix)
        asOfSeq: snap.asOfSeq,
        accounts: JSON.stringify(snap.accounts),
        trialBalance: JSON.stringify(snap.trialBalance),
        entryCount: snap.entryCount,
        eventCount: snap.eventCount,
        durationMs: snap.durationMs,
      },
    });
  }

  /**
   * Get the latest snapshot (highest asOfSeq).
   */
  async latest(): Promise<LedgerSnapshotData | null> {
    const r = await db.ledgerSnapshotRecord.findFirst({
      orderBy: { asOfSeq: 'desc' },
    });
    if (!r) return null;
    return {
      snapshotId: r.snapshotId,
      asOfTs: Number(r.asOfTs),
      asOfSeq: r.asOfSeq,
      accounts: JSON.parse(r.accounts),
      trialBalance: JSON.parse(r.trialBalance),
      entryCount: r.entryCount,
      eventCount: r.eventCount,
      durationMs: r.durationMs,
    };
  }

  /**
   * Get the latest snapshot before a given seq.
   */
  async latestBefore(seq: number): Promise<LedgerSnapshotData | null> {
    const r = await db.ledgerSnapshotRecord.findFirst({
      where: { asOfSeq: { lte: seq } },
      orderBy: { asOfSeq: 'desc' },
    });
    if (!r) return null;
    return {
      snapshotId: r.snapshotId,
      asOfTs: Number(r.asOfTs),
      asOfSeq: r.asOfSeq,
      accounts: JSON.parse(r.accounts),
      trialBalance: JSON.parse(r.trialBalance),
      entryCount: r.entryCount,
      eventCount: r.eventCount,
      durationMs: r.durationMs,
    };
  }

  /**
   * List snapshots (most recent first).
   */
  async list(limit = 20): Promise<LedgerSnapshotData[]> {
    const rows = await db.ledgerSnapshotRecord.findMany({
      orderBy: { asOfSeq: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      snapshotId: r.snapshotId,
      asOfTs: Number(r.asOfTs),
      asOfSeq: r.asOfSeq,
      accounts: JSON.parse(r.accounts),
      trialBalance: JSON.parse(r.trialBalance),
      entryCount: r.entryCount,
      eventCount: r.eventCount,
      durationMs: r.durationMs,
    }));
  }

  /**
   * Count snapshots.
   */
  async count(): Promise<number> {
    return db.ledgerSnapshotRecord.count();
  }

  /**
   * Clear all snapshots (for dev/reset).
   */
  async clear(): Promise<void> {
    await db.ledgerSnapshotRecord.deleteMany({});
  }
}

export const snapshotStore = new SnapshotStore();

/**
 * Take a snapshot of the current ledger state.
 * This is the function called by the periodic scheduler.
 */
export async function takeSnapshot(
  ledgerAccounts: Record<string, { debit: number; credit: number; balance: number }>,
  trialBalance: { totalDebits: number; totalCredits: number; balanced: boolean },
  entryCount: number,
  asOfSeq: number,
  eventCount: number,
  durationMs: number,
): Promise<LedgerSnapshotData> {
  const snap: LedgerSnapshotData = {
    snapshotId: uid('snap'),
    asOfTs: Date.now(),
    asOfSeq,
    accounts: ledgerAccounts,
    trialBalance,
    entryCount,
    eventCount,
    durationMs,
  };
  await snapshotStore.save(snap);
  return snap;
}
