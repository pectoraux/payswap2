/**
 * PaySwap Protocol — Disaster Recovery — Multi-Region Replication.
 *
 * The replication service tracks every event emitted on the kernel
 * `eventEngine` and "replicates" it to all configured secondary regions.
 * Replication is **simulated**: each secondary region has a configurable
 * network latency (default ~50–250ms depending on the inter-region hop)
 * and the service tracks the per-secondary lag (how far behind the
 * secondary is, in ms).
 *
 * The lag model is:
 *   - When an event is replicated, the secondary's `pendingSince` is set
 *     to `now`.
 *   - After the simulated network delay elapses, the secondary
 *     acknowledges the event and its `lastSyncTs` advances.
 *   - The reported lag is `now - lastSyncTs` (or `now - pendingSince`
 *     while a replication is in flight).
 *
 * The service can **promote** a secondary to primary (failover). When
 * a region is promoted, it becomes the new source for replication and
 * the old primary becomes a secondary.
 *
 * Events emitted on the kernel `eventEngine`:
 *  - `dr.event_replicated`   — after each event is queued for replication.
 *  - `dr.region_promoted`    — after a region is promoted to primary.
 *
 * The kernel is FROZEN — this module imports only `uid`, `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No kernel
 * files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { uid, nowTs } from '@/kernel/support';
import type { SimulationEvent } from '@/kernel/types';
import type { Region, ReplicationLag } from './types';

/**
 * Simulated inter-region network latencies (ms), keyed by
 * `{source}->{target}`. Falls back to a default of 150ms for any pair
 * not explicitly listed.
 *
 * These approximate real-world fibre distances:
 *   - us-east-1 ↔ eu-west-1:      ~80ms (trans-Atlantic)
 *   - us-east-1 ↔ ap-southeast-1: ~220ms (trans-Pacific)
 *   - us-east-1 ↔ af-south-1:     ~250ms
 *   - eu-west-1 ↔ ap-southeast-1: ~170ms
 *   - eu-west-1 ↔ af-south-1:     ~160ms
 *   - ap-southeast-1 ↔ af-south-1: ~280ms
 */
const DEFAULT_LATENCIES_MS: Record<string, number> = {
  'us-east-1->eu-west-1': 80,
  'eu-west-1->us-east-1': 80,
  'us-east-1->ap-southeast-1': 220,
  'ap-southeast-1->us-east-1': 220,
  'us-east-1->af-south-1': 250,
  'af-south-1->us-east-1': 250,
  'eu-west-1->ap-southeast-1': 170,
  'ap-southeast-1->eu-west-1': 170,
  'eu-west-1->af-south-1': 160,
  'af-south-1->eu-west-1': 160,
  'ap-southeast-1->af-south-1': 280,
  'af-south-1->ap-southeast-1': 280,
};

/** Default latency used when no explicit pair is configured. */
const FALLBACK_LATENCY_MS = 150;

/** Internal per-secondary replication state. */
interface SecondaryState {
  region: Region;
  /** ts of the most recent ACK from this secondary. */
  lastSyncTs: number;
  /** ts of the most recent in-flight replication (or null). */
  pendingSince: number | null;
  /** Number of events replicated to this secondary. */
  replicatedCount: number;
  /** Number of events ACK'd by this secondary. */
  ackedCount: number;
  /** Active setTimeout handles (so we can cancel on shutdown). */
  pendingTimers: Set<ReturnType<typeof setTimeout>>;
}

/** A region that has been configured (primary or secondary). */
interface ConfiguredRegion {
  region: Region;
  isPrimary: boolean;
  configuredAt: number;
}

/**
 * Multi-region replication service.
 *
 * Use `configureRegion(region, isPrimary)` to register regions, then
 * either call `replicate(event)` manually or `attach()` to auto-ingest
 * every kernel event.
 */
export class ReplicationService {
  private regions = new Map<Region, ConfiguredRegion>();
  private secondaries = new Map<Region, SecondaryState>();
  private primary: Region | null = null;
  /** Optional latency overrides (ms) per `{source}->{target}`. */
  private latencyOverrides = new Map<string, number>();
  /** Whether auto-ingest is attached to the kernel event bus. */
  private detachFn: (() => void) | null = null;

  // --------------------------------------------------------------- configure

  /**
   * Register a region. The first region registered as `isPrimary=true`
   * becomes the primary; subsequent `isPrimary=true` calls promote that
   * region (demoting the previous primary).
   */
  configureRegion(region: Region, isPrimary: boolean): void {
    const existing = this.regions.get(region);
    if (existing) {
      existing.isPrimary = isPrimary;
    } else {
      this.regions.set(region, { region, isPrimary, configuredAt: nowTs() });
    }
    if (isPrimary) {
      if (this.primary && this.primary !== region) {
        // Demote the previous primary — it becomes a secondary.
        this.secondaries.set(this.primary, this.ensureSecondary(this.primary));
      }
      this.primary = region;
      // A newly promoted primary is no longer a secondary.
      this.secondaries.delete(region);
    } else if (this.primary !== region) {
      this.ensureSecondary(region);
    }
  }

  /** Ensure a `SecondaryState` exists for `region` (does not overwrite). */
  private ensureSecondary(region: Region): SecondaryState {
    let s = this.secondaries.get(region);
    if (!s) {
      s = {
        region,
        lastSyncTs: nowTs(),
        pendingSince: null,
        replicatedCount: 0,
        ackedCount: 0,
        pendingTimers: new Set(),
      };
      this.secondaries.set(region, s);
    }
    return s;
  }

  /** Override the simulated latency for a `{source}->{target}` pair. */
  setLatency(source: Region, target: Region, ms: number): void {
    this.latencyOverrides.set(`${source}->${target}`, Math.max(0, ms));
  }

  // --------------------------------------------------------------- replicate

  /**
   * Replicate an event to all configured secondaries. Each secondary
   * gets a simulated in-flight replication that ACKs after the
   * configured network latency.
   */
  replicate(event: SimulationEvent): void {
    if (!this.primary) return;
    for (const sec of this.secondaries.values()) {
      this.scheduleReplication(this.primary, sec, event);
    }
    eventEngine.emit('dr.event_replicated', {
      eventId: event.id,
      eventType: event.type,
      sourceRegion: this.primary,
      targetRegions: [...this.secondaries.keys()],
      ts: nowTs(),
    });
  }

  /** Schedule a single replication to a secondary with simulated latency. */
  private scheduleReplication(
    source: Region,
    sec: SecondaryState,
    event: SimulationEvent,
  ): void {
    sec.replicatedCount += 1;
    sec.pendingSince = nowTs();
    const latency = this.latencyFor(source, sec.region);
    const timer = setTimeout(() => {
      sec.pendingTimers.delete(timer);
      sec.lastSyncTs = nowTs();
      sec.pendingSince = null;
      sec.ackedCount += 1;
    }, latency);
    // Don't keep Node.js alive just for replication ACKs.
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
    sec.pendingTimers.add(timer);
  }

  /** Resolve the simulated latency (ms) for a `{source}->{target}` pair. */
  private latencyFor(source: Region, target: Region): number {
    const key = `${source}->${target}`;
    const override = this.latencyOverrides.get(key);
    if (override !== undefined) return override;
    return DEFAULT_LATENCIES_MS[key] ?? FALLBACK_LATENCY_MS;
  }

  // ------------------------------------------------------------------- query

  /** Returns the current primary region (or null if none configured). */
  getPrimary(): Region | null {
    return this.primary;
  }

  /** All configured regions. */
  getRegions(): Region[] {
    return [...this.regions.keys()];
  }

  /**
   * Returns the replication lag for a single secondary region, in ms.
   * Returns 0 if the region is the primary or is not configured.
   */
  getReplicationLag(region: Region): number {
    if (region === this.primary) return 0;
    const sec = this.secondaries.get(region);
    if (!sec) return 0;
    const now = nowTs();
    // While a replication is in flight, the lag is `now - pendingSince`.
    // Otherwise it's `now - lastSyncTs`.
    const reference = sec.pendingSince ?? sec.lastSyncTs;
    return Math.max(0, now - reference);
  }

  /** Returns the full replication status for all regions. */
  getReplicationStatus(): ReplicationLag[] {
    if (!this.primary) return [];
    const out: ReplicationLag[] = [];
    for (const sec of this.secondaries.values()) {
      out.push({
        sourceRegion: this.primary,
        targetRegion: sec.region,
        lagMs: this.getReplicationLag(sec.region),
        lastSyncTs: sec.lastSyncTs,
      });
    }
    return out;
  }

  /** Internal: per-secondary counters (for DR status / dashboards). */
  getSecondaryStats(): Array<{
    region: Region;
    replicatedCount: number;
    ackedCount: number;
    pending: boolean;
    lastSyncTs: number;
  }> {
    return [...this.secondaries.values()].map((s) => ({
      region: s.region,
      replicatedCount: s.replicatedCount,
      ackedCount: s.ackedCount,
      pending: s.pendingSince !== null,
      lastSyncTs: s.lastSyncTs,
    }));
  }

  // --------------------------------------------------------------- failover

  /**
   * Promote a secondary region to primary. The old primary becomes a
   * secondary. Emits `dr.region_promoted`.
   */
  promoteRegion(region: Region): void {
    const cfg = this.regions.get(region);
    if (!cfg) {
      throw new Error(`Region ${region} is not configured`);
    }
    const previousPrimary = this.primary;
    if (previousPrimary === region) return; // already primary

    // Demote the old primary.
    if (previousPrimary) {
      const prev = this.regions.get(previousPrimary);
      if (prev) prev.isPrimary = false;
      this.ensureSecondary(previousPrimary);
    }
    // Promote the new primary.
    cfg.isPrimary = true;
    this.primary = region;
    this.secondaries.delete(region);

    eventEngine.emit('dr.region_promoted', {
      region,
      previousPrimary,
      ts: nowTs(),
    });
  }

  // --------------------------------------------------------------- attach

  /**
   * Auto-ingest every event emitted on the kernel `eventEngine`.
   * Returns a `detach` function. Idempotent — calling `attach()` twice
   * without detaching in between is a no-op.
   */
  attach(): () => void {
    if (this.detachFn) return this.detachFn;
    const off = eventEngine.on('', (evt) => {
      // Replicate every event. We exclude our own DR events to avoid
      // amplifying the replication stream — those are operational
      // telemetry, not business state.
      if (evt.type.startsWith('dr.')) return;
      try {
        this.replicate(evt);
      } catch {
        // Never let a replication error propagate into the emitter.
      }
    });
    this.detachFn = off;
    return off;
  }

  /** Detach from the kernel event bus. */
  detach(): void {
    if (this.detachFn) {
      this.detachFn();
      this.detachFn = null;
    }
  }

  /** Cancel all pending ACK timers (used in tests / shutdown). */
  shutdown(): void {
    this.detach();
    for (const sec of this.secondaries.values()) {
      for (const t of sec.pendingTimers) clearTimeout(t);
      sec.pendingTimers.clear();
      sec.pendingSince = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

declare global {
  var __PAYSWAP_DR_REPLICATION: ReplicationService | undefined;
}

/**
 * Singleton replication service. Pre-configured with the four default
 * regions: `us-east-1` (primary), `eu-west-1`, `ap-southeast-1`,
 * `af-south-1` (secondaries). Call `replicationService.attach()` to
 * start auto-ingesting kernel events.
 */
export const replicationService: ReplicationService =
  globalThis.__PAYSWAP_DR_REPLICATION ?? new ReplicationService();

if (!globalThis.__PAYSWAP_DR_REPLICATION) {
  globalThis.__PAYSWAP_DR_REPLICATION = replicationService;
  // Pre-configure the four default regions. A consumer can override
  // these by calling `configureRegion(...)` again or `promoteRegion(...)`.
  replicationService.configureRegion('us-east-1', true);
  replicationService.configureRegion('eu-west-1', false);
  replicationService.configureRegion('ap-southeast-1', false);
  replicationService.configureRegion('af-south-1', false);
}

/** Convenience: a stable id generator for callers that need one. */
export function newReplicationId(): string {
  return uid('repl');
}
