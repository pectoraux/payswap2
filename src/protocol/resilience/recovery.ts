/**
 * PaySwap Protocol — Resilience / Database + State Recovery.
 * -----------------------------------------------------------------------------
 * The RecoveryEngine produces recovery PLANS for disaster scenarios and
 * executes them:
 *
 *   - `planFor(scenario)` → returns a RecoveryPlan (strategy, steps, ETA,
 *     data-loss risk, prerequisites).
 *   - `executeRebuildFromEvents()` → rebuilds all protocol projections from
 *     the event stream (ledger, twin-token balances, merchant state). Returns
 *     a summary (success, modules rebuilt, duration, event count).
 *   - `executeSnapshotReplay(snapshotTs)` → restores from the nearest snapshot
 *     + replays post-snapshot events. Faster than a full rebuild.
 *   - `assessMultiRegionReadiness()` → returns a checklist of multi-region
 *     prerequisites (replication lag, failover tested, DNS, etc.).
 *   - `backup()` → exports a backup blob (events + snapshots + current state).
 *     `restore(blob)` → restores from a backup.
 *
 * The engine is a pure orchestration layer — the actual rebuild logic lives
 * in the ledger module (`rebuildLedgerFromEvents`) and other protocol
 * projections. The engine delegates to those.
 *
 * INVARIANT: a rebuild from events produces a state byte-identical to the
 * original (assuming deterministic projection). `verifyReplayDeterminism`
 * in `event-replay.ts` enforces this.
 */
import { createHash } from 'crypto';
import { eventEngine } from '@/kernel/event';
import type { SimulationEvent } from '@/kernel/types';

/** Available recovery strategies. */
export type RecoveryStrategy =
  | 'event_sourced_rebuild'
  | 'snapshot_replay'
  | 'manual_restore'
  | 'multi_region_failover';

/** Data-loss risk assessment. */
export type DataLossRisk = 'none' | 'minimal' | 'significant';

/** A recovery plan for a disaster scenario. */
export interface RecoveryPlan {
  strategy: RecoveryStrategy;
  steps: string[];
  estimatedRecoveryMs: number;
  dataLossRisk: DataLossRisk;
  prerequisites: string[];
}

/** Disaster scenarios we plan for. */
export type RecoveryScenario = 'db_corruption' | 'region_loss' | 'partial_state_loss';

/** Result of `executeRebuildFromEvents`. */
export interface RebuildResult {
  success: boolean;
  rebuiltModules: string[];
  durationMs: number;
  eventCount: number;
  errors: string[];
}

/** Result of `executeSnapshotReplay`. */
export interface SnapshotReplayResult extends RebuildResult {
  usedSnapshotTs?: number;
  replayedEventCount: number;
}

/** A backup blob — events + snapshots + current state. */
export interface BackupBlob {
  version: 1;
  createdAt: number;
  events: SimulationEvent[];
  snapshots: unknown[];
  state: Record<string, unknown>;
  checksum: string;
}

/** Multi-region readiness checklist item. */
export interface ReadinessChecklistItem {
  name: string;
  description: string;
  status: 'ready' | 'not_ready' | 'not_implemented';
  details?: string;
}

/** Result of `assessMultiRegionReadiness`. */
export interface MultiRegionReadiness {
  overall: 'ready' | 'partial' | 'not_ready';
  items: ReadinessChecklistItem[];
  readyCount: number;
  totalCount: number;
}

/**
 * Recovery engine. Singleton `recoveryEngine` is exported below.
 */
export class RecoveryEngine {
  /**
   * Produce a recovery plan for a disaster scenario.
   *
   * Each plan is a declarative statement of:
   *   - the strategy (event_sourced_rebuild / snapshot_replay / manual_restore
   *     / multi_region_failover)
   *   - ordered steps to execute
   *   - ETA (ms)
   *   - data-loss risk (none / minimal / significant)
   *   - prerequisites (e.g. "event stream must be intact")
   */
  planFor(scenario: RecoveryScenario): RecoveryPlan {
    switch (scenario) {
      case 'db_corruption':
        return {
          strategy: 'event_sourced_rebuild',
          steps: [
            'Quarantine the corrupted DB — switch writes to the event log only.',
            'Verify the event stream is intact (read all events, check hashes).',
            'Take a fresh snapshot of the (corrupted) current state for forensic analysis.',
            'Rebuild the ledger from events: ledgerEngine = rebuildLedgerFromEvents(events).',
            'Rebuild twin-token balances from events: twinTokenEngine.rebuildFromEvents(events).',
            'Rebuild merchant state from events: merchantRegistry.rebuildFromEvents(events).',
            'Rebuild LP state from events: lpLifecycle.rebuildFromEvents(events).',
            'Verify integrity: ledger.verifyIntegrity() must report balanced=true.',
            'Verify determinism: replay events twice, compare outputs.',
            'Cut over to the rebuilt state. Resume normal writes.',
          ],
          estimatedRecoveryMs: 5 * 60 * 1000, // 5 minutes
          dataLossRisk: 'none',
          prerequisites: [
            'Event stream is intact (append-only, replicated).',
            'Projection functions are deterministic (verified by replay).',
            'Sufficient memory to hold the full event stream in-process.',
          ],
        };

      case 'region_loss':
        return {
          strategy: 'multi_region_failover',
          steps: [
            'Declare region-wide outage (outageManager.declare("region", regionName, "full")).',
            'Update DNS to point at the failover region (TTL < 60s required).',
            'Wait for cross-region replication to catch up (verify lag < 1s).',
            'Promote the failover region to primary (switch write leader).',
            'Verify the failover region is serving reads + writes correctly.',
            'Drain queued operations (webhooks, payouts) from the DLQ.',
            'When the failed region recovers, demote it to secondary (do not auto-promote).',
          ],
          estimatedRecoveryMs: 5 * 60 * 1000, // 5 minutes
          dataLossRisk: 'minimal',
          prerequisites: [
            'Multi-region replication is configured + verified.',
            'DNS TTL is < 60s (otherwise failover is delayed by TTL).',
            'Failover runbook is tested (game-day exercises).',
            'Cross-region replication lag is monitored + alerting.',
          ],
        };

      case 'partial_state_loss':
        return {
          strategy: 'snapshot_replay',
          steps: [
            'Identify which projection is corrupted (ledger / twin-token / merchant / LP).',
            'Find the latest intact snapshot for that projection (snapshotStore.latest).',
            'Restore the snapshot into a fresh projection instance.',
            'Replay post-snapshot events through the projection.',
            'Verify integrity (ledger trial balance, twin-token backing, etc.).',
            'Cut over to the rebuilt projection.',
          ],
          estimatedRecoveryMs: 60 * 1000, // 1 minute
          dataLossRisk: 'none',
          prerequisites: [
            'Snapshots are taken regularly (at least hourly).',
            'Post-snapshot events are intact in the event stream.',
            'Snapshot restore + replay is tested (runbook verified).',
          ],
        };

      default:
        return {
          strategy: 'manual_restore',
          steps: [
            'Investigate the failure scenario.',
            'Consult the runbook.',
            'Engage on-call SRE.',
          ],
          estimatedRecoveryMs: 30 * 60 * 1000, // 30 minutes
          dataLossRisk: 'significant',
          prerequisites: ['On-call SRE is paged.'],
        };
    }
  }

  /**
   * Execute a full rebuild from the event stream.
   *
   * Rebuilds the ledger (and optionally other projections) by replaying all
   * events. Returns a summary: success, modules rebuilt, duration, event
   * count, errors.
   *
   * The caller supplies `rebuildFns` — a map of module name → rebuild function
   * (events) → rebuilt instance. This keeps the engine decoupled from any
   * specific projection.
   */
  executeRebuildFromEvents(
    events: SimulationEvent[],
    rebuildFns: Record<string, (events: SimulationEvent[]) => unknown>,
  ): RebuildResult {
    const start = Date.now();
    const rebuiltModules: string[] = [];
    const errors: string[] = [];
    for (const [name, fn] of Object.entries(rebuildFns)) {
      try {
        fn(events);
        rebuiltModules.push(name);
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      eventEngine.emit(
        'resilience.rebuild_completed',
        {
          strategy: 'event_sourced_rebuild',
          modules: rebuiltModules,
          eventCount: events.length,
          durationMs: Date.now() - start,
          errors,
          ts: Date.now(),
        },
        0,
      );
    } catch {
      // Best-effort.
    }
    return {
      success: errors.length === 0,
      rebuiltModules,
      durationMs: Date.now() - start,
      eventCount: events.length,
      errors,
    };
  }

  /**
   * Execute a snapshot-based replay. Restores from the nearest snapshot at or
   * before `snapshotTs`, then replays post-snapshot events.
   *
   * The caller supplies `restoreFn` (restore snapshot → ctx), `replayFn`
   * (replay event → ctx), and `finalizeFn` (produce output from ctx).
   */
  executeSnapshotReplay<TCtx>(
    snapshotTs: number,
    events: SimulationEvent[],
    restoreFn: () => TCtx,
    replayFn: (event: SimulationEvent, ctx: TCtx) => void,
  ): SnapshotReplayResult {
    const start = Date.now();
    const ctx = restoreFn();
    const postSnapshot = events.filter((e) => e.ts > snapshotTs);
    const errors: string[] = [];
    for (const event of postSnapshot) {
      try {
        replayFn(event, ctx);
      } catch (err) {
        errors.push(`${event.id} (${event.type}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      success: errors.length === 0,
      rebuiltModules: ['snapshot_restored'],
      durationMs: Date.now() - start,
      eventCount: events.length,
      errors,
      usedSnapshotTs: snapshotTs,
      replayedEventCount: postSnapshot.length,
    };
  }

  /**
   * Assess multi-region readiness. Returns a checklist of prerequisites.
   * Most items are "not_implemented" — this is a documented gap, not a bug.
   */
  assessMultiRegionReadiness(): MultiRegionReadiness {
    const items: ReadinessChecklistItem[] = [
      {
        name: 'cross_region_replication',
        description: 'Cross-region replication is configured + verified for the event stream.',
        status: 'not_implemented',
        details: 'The in-memory event engine is single-region. Production would use Kafka / CockroachDB with geo-replication.',
      },
      {
        name: 'replication_lag_monitoring',
        description: 'Replication lag is monitored + alerting (threshold < 1s).',
        status: 'not_implemented',
        details: 'No replication is configured in the sandbox.',
      },
      {
        name: 'dns_failover',
        description: 'DNS TTL is < 60s for the API endpoint (fast failover).',
        status: 'not_implemented',
        details: 'DNS is managed by the platform layer (Vercel / Cloudflare), not the protocol layer.',
      },
      {
        name: 'failover_runbook_tested',
        description: 'Failover runbook is documented + tested (game-day exercises quarterly).',
        status: 'not_implemented',
        details: 'No runbook exists yet — this is a documented gap.',
      },
      {
        name: 'event_stream_replicated',
        description: 'Event stream is replicated to the failover region (source of truth for rebuild).',
        status: 'not_implemented',
        details: 'In-memory event engine; no replication.',
      },
      {
        name: 'dlq_drainable',
        description: 'DLQ entries can be drained in the failover region (post-failover).',
        status: 'ready',
        details: 'The DLQ is in-memory; in production it would be a shared DB table accessible from any region.',
      },
      {
        name: 'circuit_breakers_per_region',
        description: 'Circuit breakers are configured per-region (independent failure detection).',
        status: 'ready',
        details: 'The CircuitBreakerRegistry is per-process; each region runs its own.',
      },
      {
        name: 'outage_detection',
        description: 'Outage detection works per-region (regional circuit open → regional outage).',
        status: 'ready',
        details: 'The OutageManager detects outages from circuit breaker state — works per-region.',
      },
      {
        name: 'idempotency_keys_global',
        description: 'Idempotency keys are globally unique (no cross-region collisions).',
        status: 'ready',
        details: 'Idempotency keys are content hashes (SHA-256) — globally unique by construction.',
      },
      {
        name: 'backup_restore_tested',
        description: 'Backup + restore is tested (monthly restore drill).',
        status: 'not_implemented',
        details: 'backup() / restore() exist but no automated drill.',
      },
    ];
    const readyCount = items.filter((i) => i.status === 'ready').length;
    const overall: MultiRegionReadiness['overall'] =
      readyCount === items.length ? 'ready' : readyCount >= items.length / 2 ? 'partial' : 'not_ready';
    return { overall, items, readyCount, totalCount: items.length };
  }

  /**
   * Export a backup blob — events + snapshots + current state.
   *
   * The blob includes a SHA-256 checksum over the events (so restore can
   * verify integrity).
   */
  backup(opts: {
    events: SimulationEvent[];
    snapshots?: unknown[];
    state?: Record<string, unknown>;
  }): BackupBlob {
    const eventsJson = JSON.stringify(opts.events);
    const checksum = 'sha256:' + createHash('sha256').update(eventsJson).digest('hex');
    return {
      version: 1,
      createdAt: Date.now(),
      events: opts.events,
      snapshots: opts.snapshots ?? [],
      state: opts.state ?? {},
      checksum,
    };
  }

  /**
   * Restore from a backup blob. Verifies the checksum + returns the events,
   * snapshots, and state for the caller to replay.
   *
   * Throws if the checksum doesn't match (corrupted backup).
   */
  restore(blob: BackupBlob): {
    events: SimulationEvent[];
    snapshots: unknown[];
    state: Record<string, unknown>;
  } {
    const eventsJson = JSON.stringify(blob.events);
    const actualChecksum = 'sha256:' + createHash('sha256').update(eventsJson).digest('hex');
    if (actualChecksum !== blob.checksum) {
      throw new Error(`Backup checksum mismatch — blob is corrupted. Expected ${blob.checksum}, got ${actualChecksum}.`);
    }
    return {
      events: blob.events,
      snapshots: blob.snapshots,
      state: blob.state,
    };
  }
}

/** Singleton recovery engine. */
export const recoveryEngine = new RecoveryEngine();
