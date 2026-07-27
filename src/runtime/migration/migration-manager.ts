/**
 * MigrationManager — owns the migration lifecycle for ALL capabilities.
 * (M-RT-19 feedback: invert backfill ownership.)
 *
 * BEFORE (M-RT-18/19): each capability triggered its own lazy backfill via
 * `_onFirstRead`. This mixed migration concerns into domain services.
 *
 * AFTER (this module): MigrationManager is the SINGLE owner of backfills.
 * Capabilities don't know whether they have legacy Prisma data. Migration
 * is a deployment concern, not a domain concern.
 *
 *   MigrationManager
 *       ├── Payments backfill
 *       ├── Refunds backfill
 *       ├── Payouts backfill (future)
 *       ├── Invoices backfill (future)
 *       └── Wallets backfill (future)
 *
 * The manager:
 *   1. Registers capabilities (name + backfillFn + statusFn)
 *   2. Triggers backfills on runtime startup (or on-demand via API)
 *   3. Tracks migration state (MigrationRecord) per capability
 *   4. Exposes /api/runtime/migrations (list all migration states)
 *
 * Migration state is persisted in-memory (M-RT-19). A future milestone can
 * persist MigrationRecord to Prisma for durability across restarts.
 */

import type { BackfillResult, ProjectionHealth } from './types';

/** The state of one capability's migration. */
export interface MigrationRecord {
  /** Capability name (e.g., "payments", "refunds"). */
  capability: string;
  /** Schema version of the projection (bumped when projection logic changes). */
  version: number;
  /** When the migration started (epoch ms). Null if not started. */
  startedAt: number | null;
  /** When the migration completed (epoch ms). Null if not complete. */
  completedAt: number | null;
  /** Last event log position processed by the backfill. */
  checkpoint: number;
  /** Total events imported across all backfill runs. */
  eventsImported: number;
  /** Total rows in the canonical (Prisma) source. */
  canonicalRows: number;
  /** Whether the last verification passed. */
  verified: boolean;
  /** Current status. */
  status: 'pending' | 'in-progress' | 'complete' | 'failed';
  /** Last error message (if status === 'failed'). */
  error: string | null;
  /** Last backfill result (for debugging). */
  lastBackfill: BackfillResult | null;
}

/** A registered capability migration. */
interface CapabilityMigration {
  capability: string;
  version: number;
  backfillFn: () => Promise<BackfillResult>;
  statusFn: () => Promise<{ prismaCount: number; projectionCount: number; backfilled: boolean }>;
  healthFn: () => Promise<ProjectionHealth>;
  record: MigrationRecord;
}

/**
 * MigrationManager — the single owner of all capability migrations.
 *
 * Capabilities register with the manager at runtime construction. The
 * manager triggers backfills (lazily or eagerly) and tracks state.
 */
export class MigrationManager {
  private readonly migrations = new Map<string, CapabilityMigration>();
  private readonly order: string[] = [];

  /**
   * Register a capability migration.
   *
   * @param capability  e.g., "payments", "refunds"
   * @param version     projection schema version
   * @param backfillFn  runs the backfill (idempotent)
   * @param statusFn    returns { prismaCount, projectionCount, backfilled }
   * @param healthFn    returns the projection's health
   */
  register(
    capability: string,
    version: number,
    backfillFn: () => Promise<BackfillResult>,
    statusFn: () => Promise<{ prismaCount: number; projectionCount: number; backfilled: boolean }>,
    healthFn: () => Promise<ProjectionHealth>,
  ): void {
    if (!this.migrations.has(capability)) {
      this.order.push(capability);
    }
    this.migrations.set(capability, {
      capability,
      version,
      backfillFn,
      statusFn,
      healthFn,
      record: {
        capability,
        version,
        startedAt: null,
        completedAt: null,
        checkpoint: -1,
        eventsImported: 0,
        canonicalRows: 0,
        verified: false,
        status: 'pending',
        error: null,
        lastBackfill: null,
      },
    });
  }

  /**
   * Trigger backfill for a capability (non-blocking). Idempotent — safe to
   * call multiple times. The backfill runs in the background; the caller
   * doesn't wait for it.
   */
  triggerBackfill(capability: string): void {
    const migration = this.migrations.get(capability);
    if (!migration) return;
    if (migration.record.status === 'in-progress') return; // already running

    migration.record.status = 'in-progress';
    migration.record.startedAt = migration.record.startedAt ?? Date.now();
    migration.record.error = null;

    migration.backfillFn()
      .then((result) => {
        migration.record.lastBackfill = result;
        migration.record.eventsImported += result.newlyImported;
        migration.record.checkpoint = Date.now();
        migration.record.canonicalRows = result.totalInPrisma;
        migration.record.completedAt = Date.now();
        migration.record.status = result.failed === 0 ? 'complete' : 'failed';
        if (result.failed > 0) {
          migration.record.error = `${result.failed} rows failed to import`;
        }
      })
      .catch((err) => {
        migration.record.status = 'failed';
        migration.record.error = err instanceof Error ? err.message : String(err);
        migration.record.completedAt = Date.now();
      });
  }

  /**
   * Trigger backfills for ALL registered capabilities (non-blocking).
   * Called once at runtime startup.
   */
  triggerAll(): void {
    for (const capability of this.order) {
      this.triggerBackfill(capability);
    }
  }

  /** Get the migration record for one capability (or null). */
  getRecord(capability: string): MigrationRecord | null {
    return this.migrations.get(capability)?.record ?? null;
  }

  /** Get migration records for ALL capabilities (insertion order). */
  allRecords(): MigrationRecord[] {
    return this.order.map((c) => this.migrations.get(c)!.record);
  }

  /**
   * Verify a capability's migration: run the backfill (idempotent) and
   * return the migration record + projection health.
   */
  async verify(capability: string): Promise<{
    record: MigrationRecord;
    health: ProjectionHealth | null;
  } | null> {
    const migration = this.migrations.get(capability);
    if (!migration) return null;

    // Run the backfill (idempotent — will skip already-imported rows).
    const result = await migration.backfillFn();
    migration.record.lastBackfill = result;
    migration.record.eventsImported += result.newlyImported;
    migration.record.canonicalRows = result.totalInPrisma;
    migration.record.checkpoint = Date.now();
    migration.record.completedAt = Date.now();
    migration.record.status = result.failed === 0 ? 'complete' : 'failed';
    migration.record.verified = result.failed === 0 && result.newlyImported === 0;
    if (result.failed > 0) {
      migration.record.error = `${result.failed} rows failed to import`;
    }

    const health = await migration.healthFn();
    return { record: migration.record, health };
  }
}
