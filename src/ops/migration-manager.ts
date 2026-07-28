/**
 * MigrationManager — plan and execute schema / data / code / config migrations.
 *
 * Each migration has a list of steps. Steps are completed one-by-one; if any
 * step fails the migration can be rolled back. Backed by an in-memory store.
 */

import type { Migration, MigrationStep } from './types';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const migrationStore = new Map<string, Migration>();

function seedMigrations() {
  if (migrationStore.size > 0) return;
  const now = Date.now();
  const seed: Migration[] = [
    {
      id: rid('mig'),
      name: 'Add payouts table index',
      description:
        'Add a composite index on (merchantId, status, createdAt) to speed up the merchant payouts dashboard.',
      type: 'schema',
      status: 'completed',
      version: '2024.03.15-01',
      rollbackPlan:
        'DROP INDEX idx_payouts_merchant_status_created ON payouts;',
      startedAt: now - 7 * 24 * 60 * 60 * 1000,
      completedAt: now - 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000,
      startedBy: 'u-ops-amara',
      steps: [
        {
          order: 1,
          description: 'Create a backup of the payouts table.',
          status: 'completed',
          startedAt: now - 7 * 24 * 60 * 60 * 1000,
          completedAt: now - 7 * 24 * 60 * 60 * 1000 + 60 * 1000,
        },
        {
          order: 2,
          description: 'Apply the migration: CREATE INDEX CONCURRENTLY ...',
          status: 'completed',
          startedAt: now - 7 * 24 * 60 * 60 * 1000 + 60 * 1000,
          completedAt: now - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 1000,
        },
        {
          order: 3,
          description: 'Verify the index is being used by the dashboard query.',
          status: 'completed',
          startedAt: now - 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 1000,
          completedAt: now - 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000,
        },
      ],
    },
    {
      id: rid('mig'),
      name: 'Backfill merchant KYC tier',
      description:
        'Backfill the new kycTier column on Merchant from the existing kycStatus column.',
      type: 'data',
      status: 'planned',
      version: '2024.03.22-01',
      rollbackPlan:
        'UPDATE merchants SET kycTier = NULL; (column is nullable; no schema rollback needed)',
      startedBy: 'u-ops-amara',
      steps: [
        {
          order: 1,
          description: 'Snapshot the merchants table.',
          status: 'pending',
        },
        {
          order: 2,
          description:
            'Run the backfill UPDATE in batches of 10k merchants (no lock).',
          status: 'pending',
        },
        {
          order: 3,
          description: 'Verify all merchants have a non-null kycTier.',
          status: 'pending',
        },
      ],
    },
  ];
  for (const m of seed) migrationStore.set(m.id, m);
}

export type NewMigrationInput = Omit<
  Migration,
  'id' | 'status' | 'startedAt' | 'completedAt' | 'steps'
> & { steps: Omit<MigrationStep, 'status'>[] };

export interface MigrationListFilter {
  status?: string;
}

class MigrationManager {
  private ensureSeeded() {
    seedMigrations();
  }

  /** Plan a new migration. Status starts as `planned`; all steps are `pending`. */
  async plan(data: NewMigrationInput): Promise<Migration> {
    this.ensureSeeded();
    const id = rid('mig');
    const now = Date.now();
    const steps: MigrationStep[] = data.steps.map((s) => ({
      ...s,
      status: 'pending',
    }));
    const migration: Migration = {
      id,
      name: data.name,
      description: data.description,
      type: data.type,
      status: 'planned',
      version: data.version,
      rollbackPlan: data.rollbackPlan,
      startedBy: data.startedBy,
      steps,
    };
    void now; // not used yet; will stamp startedAt on start()
    migrationStore.set(id, migration);
    return migration;
  }

  /** Start a planned migration. */
  async start(id: string, _startedBy: string): Promise<void> {
    this.ensureSeeded();
    const m = migrationStore.get(id);
    if (!m) return;
    if (m.status !== 'planned') return;
    m.status = 'in_progress';
    m.startedAt = Date.now();
    // Mark the first step as in_progress.
    if (m.steps.length > 0 && m.steps[0].status === 'pending') {
      m.steps[0].status = 'in_progress';
      m.steps[0].startedAt = Date.now();
    }
  }

  /** Mark a step as complete. Auto-advances the next step to in_progress. */
  async completeStep(id: string, stepOrder: number): Promise<void> {
    this.ensureSeeded();
    const m = migrationStore.get(id);
    if (!m) return;
    const step = m.steps.find((s) => s.order === stepOrder);
    if (!step) return;
    step.status = 'completed';
    step.completedAt = Date.now();
    // Advance the next step.
    const next = m.steps.find((s) => s.order === stepOrder + 1);
    if (next && next.status === 'pending') {
      next.status = 'in_progress';
      next.startedAt = Date.now();
    }
    // If all steps complete, the migration is complete.
    if (m.steps.every((s) => s.status === 'completed')) {
      m.status = 'completed';
      m.completedAt = Date.now();
    }
  }

  /** Mark a step as failed. Sets the migration status to `failed`. */
  async failStep(id: string, stepOrder: number, _reason: string): Promise<void> {
    this.ensureSeeded();
    const m = migrationStore.get(id);
    if (!m) return;
    const step = m.steps.find((s) => s.order === stepOrder);
    if (!step) return;
    step.status = 'failed';
    m.status = 'failed';
  }

  /** Mark a migration as complete (all steps must be complete). */
  async complete(id: string): Promise<void> {
    this.ensureSeeded();
    const m = migrationStore.get(id);
    if (!m) return;
    if (!m.steps.every((s) => s.status === 'completed')) {
      throw new Error('Cannot complete a migration with non-complete steps');
    }
    m.status = 'completed';
    m.completedAt = Date.now();
  }

  /** Roll back a migration (with a reason). */
  async rollback(id: string, _reason: string): Promise<void> {
    this.ensureSeeded();
    const m = migrationStore.get(id);
    if (!m) return;
    m.status = 'rolled_back';
    m.completedAt = Date.now();
  }

  async list(filter?: MigrationListFilter): Promise<Migration[]> {
    this.ensureSeeded();
    const all = Array.from(migrationStore.values()).sort((a, b) => {
      const aTime = a.startedAt ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.startedAt ?? Number.MAX_SAFE_INTEGER;
      return bTime - aTime;
    });
    if (!filter?.status) return all;
    return all.filter((m) => m.status === filter.status);
  }

  /** Currently-active migration (in_progress), if any. */
  async getActive(): Promise<Migration | null> {
    this.ensureSeeded();
    for (const m of migrationStore.values()) {
      if (m.status === 'in_progress') return m;
    }
    return null;
  }
}

export const migrationManager = new MigrationManager();
