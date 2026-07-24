/**
 * PaySwap Protocol — Resilience / Outage Detection + Response.
 * -----------------------------------------------------------------------------
 * The OutageManager records outages (manual or auto-detected from circuit
 * breaker state) and produces a FALLBACK STRATEGY for each outage type.
 *
 * Outage classification:
 *
 *   connector — a production connector (open_banking, mpesa, …) is unavailable
 *   bank      — a downstream bank is offline (usually surfaced via open_banking)
 *   stellar   — the Stellar network / Horizon is unavailable
 *   db        — the primary database is unavailable
 *   redis     — the cache / pub-sub layer is unavailable
 *   region    — an entire region is unreachable (multi-region concern)
 *
 * Severity:
 *
 *   partial — degraded but functional (e.g. some operations still succeed)
 *   full    — completely unavailable
 *
 * The fallback strategy is a STRING (human-readable) describing what the
 * protocol SHOULD do when an outage of this type is active. It is NOT executed
 * automatically — the protocol layer (payout-service, transaction-engine,
 * settlement-orchestrator) reads `outageManager.fallbackFor(type)` and adapts.
 *
 * Emits `resilience.outage_declared` and `resilience.outage_resolved` events.
 */
import { eventEngine } from '@/kernel/event';
import { uid } from '@/kernel/support';
import { circuitBreakerRegistry } from './circuit-breaker';

/** Coarse outage classification. */
export type OutageType = 'connector' | 'bank' | 'stellar' | 'db' | 'redis' | 'region';

/** Severity: partial = degraded, full = completely down. */
export type OutageSeverity = 'partial' | 'full';

/** Outage lifecycle: active = ongoing, resolved = ended. */
export type OutageStatus = 'active' | 'resolved';

/** A recorded outage event. */
export interface Outage {
  id: string;
  type: OutageType;
  /** Scope — e.g. connector name ('mpesa'), bank id, region name. */
  scope: string;
  startedAt: number;
  endedAt?: number;
  severity: OutageSeverity;
  /** Operations affected (e.g. ['payout.bank', 'payout.mobile_money']). */
  affectedOperations: string[];
  /** Human-readable fallback strategy. */
  fallbackStrategy: string;
  status: OutageStatus;
}

/**
 * Map an outage type to a fallback strategy description. The strategy is a
 * declarative statement of intent — the protocol layer decides how to honour it.
 *
 *   connector → "Use cached evidence + queue payments for retry. Do not fail
 *                immediately — fall back to last-known-good state and queue."
 *   bank      → "Switch to alternate connector OR manual settlement. Mark
 *                affected payouts as manual_review."
 *   stellar   → "Queue settlements. Use claimable balances for async settlement.
 *                Replay queued settlements when the network recovers."
 *   db        → "Degrade to event-sourced in-memory mode (rebuild from event
 *                stream). Alert ops. Accept writes through the event log only."
 *   redis     → "Bypass cache; read directly from the source of truth. Disable
 *                rate-limit-soft-fail (force-allow) to keep serving traffic."
 *   region    → "Failover to alternate region (assessed, not executed). DNS
 *                failover + cross-region replication catch-up required."
 */
export function fallbackStrategyFor(type: OutageType): string {
  switch (type) {
    case 'connector':
      return 'Use cached evidence + queue payments for retry. Do not fail immediately — fall back to last-known-good state and queue.';
    case 'bank':
      return 'Switch to alternate connector OR manual settlement. Mark affected payouts as manual_review.';
    case 'stellar':
      return 'Queue settlements. Use claimable balances for async settlement. Replay queued settlements when the network recovers.';
    case 'db':
      return 'Degrade to event-sourced in-memory mode (rebuild from event stream). Alert ops. Accept writes through the event log only.';
    case 'redis':
      return 'Bypass cache; read directly from the source of truth. Disable rate-limit-soft-fail (force-allow) to keep serving traffic.';
    case 'region':
      return 'Failover to alternate region (assessed, not executed). DNS failover + cross-region replication catch-up required.';
    default:
      return 'No fallback strategy defined.';
  }
}

/** Operations affected by each outage type (used as a default). */
export function defaultAffectedOperations(type: OutageType): string[] {
  switch (type) {
    case 'connector':
      return ['payment.create', 'payout.request', 'connector.query'];
    case 'bank':
      return ['payout.bank', 'settlement.bank'];
    case 'stellar':
      return ['settlement.stellar', 'twintoken.mint', 'twintoken.burn', 'twintoken.transfer'];
    case 'db':
      return ['all.stateful.writes'];
    case 'redis':
      return ['cache.read', 'cache.write', 'rate_limit.check'];
    case 'region':
      return ['all.traffic'];
    default:
      return [];
  }
}

/** Map a connector-name breaker to an OutageType. */
function breakerNameToOutageType(name: string): { type: OutageType; scope: string } | null {
  switch (name) {
    case 'open_banking':
      return { type: 'bank', scope: 'open_banking' };
    case 'mpesa':
      return { type: 'connector', scope: 'mpesa' };
    case 'ethereum_rpc':
      return { type: 'connector', scope: 'ethereum_rpc' };
    case 'fx_rate':
      return { type: 'connector', scope: 'fx_rate' };
    case 'stellar_horizon':
      return { type: 'stellar', scope: 'stellar_horizon' };
    case 'stellar_settlement':
      return { type: 'stellar', scope: 'settlement' };
    case 'db':
      return { type: 'db', scope: 'primary' };
    default:
      return null;
  }
}

/**
 * Outage manager. Records outages, detects them from circuit breaker state,
 * and resolves them. Singleton `outageManager` is exported below.
 */
export class OutageManager {
  private outages: Map<string, Outage> = new Map();
  /** Tracks which breaker names have already been declared as outages. */
  private declaredFromBreaker: Set<string> = new Set();

  /**
   * Manually declare an outage. Returns the recorded Outage object.
   *
   * If an active outage with the same (type, scope) already exists, it is
   * returned unchanged (declare is idempotent).
   */
  declare(
    type: OutageType,
    scope: string,
    severity: OutageSeverity,
    extra?: { affectedOperations?: string[]; fallbackStrategy?: string },
  ): Outage {
    // Idempotent: if there's already an active outage for (type, scope),
    // return it.
    const existing = this.findActive(type, scope);
    if (existing) return existing;

    const outage: Outage = {
      id: uid('outage'),
      type,
      scope,
      startedAt: Date.now(),
      severity,
      affectedOperations: extra?.affectedOperations ?? defaultAffectedOperations(type),
      fallbackStrategy: extra?.fallbackStrategy ?? fallbackStrategyFor(type),
      status: 'active',
    };
    this.outages.set(outage.id, outage);
    try {
      eventEngine.emit(
        'resilience.outage_declared',
        {
          outageId: outage.id,
          type: outage.type,
          scope: outage.scope,
          severity: outage.severity,
          affectedOperations: outage.affectedOperations,
          fallbackStrategy: outage.fallbackStrategy,
          ts: outage.startedAt,
        },
        0,
      );
    } catch {
      // Best-effort.
    }
    return outage;
  }

  /**
   * Auto-detect outages from circuit breaker states. For each breaker that is
   * currently `open`, declares an outage of the corresponding type/scope if
   * not already declared. Returns the list of newly-declared outages.
   */
  detect(): Outage[] {
    const newlyDeclared: Outage[] = [];
    for (const breaker of circuitBreakerRegistry.all()) {
      const name = breaker.metrics().name;
      const isOpen = breaker.getState() === 'open';
      const mapping = breakerNameToOutageType(name);
      if (!mapping) continue;
      if (isOpen) {
        if (!this.declaredFromBreaker.has(name)) {
          const outage = this.declare(
            mapping.type,
            mapping.scope,
            'full',
          );
          outage.affectedOperations = [
            ...new Set([
              ...outage.affectedOperations,
              `breaker.${name}`,
            ]),
          ];
          this.declaredFromBreaker.add(name);
          newlyDeclared.push(outage);
        }
      } else {
        // Breaker is closed or half-open — auto-resolve any outage that was
        // declared from this breaker.
        if (this.declaredFromBreaker.has(name)) {
          const existing = this.findActive(mapping.type, mapping.scope);
          if (existing) {
            this.resolve(existing.id);
          }
          this.declaredFromBreaker.delete(name);
        }
      }
    }
    return newlyDeclared;
  }

  /** Resolve an outage by id. */
  resolve(outageId: string): Outage | undefined {
    const outage = this.outages.get(outageId);
    if (!outage) return undefined;
    if (outage.status === 'resolved') return outage;
    outage.status = 'resolved';
    outage.endedAt = Date.now();
    try {
      eventEngine.emit(
        'resilience.outage_resolved',
        {
          outageId: outage.id,
          type: outage.type,
          scope: outage.scope,
          startedAt: outage.startedAt,
          endedAt: outage.endedAt,
          durationMs: outage.endedAt - outage.startedAt,
        },
        0,
      );
    } catch {
      // Best-effort.
    }
    return outage;
  }

  /** Active outages (optionally filtered by type). */
  active(type?: OutageType): Outage[] {
    const list = [...this.outages.values()].filter((o) => o.status === 'active');
    if (type) return list.filter((o) => o.type === type);
    return list;
  }

  /** All outages (active + resolved), newest-first. */
  all(): Outage[] {
    return [...this.outages.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Get a specific outage by id. */
  get(outageId: string): Outage | undefined {
    return this.outages.get(outageId);
  }

  /**
   * Returns the fallback strategy for an outage type. If multiple active
   * outages of the same type exist, their strategies are concatenated
   * (de-duplicated). If no active outage of this type exists, returns the
   * default strategy for the type (which is still useful for capacity
   * planning / pre-positioning).
   */
  fallbackFor(type: OutageType): string {
    const active = this.active(type);
    if (active.length === 0) return fallbackStrategyFor(type);
    const strategies = new Set<string>();
    for (const o of active) strategies.add(o.fallbackStrategy);
    return [...strategies].join(' | ');
  }

  /** Find an active outage matching (type, scope). */
  findActive(type: OutageType, scope: string): Outage | undefined {
    return this.outages.values().find(
      (o) => o.status === 'active' && o.type === type && o.scope === scope,
    );
  }

  /** Clear all outages (mainly for tests). */
  reset(): void {
    this.outages.clear();
    this.declaredFromBreaker.clear();
  }
}

/** Singleton outage manager. */
export const outageManager = new OutageManager();
