/**
 * PaySwap Protocol — Disaster Recovery — Database / Region Failover.
 *
 * The failover service orchestrates region failover: promoting a
 * secondary region to primary, updating DNS, and verifying the new
 * primary is healthy. It supports both manual (`initiateFailover` +
 * `completeFailover`) and automatic (`autoFailover`) failover.
 *
 * A failover operation goes through these states:
 *
 *   initiated → in_progress → completed
 *                          ↘ failed
 *                          ↘ aborted
 *
 * `initiateFailover(fromRegion, toRegion, reason)` creates a
 * `FailoverRecord` in the `initiated` state.
 *
 * `completeFailover(failoverId)` performs the actual promotion via
 * `replicationService.promoteRegion(...)`, simulates a DNS update
 * (records a note), runs a smoke-test health check, and marks the
 * record `completed` (or `failed` if the promotion threw).
 *
 * `autoFailover(healthCheck)` calls the supplied health-check function;
 * if it returns `false` for the current primary, an automatic failover
 * is initiated + completed to the next-priority secondary.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `dr.failover_initiated`   — when a failover is initiated.
 *  - `dr.failover_completed`   — when a failover is completed.
 *  - `dr.failover_failed`      — when a failover fails.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and the
 * sibling `replicationService`. No kernel files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';
import type { FailoverRecord, FailoverStatus, Region } from './types';
import { ALL_REGIONS } from './types';
import { replicationService } from './replication';

/** A health-check function returns `true` if the region is healthy. */
export type HealthCheckFn = (region: Region) => boolean;

/** Default failover priority order (after the current primary). */
const DEFAULT_FAILOVER_PRIORITY: Region[] = [...ALL_REGIONS];

/**
 * Failover service — orchestrates region failover (manual + automatic).
 */
export class FailoverService {
  private records: FailoverRecord[] = [];
  /** The currently in-flight failover (or null). */
  private current: FailoverRecord | null = null;
  private readonly maxHistory = 200;

  // --------------------------------------------------------------- initiate

  /**
   * Initiate a failover from `fromRegion` to `toRegion`. Returns the
   * new `FailoverRecord` in the `initiated` state. Throws if a
   * failover is already in flight.
   */
  initiateFailover(fromRegion: Region, toRegion: Region, reason: string): FailoverRecord {
    if (this.current && this.current.status !== 'completed' && this.current.status !== 'failed' && this.current.status !== 'aborted') {
      throw new Error(
        `A failover is already in flight: ${this.current.id} (status=${this.current.status})`,
      );
    }
    const record: FailoverRecord = {
      id: uid('fo'),
      fromRegion,
      toRegion,
      reason,
      status: 'initiated',
      initiatedAt: nowTs(),
      completedAt: null,
      automatic: false,
      notes: [],
    };
    this.records.push(record);
    this.trimHistory();
    this.current = record;

    eventEngine.emit('dr.failover_initiated', {
      failoverId: record.id,
      fromRegion,
      toRegion,
      reason,
      automatic: false,
      ts: record.initiatedAt,
    });
    return record;
  }

  // --------------------------------------------------------------- complete

  /**
   * Complete a failover. Performs:
   *   1. Mark the record `in_progress`.
   *   2. Promote the secondary via `replicationService.promoteRegion`.
   *   3. Simulate a DNS update (record a note).
   *   4. Run a smoke-test health check.
   *   5. Mark the record `completed` (or `failed` if any step threw).
   */
  completeFailover(failoverId: string): FailoverRecord {
    const record = this.records.find((r) => r.id === failoverId);
    if (!record) {
      throw new Error(`Failover ${failoverId} not found`);
    }
    if (record.status !== 'initiated') {
      throw new Error(
        `Failover ${failoverId} cannot be completed (status=${record.status})`,
      );
    }
    record.status = 'in_progress';
    try {
      // 1. Promote the secondary.
      replicationService.promoteRegion(record.toRegion);
      record.notes.push(`promoted:${record.toRegion}`);

      // 2. Simulate a DNS update.
      record.notes.push('dns-updated');

      // 3. Smoke-test health check (just verify the new primary).
      const primary = replicationService.getPrimary();
      if (primary !== record.toRegion) {
        throw new Error(
          `Promotion failed — primary is ${primary}, expected ${record.toRegion}`,
        );
      }
      record.notes.push('smoke-test-ok');

      record.status = 'completed';
      record.completedAt = nowTs();
      eventEngine.emit('dr.failover_completed', {
        failoverId: record.id,
        fromRegion: record.fromRegion,
        toRegion: record.toRegion,
        automatic: record.automatic,
        durationMs: record.completedAt - record.initiatedAt,
        ts: record.completedAt,
      });
    } catch (err) {
      record.status = 'failed';
      record.completedAt = nowTs();
      record.notes.push(
        `error:${err instanceof Error ? err.message : String(err)}`,
      );
      eventEngine.emit('dr.failover_failed', {
        failoverId: record.id,
        fromRegion: record.fromRegion,
        toRegion: record.toRegion,
        error: err instanceof Error ? err.message : String(err),
        ts: record.completedAt,
      });
    }
    // Clear the in-flight pointer if it matches.
    if (this.current && this.current.id === record.id) {
      this.current = null;
    }
    return record;
  }

  // --------------------------------------------------------------- auto

  /**
   * Automatically fail over if the current primary is unhealthy.
   *
   * Calls `healthCheck(currentPrimary)`. If it returns `false`, an
   * automatic failover is initiated + completed to the next-priority
   * secondary (the first healthy region in `DEFAULT_FAILOVER_PRIORITY`
   * that is not the current primary).
   *
   * Returns the completed `FailoverRecord` if a failover was
   * performed, or null if the primary was healthy.
   */
  autoFailover(healthCheck: HealthCheckFn): FailoverRecord | null {
    const currentPrimary = replicationService.getPrimary();
    if (!currentPrimary) return null;
    if (healthCheck(currentPrimary)) return null;
    // Primary is unhealthy — find the next healthy secondary.
    for (const candidate of DEFAULT_FAILOVER_PRIORITY) {
      if (candidate === currentPrimary) continue;
      if (!healthCheck(candidate)) continue;
      // Found a healthy secondary — initiate + complete the failover.
      const record = this.initiateFailover(
        currentPrimary,
        candidate,
        `auto-failover: primary ${currentPrimary} unhealthy`,
      );
      record.automatic = true;
      return this.completeFailover(record.id);
    }
    // No healthy secondary found — record a failed failover attempt.
    const record: FailoverRecord = {
      id: uid('fo'),
      fromRegion: currentPrimary,
      toRegion: currentPrimary, // no candidate
      reason: 'auto-failover: no healthy secondary available',
      status: 'failed',
      initiatedAt: nowTs(),
      completedAt: nowTs(),
      automatic: true,
      notes: ['no-healthy-secondary'],
    };
    this.records.push(record);
    this.trimHistory();
    eventEngine.emit('dr.failover_failed', {
      failoverId: record.id,
      fromRegion: record.fromRegion,
      toRegion: record.toRegion,
      error: record.reason,
      automatic: true,
      ts: record.completedAt,
    });
    return record;
  }

  // --------------------------------------------------------------- query

  /** The current (in-flight) failover, or null. */
  getFailoverStatus(): FailoverRecord | null {
    return this.current;
  }

  /** All historical failover records (oldest first). */
  getFailoverHistory(): FailoverRecord[] {
    return [...this.records];
  }

  /** The most recent completed/failed failover, or null. */
  getLatestFailover(): FailoverRecord | null {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.status === 'completed' || r.status === 'failed' || r.status === 'aborted') {
        return r;
      }
    }
    return null;
  }

  /** Abort an in-flight failover (e.g. if the primary recovers). */
  abortFailover(failoverId: string): FailoverRecord | null {
    const record = this.records.find((r) => r.id === failoverId);
    if (!record) return null;
    if (record.status !== 'initiated' && record.status !== 'in_progress') {
      return record;
    }
    record.status = 'aborted';
    record.completedAt = nowTs();
    record.notes.push('aborted');
    if (this.current && this.current.id === record.id) {
      this.current = null;
    }
    eventEngine.emit('dr.failover_failed', {
      failoverId: record.id,
      fromRegion: record.fromRegion,
      toRegion: record.toRegion,
      error: 'aborted',
      automatic: record.automatic,
      ts: record.completedAt,
    });
    return record;
  }

  /** Count records by status (for dashboards). */
  countByStatus(): Record<FailoverStatus, number> {
    const out: Record<FailoverStatus, number> = {
      initiated: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
    };
    for (const r of this.records) {
      out[r.status] += 1;
    }
    return out;
  }

  /** Trim history to the configured max. */
  private trimHistory(): void {
    while (this.records.length > this.maxHistory) {
      this.records.shift();
    }
  }

  /** Reset all records (used in tests). */
  reset(): void {
    this.records.length = 0;
    this.current = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_DR_FAILOVER: FailoverService | undefined;
}

/** Singleton failover service. */
export const failoverService: FailoverService =
  globalThis.__PAYSWAP_DR_FAILOVER ?? new FailoverService();

if (!globalThis.__PAYSWAP_DR_FAILOVER) {
  globalThis.__PAYSWAP_DR_FAILOVER = failoverService;
}
