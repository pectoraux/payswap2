/**
 * PaySwap Protocol — Disaster Recovery — Backup Management.
 *
 * The backup service creates, verifies, restores, schedules, and prunes
 * backups of three kinds:
 *
 *  - `event_store`     — a snapshot of the entire kernel event stream
 *                        (the single source of truth).
 *  - `ledger_snapshot` — a point-in-time snapshot of the protocol ledger
 *                        (account balances + trial balance + entry count).
 *  - `full_state`      — both of the above combined into one artefact.
 *
 * Every backup records:
 *   - SHA-256 checksum of the serialised payload (so corruption can be
 *     detected by re-verifying later),
 *   - size in bytes,
 *   - logical location string (e.g. `s3://payswap-backups/...`),
 *   - the region the backup is stored in,
 *   - optional `verifiedAt` + `verifyResult` from the last verification.
 *
 * Verification (`verifyBackup`) re-reads the stored payload, recomputes
 * its SHA-256, and compares it to the stored checksum. A `mismatch`
 * means the backup payload was corrupted in storage; a `missing` result
 * means the backup id is unknown; an `error` result means the
 * verification itself threw.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `dr.backup_created`     — after each backup is taken.
 *  - `dr.backup_verified`    — after each verification.
 *  - `dr.backup_restored`    — after each restore.
 *  - `dr.backup_pruned`      — after each prune pass.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support`, `eventEngine` from `@/kernel/event`, and the
 * protocol-layer `ledgerEngine` from `@/protocol/ledger/engine`
 * (matching `src/protocol/ops/dashboards.ts`'s pattern). No kernel
 * files are modified.
 */
import { createHash } from 'node:crypto';
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';
import type { SimulationEvent } from '@/kernel/types';
import { ledgerEngine } from '@/protocol/ledger/engine';
import type { BackupRecord, BackupType, BackupVerifyResult, Region } from './types';
import { replicationService } from './replication';

/**
 * Synchronously read a best-effort snapshot of the protocol ledger
 * engine (trial balance + entry / leg counts + next seq). Returns
 * `null` if the ledger engine is unavailable (e.g. not yet
 * initialised in this process).
 *
 * The ledger module is imported eagerly at the top of this file
 * (matching `src/protocol/ops/dashboards.ts`'s pattern). The eager
 * import is cheap — the ledger engine is pure in-memory state.
 */
function readLedgerSnapshotSync(): {
  trialBalance: unknown;
  entryCount: number | null;
  legCount: number | null;
  nextSeq: number | null;
  ts: number;
} | null {
  try {
    if (!ledgerEngine || typeof ledgerEngine.getTrialBalance !== 'function') return null;
    return {
      trialBalance: ledgerEngine.getTrialBalance(),
      entryCount: typeof ledgerEngine.count === 'function' ? ledgerEngine.count() : null,
      legCount: typeof ledgerEngine.legCount === 'function' ? ledgerEngine.legCount() : null,
      nextSeq: typeof ledgerEngine.currentSeq === 'function' ? ledgerEngine.currentSeq() : null,
      ts: nowTs(),
    };
  } catch {
    return null;
  }
}

/**
 * Internal representation of a stored backup — the `BackupRecord` (the
 * public metadata) plus the raw payload bytes (so verification can
 * re-read it without re-snapshotting live state).
 */
interface StoredBackup extends BackupRecord {
  /** The serialised payload (UTF-8 JSON string). */
  payload: string;
}

/** Filter passed to `listBackups`. */
export interface BackupListFilter {
  type?: BackupType;
  region?: Region;
  /** Only backups created at or after this ts. */
  sinceTs?: number;
  /** Only backups that have been verified. */
  verifiedOnly?: boolean;
  /** Only backups whose verification returned this result. */
  verifyResult?: BackupVerifyResult;
}

/** The result of a restore operation. */
export interface RestoreResult {
  backupId: string;
  success: boolean;
  durationMs: number;
  eventsRestored: number;
  notes: string[];
}

/** Default backup storage region. */
const DEFAULT_BACKUP_REGION: Region = 'us-east-1';

/** Maximum number of in-memory backups to keep (FIFO eviction). */
const MAX_IN_MEMORY_BACKUPS = 200;

/**
 * Lazily read the current event stream from the kernel `eventEngine`.
 */
function readEventStream(): SimulationEvent[] {
  try {
    return eventEngine.read();
  } catch {
    return [];
  }
}


/**
 * Backup service — creates, verifies, restores, schedules, and prunes
 * backups of the event store, ledger snapshots, and full state.
 */
export class BackupService {
  private backups = new Map<string, StoredBackup>();
  /** Insertion order of backup ids (for FIFO eviction + ordering). */
  private order: string[] = [];
  /** Active scheduled-backup timer (or null). */
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  /** The region newly-created backups are stored in. */
  private storageRegion: Region = DEFAULT_BACKUP_REGION;

  /** Set the region newly-created backups are stored in. */
  setStorageRegion(region: Region): void {
    this.storageRegion = region;
  }

  // --------------------------------------------------------------- create

  /**
   * Create a backup of `type`. Computes the SHA-256 checksum of the
   * serialised payload, records size + location + region, and stores
   * the payload in-memory for later verification.
   */
  createBackup(type: BackupType): BackupRecord {
    const startedAt = nowTs();
    const payload = this.buildPayload(type);
    const serialised = JSON.stringify(payload);
    const checksum = this.sha256(serialised);
    const size = Buffer.byteLength(serialised, 'utf8');
    const id = uid('bak');
    const createdAt = nowTs();
    const location = `s3://payswap-backups/${this.storageRegion}/${type}/${id}`;

    const record: StoredBackup = {
      id,
      type,
      size,
      createdAt,
      checksum,
      location,
      region: this.storageRegion,
      verifiedAt: null,
      verifyResult: null,
      payload: serialised,
    };
    this.backups.set(id, record);
    this.order.push(id);
    this.evictIfNeeded();

    eventEngine.emit('dr.backup_created', {
      backupId: id,
      type,
      size,
      checksum,
      region: this.storageRegion,
      durationMs: nowTs() - startedAt,
      eventCount: type === 'event_store' || type === 'full_state'
        ? (payload as { events?: unknown[] }).events?.length ?? 0
        : 0,
    });
    return this.stripPayload(record);
  }

  /** Build the payload object for a given backup type. */
  private buildPayload(type: BackupType): Record<string, unknown> {
    const ts = nowTs();
    switch (type) {
      case 'event_store': {
        const events = readEventStream();
        return { type, ts, events };
      }
      case 'ledger_snapshot': {
        return { type, ts, ledger: readLedgerSnapshotSync() };
      }
      case 'full_state': {
        const events = readEventStream();
        return {
          type,
          ts,
          events,
          ledger: readLedgerSnapshotSync(),
          primaryRegion: replicationService.getPrimary(),
        };
      }
      default:
        return { type, ts };
    }
  }

  /** Compute the SHA-256 hex digest of a string. */
  private sha256(s: string): string {
    return createHash('sha256').update(s, 'utf8').digest('hex');
  }

  // --------------------------------------------------------------- verify

  /**
   * Re-read the backup payload, recompute its SHA-256 checksum, and
   * compare to the stored checksum. Returns:
   *   - `verified` — checksums match,
   *   - `mismatch` — checksums differ (payload corrupted),
   *   - `missing`  — backup id unknown,
   *   - `error`    — verification itself threw.
   */
  verifyBackup(backupId: string): BackupVerifyResult {
    const stored = this.backups.get(backupId);
    if (!stored) return 'missing';
    try {
      const recomputed = this.sha256(stored.payload);
      const result: BackupVerifyResult = recomputed === stored.checksum ? 'verified' : 'mismatch';
      stored.verifiedAt = nowTs();
      stored.verifyResult = result;
      eventEngine.emit('dr.backup_verified', {
        backupId,
        result,
        checksum: stored.checksum,
        recomputed,
        ts: stored.verifiedAt,
      });
      return result;
    } catch {
      stored.verifiedAt = nowTs();
      stored.verifyResult = 'error';
      eventEngine.emit('dr.backup_verified', {
        backupId,
        result: 'error',
        ts: stored.verifiedAt,
      });
      return 'error';
    }
  }

  // --------------------------------------------------------------- restore

  /**
   * Restore from a backup. For event-store / full-state backups this
   * hydrates the kernel `eventEngine` with the stored events (best
   * effort — the engine's stream is appended to). For ledger snapshots
   * this is a no-op payload return (the snapshot is informational; the
   * ledger engine is not directly mutated from here).
   */
  restoreFromBackup(backupId: string): RestoreResult {
    const startedAt = nowTs();
    const stored = this.backups.get(backupId);
    if (!stored) {
      return {
        backupId,
        success: false,
        durationMs: nowTs() - startedAt,
        eventsRestored: 0,
        notes: ['backup-not-found'],
      };
    }
    const notes: string[] = [];
    let eventsRestored = 0;
    try {
      const payload = JSON.parse(stored.payload) as {
        events?: SimulationEvent[];
        ledger?: unknown;
        primaryRegion?: string | null;
      };
      if (Array.isArray(payload.events) && payload.events.length > 0) {
        // Best-effort: append the events back to the kernel stream.
        // The kernel `eventEngine` exposes its stream via `read()` but
        // not a direct `append()` — we push via the public `emit()`
        // contract for each event so subscribers are notified too.
        // (If a subscriber throws, the emit() is still safe — see
        // kernel/event.ts.)
        for (const evt of payload.events) {
          try {
            eventEngine.emit(evt.type, evt.payload ?? {}, evt.frame ?? 0);
            eventsRestored += 1;
          } catch {
            // Skip a single bad event — don't abort the whole restore.
          }
        }
        notes.push(`restored-${eventsRestored}-events`);
      }
      if (payload.ledger) {
        notes.push('ledger-snapshot-available');
      }
      if (payload.primaryRegion) {
        notes.push(`primary-at-backup:${payload.primaryRegion}`);
      }
      const durationMs = nowTs() - startedAt;
      eventEngine.emit('dr.backup_restored', {
        backupId,
        success: true,
        durationMs,
        eventsRestored,
      });
      return { backupId, success: true, durationMs, eventsRestored, notes };
    } catch (err) {
      const durationMs = nowTs() - startedAt;
      notes.push(
        `restore-error:${err instanceof Error ? err.message : String(err)}`,
      );
      eventEngine.emit('dr.backup_restored', {
        backupId,
        success: false,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      return { backupId, success: false, durationMs, eventsRestored, notes };
    }
  }

  // --------------------------------------------------------------- query

  /** Get a single backup by id (without the payload). */
  getBackup(id: string): BackupRecord | null {
    const stored = this.backups.get(id);
    return stored ? this.stripPayload(stored) : null;
  }

  /** List backups matching `filter` (most recent first). */
  listBackups(filter?: BackupListFilter): BackupRecord[] {
    const records = this.order
      .map((id) => this.backups.get(id)!)
      .filter(Boolean)
      .filter((b) => {
        if (filter?.type && b.type !== filter.type) return false;
        if (filter?.region && b.region !== filter.region) return false;
        if (filter?.sinceTs !== undefined && b.createdAt < filter.sinceTs) return false;
        if (filter?.verifiedOnly && !b.verifiedAt) return false;
        if (filter?.verifyResult && b.verifyResult !== filter.verifyResult) return false;
        return true;
      })
      .map((b) => this.stripPayload(b));
    return records.reverse(); // most recent first
  }

  /** The most recent backup of `type` (or any type), or null. */
  getLatestBackup(type?: BackupType): BackupRecord | null {
    const list = this.listBackups(type ? { type } : undefined);
    return list[0] ?? null;
  }

  /** Total number of stored backups. */
  count(): number {
    return this.backups.size;
  }

  // --------------------------------------------------------------- schedule

  /**
   * Schedule periodic backup creation every `intervalMs`. Replaces any
   * existing schedule. The timer is `unref()`'d so it does not keep
   * Node.js alive. Returns a stop function.
   */
  scheduleBackups(intervalMs: number, type: BackupType = 'event_store'): () => void {
    this.stopSchedule();
    if (intervalMs <= 0) return () => {};
    this.scheduleTimer = setInterval(() => {
      try {
        this.createBackup(type);
      } catch {
        // A scheduled backup must never crash the process.
      }
    }, intervalMs);
    if (this.scheduleTimer && typeof this.scheduleTimer === 'object' && 'unref' in this.scheduleTimer) {
      (this.scheduleTimer as { unref: () => void }).unref();
    }
    return () => this.stopSchedule();
  }

  /** Stop the periodic backup schedule (if any). */
  stopSchedule(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  // --------------------------------------------------------------- prune

  /**
   * Remove backups older than `retentionMs`. Returns the number of
   * backups pruned.
   */
  pruneBackups(retentionMs: number): number {
    const cutoff = nowTs() - retentionMs;
    let pruned = 0;
    for (const id of [...this.order]) {
      const stored = this.backups.get(id);
      if (!stored) continue;
      if (stored.createdAt < cutoff) {
        this.backups.delete(id);
        const idx = this.order.indexOf(id);
        if (idx >= 0) this.order.splice(idx, 1);
        pruned += 1;
      }
    }
    if (pruned > 0) {
      eventEngine.emit('dr.backup_pruned', { pruned, cutoff, ts: nowTs() });
    }
    return pruned;
  }

  // --------------------------------------------------------------- helpers

  /** Strip the payload off a `StoredBackup` for public return. */
  private stripPayload(stored: StoredBackup): BackupRecord {
    const { payload: _payload, ...publicRecord } = stored;
    void _payload;
    return publicRecord;
  }

  /** Evict the oldest backups if we're over capacity. */
  private evictIfNeeded(): void {
    while (this.order.length > MAX_IN_MEMORY_BACKUPS) {
      const oldestId = this.order.shift();
      if (oldestId) this.backups.delete(oldestId);
    }
  }

  /** Shutdown — stop schedules + clear storage (used in tests). */
  shutdown(): void {
    this.stopSchedule();
    this.backups.clear();
    this.order.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_DR_BACKUP: BackupService | undefined;
}

/** Singleton backup service. Storage region defaults to `us-east-1`. */
export const backupService: BackupService =
  globalThis.__PAYSWAP_DR_BACKUP ?? new BackupService();

if (!globalThis.__PAYSWAP_DR_BACKUP) {
  globalThis.__PAYSWAP_DR_BACKUP = backupService;
}
