/**
 * PaySwap Protocol — Disaster Recovery — Backup Management.
 *
 * ── P4-1 (C-9): durable, off-process backup storage ──
 *
 * Backups are NO LONGER stored in an in-process `Map`. They are written
 * to the filesystem under `<cwd>/data/backups/` so that a process
 * restart (or crash) does NOT lose them. The `location` field is
 * honest: `file://data/backups/<id>.json` (not a fake `s3://` string
 * literal that pointed to nothing).
 *
 * On-disk layout:
 *   data/backups/
 *     index.json       — { order: string[], records: BackupRecord[] }
 *                        (fast listing without reading every file)
 *     <id>.json        — full StoredBackup (payload + metadata) per backup
 *
 * Swapping to S3 is a config change (no API change):
 *   - `fs.writeFileSync(p, json)`        → `await s3.putObject({ Bucket, Key: p, Body: json })`
 *   - `fs.readFileSync(p, 'utf8')`       → `(await s3.getObject({ Bucket, Key: p })).Body.transformToString()`
 *   - `fs.unlinkSync(p)`                 → `await s3.deleteObject({ Bucket, Key: p })`
 *   - `fs.existsSync(BACKUP_DIR)`        → S3 has no directory concept — skip
 *   - `fs.mkdirSync(BACKUP_DIR)`         → same — skip
 *   The rest of the service (checksum, FIFO eviction, index, verify,
 *   restore) stays identical. Make the read/write helpers async + plumb
 *   `await` through `createBackup` / `restoreFromBackup` / `verifyBackup`
 *   (their call sites in `restore.ts` + `disaster-simulation.ts` already
 *   tolerate a sync API today — making them async is the only caller change).
 *
 * All filesystem operations are SYNCHRONOUS (`*Sync` variants) so the
 * public API stays sync. Backups are infrequent (scheduled every 5 min,
 * plus manual admin triggers) so blocking the event loop briefly on each
 * `writeFileSync` is acceptable. The on-disk files are small (each
 * backup is the serialised event stream — typically a few hundred KB).
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
 *   - logical location string (`file://data/backups/<id>.json`),
 *   - the region the backup is stored in,
 *   - optional `verifiedAt` + `verifyResult` from the last verification.
 *
 * Verification (`verifyBackup`) re-reads the stored payload from disk,
 * recomputes its SHA-256, and compares it to the stored checksum. A
 * `mismatch` means the backup file was corrupted on disk; a `missing`
 * result means the backup id is unknown; an `error` result means the
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
import * as fs from 'node:fs';
import * as path from 'node:path';
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
 * re-read it without re-snapshotting live state). This is what gets
 * serialised to `<id>.json` on disk.
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

/**
 * Maximum number of backups to keep on disk (FIFO eviction).
 *
 * When this limit is exceeded, the oldest backup (by insertion order)
 * is deleted — both its `<id>.json` file and its index entry. This
 * prevents unbounded disk growth from scheduled backups.
 */
const MAX_STORED_BACKUPS = 200;

// ---------------------------------------------------------------------------
// Filesystem store — pure helpers, no class state.
// ---------------------------------------------------------------------------

/**
 * Absolute path to the backup directory. Resolved once at module load
 * from `process.cwd()` so all helpers agree on the location regardless
 * of any later `process.chdir()` calls.
 */
const BACKUP_DIR = path.resolve(process.cwd(), 'data', 'backups');
const BACKUP_INDEX_PATH = path.join(BACKUP_DIR, 'index.json');
const BACKUP_FILE_EXT = '.json';

/**
 * On-disk index of all backups. The `order` array is the FIFO
 * insertion order (oldest first); the `records` array holds the
 * metadata (no payloads) so `listBackups` doesn't need to read every
 * `<id>.json` file.
 */
interface BackupIndex {
  order: string[];
  records: BackupRecord[];
}

/** Build the absolute filesystem path for a backup id. */
function backupFilePath(id: string): string {
  return path.join(BACKUP_DIR, `${id}${BACKUP_FILE_EXT}`);
}

/**
 * Format the public `location` string for a backup id. Honest
 * `file://` URI (relative to cwd) — this is what `BackupRecord.location`
 * returns to callers. Swapping to S3 requires changing this string +
 * the read/write helpers below.
 */
function backupLocation(id: string): string {
  return `file://data/backups/${id}${BACKUP_FILE_EXT}`;
}

/** Ensure the backup directory exists (idempotent). */
function ensureBackupDir(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  } catch {
    // mkdirSync can throw EACCES / EROFS — the next writeFileSync
    // will throw a more informative error.
  }
}

/** Read the on-disk index. Returns an empty index if it doesn't exist. */
function readIndexFromDisk(): BackupIndex {
  try {
    if (!fs.existsSync(BACKUP_INDEX_PATH)) return { order: [], records: [] };
    const raw = fs.readFileSync(BACKUP_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BackupIndex>;
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.records)) {
      return { order: [], records: [] };
    }
    return { order: parsed.order, records: parsed.records };
  } catch {
    return { order: [], records: [] };
  }
}

/**
 * Atomically write the index file. Writes to a `.tmp` file first, then
 * renames — so a crash mid-write leaves either the old index or the
 * new index, never a truncated one.
 */
function writeIndexToDisk(index: BackupIndex): void {
  ensureBackupDir();
  const tmp = `${BACKUP_INDEX_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8');
  fs.renameSync(tmp, BACKUP_INDEX_PATH);
}

/** Write a `StoredBackup` to its own `<id>.json` file. */
function writeBackupFile(stored: StoredBackup): void {
  ensureBackupDir();
  const p = backupFilePath(stored.id);
  // Atomic write: tmp + rename (same pattern as the index).
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

/** Read a `StoredBackup` from disk by id (or null if missing / corrupt). */
function readBackupFile(id: string): StoredBackup | null {
  try {
    const p = backupFilePath(id);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as StoredBackup;
  } catch {
    return null;
  }
}

/** Delete a backup file from disk (best-effort — missing is a no-op). */
function deleteBackupFile(id: string): void {
  try {
    const p = backupFilePath(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // Best-effort — the index is the source of truth for "what backups
    // exist"; a stray file on disk is harmless (just disk waste).
  }
}

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
 *
 * Storage is durable + off-process: every backup is written to
 * `<cwd>/data/backups/<id>.json` on disk. The in-memory `index` field
 * is just a read-cache of `index.json` — it is reloaded from disk on
 * construction and rewritten on every mutation.
 */
export class BackupService {
  /**
   * In-memory cache of the on-disk index. Loaded lazily on first
   * access (or eagerly in the constructor). Mutations go through
   * `persistIndex()` to keep the cache + disk in sync.
   */
  private index: BackupIndex = { order: [], records: [] };
  private indexLoaded = false;
  /** Active scheduled-backup timer (or null). */
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  /** The region newly-created backups are stored in. */
  private storageRegion: Region = DEFAULT_BACKUP_REGION;

  constructor() {
    // Eager-load the index so listBackups() / count() work without an
    // fs read on every call. If the dir or index doesn't exist yet,
    // loadIndex() returns an empty index — that's fine.
    this.loadIndex();
  }

  /** Load (or reload) the on-disk index into the in-memory cache. */
  private loadIndex(): void {
    this.index = readIndexFromDisk();
    this.indexLoaded = true;
  }

  /** Ensure the in-memory index has been loaded (idempotent). */
  private ensureIndexLoaded(): void {
    if (!this.indexLoaded) this.loadIndex();
  }

  /** Persist the in-memory index back to disk (atomic write). */
  private persistIndex(): void {
    writeIndexToDisk(this.index);
  }

  /** Set the region newly-created backups are stored in. */
  setStorageRegion(region: Region): void {
    this.storageRegion = region;
  }

  // --------------------------------------------------------------- create

  /**
   * Create a backup of `type`. Computes the SHA-256 checksum of the
   * serialised payload, records size + location + region, writes the
   * backup to `<cwd>/data/backups/<id>.json`, and updates the index.
   */
  createBackup(type: BackupType): BackupRecord {
    const startedAt = nowTs();
    const payload = this.buildPayload(type);
    const serialised = JSON.stringify(payload);
    const checksum = this.sha256(serialised);
    const size = Buffer.byteLength(serialised, 'utf8');
    const id = uid('bak');
    const createdAt = nowTs();
    const location = backupLocation(id);

    const stored: StoredBackup = {
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

    // 1. Write the backup file (atomic: .tmp + rename).
    writeBackupFile(stored);

    // 2. Update the in-memory index + persist it.
    this.ensureIndexLoaded();
    this.index.order.push(id);
    this.index.records.push({ ...stored });
    this.persistIndex();

    // 3. FIFO eviction (deletes the oldest file when over capacity).
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
    return this.stripPayload(stored);
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
   * Re-read the backup payload FROM DISK, recompute its SHA-256
   * checksum, and compare to the stored checksum. Returns:
   *   - `verified` — checksums match (file is intact),
   *   - `mismatch` — checksums differ (file corrupted on disk),
   *   - `missing`  — backup id unknown (file doesn't exist),
   *   - `error`    — verification itself threw.
   *
   * The verification result + ts are written back to both the backup
   * file and the index, so future `listBackups({ verifiedOnly: true })`
   * calls see the latest status without re-verifying.
   */
  verifyBackup(backupId: string): BackupVerifyResult {
    const stored = readBackupFile(backupId);
    if (!stored) return 'missing';
    try {
      const recomputed = this.sha256(stored.payload);
      const result: BackupVerifyResult = recomputed === stored.checksum ? 'verified' : 'mismatch';
      stored.verifiedAt = nowTs();
      stored.verifyResult = result;
      // Write the updated verification metadata back to disk.
      writeBackupFile(stored);
      // Mirror it in the index too (so listBackups sees the new status).
      this.updateIndexRecord(stored.id, {
        verifiedAt: stored.verifiedAt,
        verifyResult: stored.verifyResult,
      });
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
      // Best-effort write-back — if the file is unreadable we likely
      // can't write to it either, but try anyway.
      try { writeBackupFile(stored); } catch { /* ignore */ }
      this.updateIndexRecord(stored.id, {
        verifiedAt: stored.verifiedAt,
        verifyResult: 'error',
      });
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
   * Restore from a backup. Reads the backup file FROM DISK, parses the
   * payload, and for event-store / full-state backups hydrates the
   * kernel `eventEngine` with the stored events (best effort — the
   * engine's stream is appended to). For ledger snapshots this is a
   * no-op payload return (the snapshot is informational; the ledger
   * engine is not directly mutated from here).
   *
   * Because the backup is on disk, this works EVEN IF the process
   * that created the backup has since died (the previous in-memory
   * `Map` implementation could not satisfy this case — that was the
   * C-9 defect).
   */
  restoreFromBackup(backupId: string): RestoreResult {
    const startedAt = nowTs();
    const stored = readBackupFile(backupId);
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

  /** Get a single backup by id (without the payload). Reads from the in-memory index cache. */
  getBackup(id: string): BackupRecord | null {
    this.ensureIndexLoaded();
    const record = this.index.records.find((r) => r.id === id);
    return record ? { ...record } : null;
  }

  /** List backups matching `filter` (most recent first). Reads from the in-memory index cache. */
  listBackups(filter?: BackupListFilter): BackupRecord[] {
    this.ensureIndexLoaded();
    const records = this.index.records.filter((b) => {
      if (filter?.type && b.type !== filter.type) return false;
      if (filter?.region && b.region !== filter.region) return false;
      if (filter?.sinceTs !== undefined && b.createdAt < filter.sinceTs) return false;
      if (filter?.verifiedOnly && !b.verifiedAt) return false;
      if (filter?.verifyResult && b.verifyResult !== filter.verifyResult) return false;
      return true;
    });
    // Sort by createdAt desc (most recent first). The index's `order`
    // array is insertion order which equals createdAt asc, so a stable
    // reverse would suffice in normal operation — but sort-by-createdAt
    // is more robust if the index file was hand-edited.
    return records.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The most recent backup of `type` (or any type), or null. */
  getLatestBackup(type?: BackupType): BackupRecord | null {
    const list = this.listBackups(type ? { type } : undefined);
    return list[0] ?? null;
  }

  /** Total number of stored backups (reads from the in-memory index cache). */
  count(): number {
    this.ensureIndexLoaded();
    return this.index.records.length;
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
   * Remove backups older than `retentionMs`. Deletes both the
   * `<id>.json` file and the index entry. Returns the number of
   * backups pruned.
   */
  pruneBackups(retentionMs: number): number {
    this.ensureIndexLoaded();
    const cutoff = nowTs() - retentionMs;
    const toPrune = this.index.records.filter((r) => r.createdAt < cutoff);
    if (toPrune.length === 0) return 0;
    const pruneSet = new Set(toPrune.map((r) => r.id));
    for (const r of toPrune) {
      deleteBackupFile(r.id);
    }
    this.index.records = this.index.records.filter((r) => !pruneSet.has(r.id));
    this.index.order = this.index.order.filter((id) => !pruneSet.has(id));
    this.persistIndex();
    eventEngine.emit('dr.backup_pruned', { pruned: toPrune.length, cutoff, ts: nowTs() });
    return toPrune.length;
  }

  // --------------------------------------------------------------- helpers

  /** Strip the payload off a `StoredBackup` for public return. */
  private stripPayload(stored: StoredBackup): BackupRecord {
    const { payload: _payload, ...publicRecord } = stored;
    void _payload;
    return publicRecord;
  }

  /**
   * Update a single backup's metadata in the in-memory index + persist
   * to disk. Used by `verifyBackup` to write back the verification
   * result without re-reading the whole index.
   */
  private updateIndexRecord(
    id: string,
    patch: Partial<Pick<BackupRecord, 'verifiedAt' | 'verifyResult'>>,
  ): void {
    this.ensureIndexLoaded();
    const record = this.index.records.find((r) => r.id === id);
    if (!record) {
      // The backup file exists but the index doesn't know about it —
      // re-sync by reloading from disk + retrying once.
      this.loadIndex();
      const record2 = this.index.records.find((r) => r.id === id);
      if (!record2) return;
      Object.assign(record2, patch);
    } else {
      Object.assign(record, patch);
    }
    this.persistIndex();
  }

  /**
   * Evict the oldest backups if we're over capacity. Deletes the
   * oldest backup's file + removes it from the index. Loops until
   * `index.order.length <= MAX_STORED_BACKUPS`.
   */
  private evictIfNeeded(): void {
    let evicted = 0;
    while (this.index.order.length > MAX_STORED_BACKUPS) {
      const oldestId = this.index.order.shift();
      if (!oldestId) break;
      deleteBackupFile(oldestId);
      this.index.records = this.index.records.filter((r) => r.id !== oldestId);
      evicted += 1;
    }
    if (evicted > 0) {
      this.persistIndex();
      // Best-effort event — informational only (not a public DR event).
      try {
        eventEngine.emit('dr.backup_pruned', {
          pruned: evicted,
          cutoff: 0,
          ts: nowTs(),
          reason: 'fifo-eviction',
        });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Shutdown — stop schedules + clear the in-memory index cache.
   *
   * IMPORTANT: this does NOT delete the on-disk backups — they are the
   * durable state (the whole point of P4-1). The cache is just cleared
   * so the next access re-reads from disk. Used in tests to reset
   * singleton state between test cases.
   */
  shutdown(): void {
    this.stopSchedule();
    this.index = { order: [], records: [] };
    this.indexLoaded = false;
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
