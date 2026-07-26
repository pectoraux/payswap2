/**
 * PaySwap Protocol — Persistence barrel export.
 *
 * Persistent event store + ledger snapshots + checkpoint manager.
 * The kernel is untouched. This wraps the existing eventEngine and adds
 * DB-backed durability.
 */
export { eventStore } from './event-store';
export { snapshotStore, takeSnapshot, type LedgerSnapshotData } from './snapshot-store';
export { checkpointManager, type RebuildResult } from './checkpoint';
