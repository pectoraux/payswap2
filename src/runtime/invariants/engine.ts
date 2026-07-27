/**
 * Invariant Engine — runs all invariants and produces a verification decision.
 * (M-RT-20, Economic Integrity Hardening.)
 *
 * The engine is the GATE between the ExecutionPlan and the EventStore.
 * Every event append goes through `verify()`:
 *
 *   ExecutionPlan → events[] → InvariantEngine.verify(events, snapshot)
 *       → if ALL pass: append events to EventStore
 *       → if ANY error: REJECT the append (throw InvariantViolationError)
 *
 * The engine is PURE: it never mutates the snapshot, never appends events,
 * never has side effects. It only READS the snapshot + events and returns
 * a VerificationDecision.
 *
 * DETERMINISM: same events + snapshot → same decision, same violation order.
 */

import type {
  RuntimeInvariant,
  RuntimeSnapshot,
  InvariantVerificationResult,
  VerificationDecision,
  Violation,
  InvariantReport,
  InvariantHealth,
  StoredEvent,
} from './types';
import { InvariantRegistry } from './registry';

/** Thrown when an invariant is violated (blocks the append). */
export class InvariantViolationError extends Error {
  constructor(
    readonly decision: VerificationDecision,
  ) {
    const errorViolations = decision.violations.filter((v) => v.severity === 'error');
    const messages = errorViolations.map((v) => `  • [${v.invariantId}] ${v.message}`).join('\n');
    super(`Invariant violation — ${errorViolations.length} error(s):\n${messages}`);
    this.name = 'InvariantViolationError';
  }
}

export class InvariantEngine {
  private readonly registry: InvariantRegistry;

  constructor() {
    this.registry = new InvariantRegistry();
  }

  /** Register an invariant. */
  register(invariant: RuntimeInvariant): void {
    this.registry.register(invariant);
  }

  /** Get the registry (for health queries). */
  getRegistry(): InvariantRegistry {
    return this.registry;
  }

  /**
   * Verify proposed events against the current snapshot.
   *
   * Runs ALL registered invariants (those whose `handles` prefixes match
   * any of the proposed events). Returns a VerificationDecision.
   *
   * PURE: no side effects. The caller decides what to do with the decision.
   */
  verify(events: StoredEvent[], snapshot: RuntimeSnapshot): VerificationDecision {
    const start = Date.now();
    const results: InvariantVerificationResult[] = [];
    const allViolations: Violation[] = [];

    for (const invariant of this.registry.all()) {
      // Skip invariants that don't handle any of the proposed events.
      const relevant = events.some((e) =>
        invariant.handles.some((prefix) => e.type.startsWith(prefix)),
      );
      if (!relevant && events.length > 0) continue;

      const invStart = Date.now();
      let result: InvariantVerificationResult;
      try {
        result = invariant.verify(events, snapshot);
      } catch (err) {
        // If an invariant throws, treat it as a failure with the error message.
        result = {
          invariantId: invariant.id,
          passed: false,
          violations: [{
            invariantId: invariant.id,
            message: `Invariant threw: ${err instanceof Error ? err.message : String(err)}`,
            severity: 'error',
          }],
          verifiedAt: Date.now(),
          durationMs: Date.now() - invStart,
        };
      }

      // Record the result in the registry (for health queries).
      this.registry.recordResult(invariant.id, {
        passed: result.passed,
        verifiedAt: result.verifiedAt,
        violations: result.violations,
      });

      results.push(result);
      allViolations.push(...result.violations);
    }

    // The append is allowed if NO error-severity violations exist.
    const hasErrors = allViolations.some((v) => v.severity === 'error');

    return {
      allow: !hasErrors,
      results,
      violations: allViolations,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Verify OR THROW. If any error-severity violation exists, throws
   * InvariantViolationError (blocking the append).
   *
   * This is what the ExecutionPipeline calls before appending events.
   */
  verifyOrThrow(events: StoredEvent[], snapshot: RuntimeSnapshot): VerificationDecision {
    const decision = this.verify(events, snapshot);
    if (!decision.allow) {
      throw new InvariantViolationError(decision);
    }
    return decision;
  }

  /** Generate a full invariant report (for /api/runtime/invariants). */
  report(): InvariantReport {
    const healths = this.registry.allHealth();
    return {
      total: healths.length,
      healthy: healths.filter((h) => h.healthy).length,
      unhealthy: healths.filter((h) => !h.healthy).length,
      invariants: healths,
      generatedAt: Date.now(),
    };
  }
}
