/**
 * Migration Framework — shared types. (M-RT-19, Capability Migration Framework.)
 *
 * These types are the contracts every migrated capability plugs into:
 *   - BackfillResult: what a backfill run produces (counts + duration)
 *   - BackfillInputs<T>: the inputs BackfillEngine<T> needs
 *   - ProjectionHealth: what the health endpoint returns
 *   - VerificationResult: what ProjectionVerifier returns
 *   - CheckpointSnapshot: what ProjectionCheckpoint persists
 *
 * All types are capability-agnostic. A capability (payments, refunds, payouts,
 * invoices, wallets, treasury, LPs) provides its own `T` (the Prisma row type)
 * and its own `View` (the projection row type). The framework handles the rest.
 */

// ─── Backfill ───────────────────────────────────────────────────────────────

/** Result of a backfill run. Same shape for every capability. */
export interface BackfillResult {
  /** Total rows in the legacy Prisma table. */
  totalInPrisma: number;
  /** Rows that were newly imported (recordFn returned true). */
  newlyImported: number;
  /** Rows that already existed (recordFn returned false — idempotent skip). */
  alreadyImported: number;
  /** Rows that failed to import (recordFn threw). */
  failed: number;
  /** Up to 20 error messages (capped to avoid huge responses). */
  errors: string[];
  /** Wall-clock duration of the backfill, in ms. */
  durationMs: number;
}

/** The inputs every BackfillEngine<T> needs. */
export interface BackfillInputs<T> {
  /** Capability name (for logging + health). E.g. "payments", "refunds". */
  name: string;
  /** Count total rows in the legacy Prisma table. */
  countFn: () => Promise<number>;
  /** List a batch of rows from the legacy Prisma table. */
  listFn: (skip: number, take: number) => Promise<T[]>;
  /**
   * Record one row — emit a domain event for it. IDEMPOTENT: returns true
   * if a new event was emitted, false if the row was already imported
   * (detected via stream existence).
   */
  recordFn: (row: T) => Promise<boolean>;
  /** Batch size (default 100). */
  batchSize?: number;
}

// ─── Projection Health ──────────────────────────────────────────────────────

/** Health metrics for one projection. Returned by the health endpoints. */
export interface ProjectionHealth {
  /** Projection name (e.g. "payments", "refunds"). */
  projection: string;
  /** Schema version of the projection (bumped when the projection logic changes). */
  version: number;
  /** Total domain events this projection has applied. */
  eventsApplied: number;
  /** Current row count in the projection. */
  rows: number;
  /** Lag: events in the EventStore that this projection hasn't processed yet. */
  lag: number;
  /** True if the projection is caught up (lag === 0) and has rows (or empty Prisma). */
  healthy: boolean;
  /** Last time the projection was rebuilt from scratch (ms). Null if never. */
  lastReplayMs: number | null;
  /** Last global position the projection processed. */
  checkpoint: number;
  /** Optional: total rows in the legacy Prisma table (for backfill-status checks). */
  canonicalRows?: number;
  /** Optional: human-readable message (e.g. "Backfill complete"). */
  message?: string;
}

// ─── Verification ───────────────────────────────────────────────────────────

/** Result of verifying one projection against its canonical source. */
export interface VerificationResult {
  /** Capability name. */
  capability: string;
  /** Overall pass/fail. True only if ALL checks pass. */
  passed: boolean;
  /** Individual check results. */
  checks: VerificationCheck[];
  /** Wall-clock duration of the verification, in ms. */
  durationMs: number;
}

/** One verification check. */
export interface VerificationCheck {
  /** Check name (e.g. "row-count-match"). */
  name: string;
  /** Did this check pass? */
  passed: boolean;
  /** Human-readable details (e.g. "prisma=271, projection=271"). */
  details: string;
  /** Optional: error message if the check failed. */
  error?: string;
}

// ─── Checkpoint ─────────────────────────────────────────────────────────────

/**
 * A snapshot of a projection's state at a specific event log position.
 *
 * Snapshots make replay proportional to events-since-last-snapshot rather
 * than events-since-beginning-of-time. As the event log grows from 271 to
 * 27 million payments, startup time stays bounded.
 *
 * M-RT-19: in-memory snapshots (lost on process restart). A future milestone
 * can persist snapshots to Prisma (CheckpointRecord table) for true durability.
 */
export interface CheckpointSnapshot {
  /** Projection name. */
  projection: string;
  /** Global event log position when the snapshot was taken. */
  globalPosition: number;
  /** When the snapshot was taken (epoch ms). */
  takenAt: number;
  /** Opaque snapshot blob (projection-specific serialization). */
  state: unknown;
}
