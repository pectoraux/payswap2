/**
 * Invariant Engine — Types. (M-RT-20, Economic Integrity Hardening.)
 *
 * The Invariant Engine makes the Runtime financially self-verifying. Every
 * event append goes through `verify()` first — if an invariant would be
 * violated, the append is REJECTED.
 *
 *   Command → Compiler → ExecutionPlan → InvariantEngine.verify() → append (or reject)
 *
 * Every invariant is:
 *   - PURE: no side effects, no I/O, no mutations
 *   - DETERMINISTIC: same inputs → same result
 *   - INDEPENDENT: doesn't depend on other invariants' execution order
 *
 * The invariant receives:
 *   - events: the events that would be appended (the "proposal")
 *   - snapshot: the current state of all projections (the "context")
 *
 * The invariant returns:
 *   - InvariantVerificationResult: pass/fail + violations[] (with provenance)
 */

import type { StoredEvent } from '../events';
// Re-export StoredEvent so other invariant modules can import it from here.
export type { StoredEvent };

// ─── Snapshot (what invariants verify against) ──────────────────────────────

/**
 * RuntimeSnapshot — the current state of all projections.
 *
 * The Invariant Engine builds this snapshot before running invariants.
 * Each invariant reads only the parts it needs. The snapshot is READ-ONLY.
 */
export interface RuntimeSnapshot {
  /** All events in the EventStore (the global log, in order). */
  events: StoredEvent[];
  /** Payment projection state: paymentId → view. */
  payments: Map<string, unknown>;
  /** Refund projection state: refundId → view. */
  refunds: Map<string, unknown>;
  /** Reserve ledger state: reserveId → balances. */
  reserves: Map<string, InvariantReserveBalances>;
  /** Ledger entries (for double-entry verification). */
  ledgerEntries: LedgerEntry[];
  /** Execution plans that have been compiled (for hash verification). */
  executionPlans: Map<string, { id: string; hash: string }>;
}

/** Reserve balances (from the ReserveLedger projection). Renamed to avoid conflict. */
export interface InvariantReserveBalances {
  reserveId: string;
  available: number;
  locked: number;
  pending: number;
  consumed: number;
  released: number;
}

/** A ledger entry (debit or credit). */
export interface LedgerEntry {
  account: string;
  debit: number;
  credit: number;
  operationId: string;
  reason: string;
}

// ─── Verification Result ────────────────────────────────────────────────────

/** The result of running one invariant. Renamed to avoid conflict with migration module. */
export interface InvariantVerificationResult {
  /** The invariant ID. */
  invariantId: string;
  /** True if the invariant passed (no violations). */
  passed: boolean;
  /** Violations found (empty if passed). */
  violations: Violation[];
  /** When the verification ran (epoch ms). */
  verifiedAt: number;
  /** Duration of the verification (ms). */
  durationMs: number;
}

/** A single violation — what was violated + provenance. */
export interface Violation {
  /** The invariant that was violated. */
  invariantId: string;
  /** Human-readable description of the violation. */
  message: string;
  /** The event that caused the violation (if applicable). */
  event?: {
    type: string;
    streamId: string;
    globalPosition: number;
  };
  /** The projection row affected (if applicable). */
  projection?: {
    name: string;
    id: string;
  };
  /** The command that triggered the violation (if known). */
  command?: {
    intentId: string;
    correlationId: string;
  };
  /** Severity: error (blocks append) or warning (logs only). */
  severity: 'error' | 'warning';
}

// ─── Invariant Interface ────────────────────────────────────────────────────

/**
 * RuntimeInvariant — what every invariant implements.
 *
 * PURE: verify() must have no side effects.
 * DETERMINISTIC: same events + snapshot → same result.
 * INDEPENDENT: doesn't depend on other invariants.
 */
export interface RuntimeInvariant {
  /** Unique invariant ID (e.g., "double-entry"). */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Event type prefixes this invariant handles (e.g., ['payment.', 'refund.']). */
  handles: string[];
  /**
   * Verify the invariant against proposed events + current snapshot.
   *
   * Returns a InvariantVerificationResult. If result.passed === false, the engine
   * will reject the append (for severity: 'error' violations).
   */
  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): InvariantVerificationResult;
}

// ─── Invariant Report ───────────────────────────────────────────────────────

/** Health status for one invariant (for the /api/runtime/invariants endpoint). */
export interface InvariantHealth {
  /** Invariant ID. */
  id: string;
  /** Description. */
  description: string;
  /** True if the last verification passed. */
  healthy: boolean;
  /** When the invariant last ran (epoch ms, or null if never). */
  lastRun: number | null;
  /** Number of violations in the last run. */
  violationCount: number;
  /** Recent violations (last 10, for the inspector). */
  recentViolations: Violation[];
}

/** A full invariant report (all invariants). */
export interface InvariantReport {
  /** Total invariants registered. */
  total: number;
  /** How many passed. */
  healthy: number;
  /** How many failed. */
  unhealthy: number;
  /** Per-invariant health. */
  invariants: InvariantHealth[];
  /** When the report was generated (epoch ms). */
  generatedAt: number;
}

// ─── Verification Decision ──────────────────────────────────────────────────

/** The engine's decision on whether to allow the append. */
export interface VerificationDecision {
  /** True if ALL invariants passed (allow append). */
  allow: boolean;
  /** All results (one per invariant). */
  results: InvariantVerificationResult[];
  /** All violations across all invariants (for the inspector). */
  violations: Violation[];
  /** Total verification duration (ms). */
  durationMs: number;
}
