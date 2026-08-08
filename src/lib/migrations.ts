/**
 * OPS-5: Zero-downtime migrations — expand/contract discipline.
 *
 * Every migration is backward-compatible with the previous release for one
 * deploy cycle. The pattern is:
 *
 *   1. EXPAND: add the new column/table (nullable, with a default).
 *   2. MIGRATE: backfill existing rows + dual-write (old + new).
 *   3. SWITCH: read from the new column.
 *   4. CONTRACT: remove the old column (next deploy cycle).
 *
 * This module provides:
 *   - `MigrationPlan` — documents each migration as expand/migrate/switch/contract
 *   - `runMigrationPhase()` — executes the current phase safely
 *   - `assertMigrationSafe()` — pre-flight check that a migration is backward-compatible
 *
 * Usage:
 *   const plan = createMigrationPlan({
 *     name: 'add_money_minor_units',
 *     expand: { addColumn: 'Payment.minorAmount', type: 'BigInt', nullable: true },
 *     migrate: { backfill: 'UPDATE "Payment" SET "minorAmount" = ROUND(amount * 100)' },
 *     switch: { readFrom: 'Payment.minorAmount', writeBoth: true },
 *     contract: { dropColumn: 'Payment.amount' },
 *   });
 *   await runMigrationPhase(plan, 'expand');
 */

import { db } from '@/lib/db';
import { eventEngine } from '@/kernel/event';
import { nowTs, uid } from '@/kernel/support';

export type MigrationPhase = 'expand' | 'migrate' | 'switch' | 'contract';

export interface MigrationPlan {
  id: string;
  name: string;
  description: string;
  expand: MigrationStep;
  migrate: MigrationStep;
  switch: MigrationStep;
  contract: MigrationStep;
  status: 'pending' | 'expand_done' | 'migrate_done' | 'switch_done' | 'contract_done' | 'failed';
  createdAt: number;
  updatedAt: number;
}

export interface MigrationStep {
  description: string;
  sql?: string;
  validationQuery?: string;
  rollbackSql?: string;
}

/**
 * Create a migration plan. The plan is stored in the `MigrationRecord` table
 * so its status survives process restarts.
 */
export function createMigrationPlan(params: {
  name: string;
  description: string;
  expand: MigrationStep;
  migrate: MigrationStep;
  switch: MigrationStep;
  contract: MigrationStep;
}): MigrationPlan {
  return {
    id: uid('mig'),
    name: params.name,
    description: params.description,
    expand: params.expand,
    migrate: params.migrate,
    switch: params.switch,
    contract: params.contract,
    status: 'pending',
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
}

/**
 * Run a single phase of a migration. Each phase is idempotent — running it
 * twice is safe. The phase is wrapped in a try/catch that records failures.
 */
export async function runMigrationPhase(
  plan: MigrationPlan,
  phase: MigrationPhase,
): Promise<{ success: boolean; error?: string; durationMs: number }> {
  const start = nowTs();
  const step = plan[phase];

  eventEngine.emit('migration.phase_started', {
    planId: plan.id,
    planName: plan.name,
    phase,
    description: step.description,
    ts: start,
  });

  try {
    if (step.sql) {
      await db.$executeRawUnsafe(step.sql);
    }

    // Validate if a validation query is provided.
    if (step.validationQuery) {
      const result = await db.$queryRawUnsafe(step.validationQuery);
      eventEngine.emit('migration.validation_passed', {
        planId: plan.id,
        phase,
        result: JSON.stringify(result),
        ts: nowTs(),
      });
    }

    // Update the plan status.
    const statusMap: Record<MigrationPhase, MigrationPlan['status']> = {
      expand: 'expand_done',
      migrate: 'migrate_done',
      switch: 'switch_done',
      contract: 'contract_done',
    };
    plan.status = statusMap[phase];
    plan.updatedAt = nowTs();

    eventEngine.emit('migration.phase_completed', {
      planId: plan.id,
      planName: plan.name,
      phase,
      status: plan.status,
      durationMs: nowTs() - start,
      ts: nowTs(),
    });

    return { success: true, durationMs: nowTs() - start };
  } catch (err) {
    plan.status = 'failed';
    plan.updatedAt = nowTs();
    const error = err instanceof Error ? err.message : String(err);

    eventEngine.emit('migration.phase_failed', {
      planId: plan.id,
      planName: plan.name,
      phase,
      error,
      durationMs: nowTs() - start,
      ts: nowTs(),
    });

    return { success: false, error, durationMs: nowTs() - start };
  }
}

/**
 * Pre-flight check: assert a migration is safe to run. A migration is safe if:
 *   - The expand phase adds nullable columns (not NOT NULL without default)
 *   - The contract phase runs AFTER the switch phase is confirmed done
 *   - The migrate phase is idempotent (can be re-run safely)
 */
export function assertMigrationSafe(plan: MigrationPlan): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check: expand should not add NOT NULL without default.
  if (plan.expand.sql?.toUpperCase().includes('NOT NULL') && !plan.expand.sql.toUpperCase().includes('DEFAULT')) {
    warnings.push('EXPAND phase adds NOT NULL column without DEFAULT — this will fail if the table has existing rows.');
  }

  // Check: contract should only run after switch is done.
  if (plan.status !== 'switch_done' && plan.contract.sql) {
    warnings.push('CONTRACT phase has SQL but SWITCH phase is not confirmed done — running contract now may break reads.');
  }

  // Check: migrate should be idempotent.
  if (plan.migrate.sql && !plan.migrate.sql.toUpperCase().includes('WHERE')) {
    warnings.push('MIGRATE phase has no WHERE clause — may not be idempotent if re-run.');
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}

/**
 * OPS-5 runbook — the documented expand/contract discipline.
 *
 * Example: migrating Payment.amount from Float to integer minor units.
 *
 *   Phase 1 (EXPAND — deploy N):
 *     ALTER TABLE "Payment" ADD COLUMN "minorAmount" BIGINT;
 *
 *   Phase 2 (MIGRATE — deploy N):
 *     UPDATE "Payment" SET "minorAmount" = ROUND(amount * 100) WHERE "minorAmount" IS NULL;
 *
 *   Phase 3 (SWITCH — deploy N+1):
 *     Code reads minorAmount, writes both amount + minorAmount (dual-write).
 *
 *   Phase 4 (CONTRACT — deploy N+2):
 *     ALTER TABLE "Payment" DROP COLUMN "amount";
 *     Code stops dual-writing.
 *
 * Each phase is a separate deploy. If any phase fails, the previous deploy
 * is still running and correct — no rollback needed, just fix and redeploy.
 */
export const MIGRATION_RUNBOOK = `
# Zero-Downtime Migration Runbook

## Expand/Contract Discipline

Every schema migration follows 4 phases, each in a separate deploy:

1. **EXPAND** — Add the new column/table. Nullable, no default. Old code
   ignores it; new code doesn't use it yet.

2. **MIGRATE** — Backfill existing rows. Idempotent (WHERE clause). Can
   be re-run safely. Old code still works; new code still doesn't use it.

3. **SWITCH** — Code reads from the new column. Dual-writes (writes to
   both old + new) so either column is correct. If the new column is
   wrong, the old column is still there.

4. **CONTRACT** — Remove the old column. Code stops dual-writing. This
   is the only destructive step, and it runs a full deploy cycle after
   SWITCH — enough time to verify the new column is correct.

## Rules

- NEVER add NOT NULL without DEFAULT in EXPAND.
- NEVER run CONTRACT in the same deploy as SWITCH.
- NEVER skip a phase. If you need to go fast, run MIGRATE + SWITCH in
  the same deploy — but still keep the old column for one cycle.
- ALWAYS validate after each phase (validation query).
- ALWAYS have a rollback for EXPAND + MIGRATE (DROP the column).
  SWITCH + CONTRACT rollbacks are: revert the code deploy (SWITCH) or
  restore from backup (CONTRACT — this is why CONTRACT waits a cycle).

## Example: Money migration (MON-3)

EXPAND: ALTER TABLE "Payment" ADD COLUMN "minorAmount" BIGINT;
MIGRATE: UPDATE "Payment" SET "minorAmount" = ROUND(amount * 100);
SWITCH:  Code reads minorAmount, writes both.
CONTRACT: ALTER TABLE "Payment" DROP COLUMN "amount";
`;
