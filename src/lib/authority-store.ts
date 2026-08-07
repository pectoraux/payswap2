/**
 * SCALE-2: Postgres-backed authority state.
 *
 * The 10 authority singletons (see SCALE-INVENTORY.md) currently hold state
 * in in-memory Maps. This works on one process — a second instance gives
 * you two divergent sets of reserve balances and two AML pipelines.
 *
 * This module provides the pattern for moving authority state to Postgres:
 *   - `loadAuthorityState()` — read the authority's state from Postgres
 *   - `saveAuthorityState()` — write the authority's state to Postgres
 *   - `withOptimisticLock()` — concurrency-safe updates with version checking
 *
 * Each authority gets its own table (or a JSON blob in a shared table).
 * Reads may stay in-memory projections; writes go through the database with
 * optimistic locking.
 *
 * The first authority migrated is `netSettlementEngine` — corridor
 * obligations are money owed, and two instances with divergent balances
 * is a correctness bug (not just a performance issue).
 */

import { db } from '@/lib/db';
import { eventEngine } from '@/kernel/event';
import { nowTs, uid } from '@/kernel/support';

// ── Authority state record ───────────────────────────────────────────────

export interface AuthorityStateRecord {
  id: string;
  authority: string;       // e.g., 'netSettlementEngine', 'backingVerifier'
  key: string;             // e.g., 'Ghana:Nigeria:NGN' or 'TWINGHS'
  state: unknown;          // JSON blob — the authority's state for this key
  version: number;         // optimistic lock version
  updatedAt: number;
}

// ── Load / save ──────────────────────────────────────────────────────────

/**
 * Load all state for an authority from Postgres. Returns a Map<key, state>.
 * Used at startup to hydrate the in-memory projection.
 */
export async function loadAuthorityState(authority: string): Promise<Map<string, { state: unknown; version: number }>> {
  try {
    const records = await db.authorityState.findMany({
      where: { authority },
    });
    const map = new Map<string, { state: unknown; version: number }>();
    for (const r of records) {
      map.set(r.key, {
        state: JSON.parse(r.state),
        version: r.version,
      });
    }
    return map;
  } catch {
    // Table may not exist yet — return empty map.
    return new Map();
  }
}

/**
 * Save a single authority state entry to Postgres with optimistic locking.
 *
 * If the version doesn't match (another instance updated it first), the
 * write fails and the caller must re-read + retry.
 *
 * Returns true on success, false on version conflict.
 */
export async function saveAuthorityState(
  authority: string,
  key: string,
  state: unknown,
  expectedVersion: number,
): Promise<{ success: boolean; newVersion: number }> {
  const newVersion = expectedVersion + 1;
  try {
    // Try to update with optimistic lock.
    const result = await db.authorityState.updateMany({
      where: {
        authority,
        key,
        version: expectedVersion,
      },
      data: {
        state: JSON.stringify(state),
        version: newVersion,
        updatedAt: new Date(),
      },
    });

    if (result.count > 0) {
      return { success: true, newVersion };
    }

    // No rows updated — either the record doesn't exist (create it) or
    // the version doesn't match (conflict).
    try {
      await db.authorityState.create({
        data: {
          id: uid('auth'),
          authority,
          key,
          state: JSON.stringify(state),
          version: 1,
          updatedAt: new Date(),
        },
      });
      return { success: true, newVersion: 1 };
    } catch {
      // Create failed — probably a unique constraint violation (another
      // instance created it first). This is a version conflict.
      return { success: false, newVersion: expectedVersion };
    }
  } catch (err) {
    eventEngine.emit('authority.save_failed', {
      authority,
      key,
      error: err instanceof Error ? err.message : 'unknown',
      ts: nowTs(),
    });
    return { success: false, newVersion: expectedVersion };
  }
}

/**
 * Execute a function with optimistic locking. Retries up to 3 times on
 * version conflict.
 *
 * Usage:
 *   const result = await withOptimisticLock('netSettlementEngine', 'Ghana:Nigeria:NGN', async (current) => {
 *     const updated = { ...current, balance: current.balance + amount };
 *     return updated;
 *   });
 */
export async function withOptimisticLock<T>(
  authority: string,
  key: string,
  fn: (current: unknown) => Promise<T>,
  opts: { maxRetries?: number } = {},
): Promise<{ success: boolean; result?: T; attempts: number }> {
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Read current state.
    let current: { state: unknown; version: number } | null = null;
    try {
      const record = await db.authorityState.findUnique({
        where: { authority_key: { authority, key } },
      });
      if (record) {
        current = { state: JSON.parse(record.state), version: record.version };
      }
    } catch {
      // Table may not exist — treat as null.
    }

    // Execute the function.
    const newState = await fn(current?.state ?? null);

    // Write with optimistic lock.
    const { success, newVersion } = await saveAuthorityState(
      authority,
      key,
      newState,
      current?.version ?? 0,
    );

    if (success) {
      return { success: true, result: newState, attempts: attempt };
    }

    // Version conflict — retry.
    eventEngine.emit('authority.retry', {
      authority,
      key,
      attempt,
      ts: nowTs(),
    });
  }

  return { success: false, attempts: maxRetries };
}

/**
 * Delete all state for an authority (used by tests + full reset).
 */
export async function clearAuthorityState(authority?: string): Promise<{ deleted: number }> {
  try {
    const result = await db.authorityState.deleteMany({
      where: authority ? { authority } : undefined,
    });
    return { deleted: result.count };
  } catch {
    return { deleted: 0 };
  }
}
