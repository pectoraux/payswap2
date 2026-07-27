/**
 * ProjectionMigrationRunner — orchestrates the migration lifecycle for one
 * capability: backfill → verify → health. (M-RT-19, Capability Migration
 * Framework.)
 *
 * This is the single entry point for migrating a capability. A capability
 * provides its BackfillEngine + VerificationInputs, and the runner:
 *   1. Runs the backfill (idempotent — safe to re-run)
 *   2. Runs the 6 verification checks
 *   3. Returns a combined MigrationReport
 *
 * The runner is intentionally simple — it's a coordinator, not an
 * implementation. The BackfillEngine does the heavy lifting; the
 * ProjectionVerifier does the checking. The runner just calls them in order.
 */

import type { BackfillEngine } from './backfill-engine';
import type { VerificationResult, BackfillResult } from './types';
import type { VerificationInputs } from './projection-verifier';
import { ProjectionVerifier } from './projection-verifier';

/** The combined report for one capability's migration. */
export interface MigrationReport {
  /** Capability name. */
  capability: string;
  /** Backfill result (counts + duration). */
  backfill: BackfillResult;
  /** Verification result (6 checks). */
  verification: VerificationResult;
  /** True if backfill completed AND all verification checks passed. */
  passed: boolean;
  /** When the migration ran (epoch ms). */
  ranAt: number;
}

/**
 * ProjectionMigrationRunner — runs backfill + verification for one capability.
 *
 * Stateless — instantiate per capability or reuse with different inputs.
 */
export const ProjectionMigrationRunner = {
  /**
   * Run a full migration: backfill → verify. Returns MigrationReport.
   *
   * The caller provides:
   *   - capability name
   *   - BackfillEngine (already constructed with countFn/listFn/recordFn)
   *   - VerificationInputs (counts, rebuildFn, backfillFn, aggregates, sample)
   *
   * The runner runs the backfill ONCE (the verifier's idempotent-backfill
   * check re-runs it internally to verify idempotence).
   */
  async run(
    capability: string,
    engine: BackfillEngine<unknown>,
    verifyInputs: VerificationInputs,
  ): Promise<MigrationReport> {
    const ranAt = Date.now();

    // Step 1: run the backfill.
    const backfill = await engine.run();

    // Step 2: run the 6 verification checks.
    // The verifier's idempotent-backfill check re-runs the backfill to
    // verify idempotence. We pass engine.run.bind(engine) as the backfillFn.
    const verification = await ProjectionVerifier.verify({
      ...verifyInputs,
      capability,
      backfillFn: verifyInputs.backfillFn ?? (() => engine.run()),
    });

    return {
      capability,
      backfill,
      verification,
      passed: backfill.failed === 0 && verification.passed,
      ranAt,
    };
  },
};
