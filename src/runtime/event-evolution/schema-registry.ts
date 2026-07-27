/**
 * Schema Registry — the top-level compatibility layer. (M-RT-27.)
 *
 *   Runtime → Schema Registry → Event Registry → Projection Registry → Migration Registry
 *
 * The SchemaRegistry is the single place the runtime queries to understand:
 *   - what event types exist + their versions
 *   - what upcasters are available
 *   - what versions each projection supports
 *   - whether a replay is safe (all events can be upcasted to supported versions)
 */

import { EventRegistry, type EventVersionInfo } from './event-registry';
import { EventUpcaster, type UpcastResult } from './upcaster';
import type { StoredEvent } from '../events';

/** A projection's compatibility declaration. */
export interface ProjectionCompatibility {
  /** Projection name. */
  projection: string;
  /** Event types this projection handles, with minimum supported version. */
  supports: Map<string, number>; // eventType → minVersion
}

/** Schema registry report (for /api/runtime/schema). */
export interface SchemaReport {
  totalEventTypes: number;
  totalUpcasters: number;
  totalProjections: number;
  eventTypes: {
    eventType: string;
    currentVersion: number;
    versions: EventVersionInfo[];
    upcasterCount: number;
  }[];
  projections: {
    projection: string;
    supportedEvents: { eventType: string; minVersion: number }[];
  }[];
}

/**
 * SchemaRegistry — the compatibility layer.
 *
 * Holds:
 *   - EventRegistry: event types + versions + upcasters
 *   - ProjectionCompatibility: which versions each projection supports
 *   - EventUpcaster: the upcasting pipeline
 */
export class SchemaRegistry {
  readonly events: EventRegistry;
  readonly upcaster: EventUpcaster;
  private readonly projectionCompat = new Map<string, ProjectionCompatibility>();

  constructor() {
    this.events = new EventRegistry();
    this.upcaster = new EventUpcaster(this.events);
  }

  /**
   * Register an event type version.
   */
  registerEvent(
    eventType: string,
    version: number,
    info?: { schemaVersion?: number; migrationVersion?: number; compatibilityLevel?: number; description?: string },
  ): void {
    this.events.register(eventType, version, info);
  }

  /**
   * Register an upcaster between two versions.
   */
  registerUpcaster(eventType: string, fromVersion: number, toVersion: number, fn: (payload: Record<string, unknown>) => Record<string, unknown>): void {
    this.events.registerUpcaster(eventType, fromVersion, toVersion, fn);
  }

  /**
   * Register a projection's compatibility (which event versions it supports).
   */
  registerProjection(projection: string, supports: Record<string, number>): void {
    const supportMap = new Map<string, number>();
    for (const [eventType, minVersion] of Object.entries(supports)) {
      supportMap.set(eventType, minVersion);
    }
    this.projectionCompat.set(projection, { projection, supports: supportMap });
  }

  /**
   * Upcast events to their current versions (applies the versioned replay pipeline).
   *
   *   Raw Event → Upcaster → Current Event → Projection → Read Model
   */
  upcast(events: StoredEvent[]): UpcastResult {
    return this.upcaster.upcast(events);
  }

  /**
   * Check if a replay is safe: all events can be upcasted to versions that
   * all projections support.
   *
   * Returns { safe, issues[] }.
   */
  checkReplaySafety(events: StoredEvent[]): { safe: boolean; issues: string[] } {
    const issues: string[] = [];
    const upcastResult = this.upcast(events);

    for (const event of upcastResult.events) {
      // Check each projection that handles this event type.
      for (const [projName, compat] of this.projectionCompat) {
        const minVersion = compat.supports.get(event.type);
        if (minVersion === undefined) continue; // projection doesn't handle this type

        if (event.eventVersion < minVersion) {
          issues.push(
            `Projection "${projName}" requires ${event.type} v${minVersion}+, but event is v${event.eventVersion} (upcasted from v${event.originalVersion ?? event.eventVersion})`,
          );
        }
      }
    }

    return { safe: issues.length === 0, issues };
  }

  /** Get a full schema report (for /api/runtime/schema). */
  getReport(): SchemaReport {
    const eventTypes = this.events.getEventTypes().map((eventType) => ({
      eventType,
      currentVersion: this.events.getCurrentVersion(eventType),
      versions: this.events.getVersions(eventType),
      upcasterCount: this.events.getUpcasters(eventType).length,
    }));

    const projections = [...this.projectionCompat.values()].map((compat) => ({
      projection: compat.projection,
      supportedEvents: [...compat.supports.entries()].map(([eventType, minVersion]) => ({ eventType, minVersion })),
    }));

    return {
      totalEventTypes: this.events.count(),
      totalUpcasters: this.events.upcasterCount(),
      totalProjections: this.projectionCompat.size,
      eventTypes,
      projections,
    };
  }
}

/**
 * Register all existing event types (v1) in the schema registry.
 * Called at runtime creation.
 */
export function registerAllEventTypes(registry: SchemaRegistry): void {
  // Payment events (v1).
  for (const type of ['payment.recorded', 'payment.completed', 'payment.failed', 'payment.refunded']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // Refund events (v1).
  for (const type of ['refund.requested', 'refund.approved', 'refund.rejected', 'refund.executed', 'refund.failed']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // Wallet events (v1).
  for (const type of ['wallet.created', 'wallet.credited', 'wallet.debited', 'wallet.reserved', 'wallet.released', 'wallet.closed']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // Treasury events (v1).
  for (const type of ['treasury.account.created', 'treasury.account.credited', 'treasury.account.debited', 'treasury.position.opened', 'treasury.position.closed', 'treasury.transfer.requested', 'treasury.transfer.executed', 'treasury.reconciliation.run']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // Twin token events (v1).
  for (const type of ['twin.minted', 'twin.burned', 'twin.transferred', 'twin.converted', 'twin.backed', 'twin.unbacked']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // LP events (v1).
  for (const type of ['lp.registered', 'lp.corridor.added', 'lp.corridor.updated', 'lp.scored', 'lp.offer.published', 'lp.offer.withdrawn']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // Reserve events (v1).
  for (const type of ['reserve.created', 'reserve.funded', 'reserve.locked', 'reserve.unlocked', 'reserve.consumed', 'reserve.released', 'reserve.adjusted']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // Settlement events (v1).
  for (const type of ['settlement.executed']) {
    registry.registerEvent(type, 1, { description: 'Initial version' });
  }

  // M-RT-30: Liquidity Intelligence events (v1).
  for (const type of [
    'bandwidth.registered', 'bandwidth.locked', 'bandwidth.released', 'bandwidth.escrowed', 'bandwidth.slashed',
    'settlement.contract.created', 'settlement.contract.funded', 'settlement.contract.claimed',
    'settlement.contract.confirmed', 'settlement.contract.released', 'settlement.contract.closed',
    'settlement.contract.expired',
    'settlement.disputed', 'dispute.evidence_submitted', 'dispute.status_changed', 'dispute.resolved',
  ]) {
    registry.registerEvent(type, 1, { description: 'Initial version (M-RT-30)' });
  }

  // Register projection compatibility (all projections support v1+ of their events).
  registry.registerProjection('payments', {
    'payment.recorded': 1, 'payment.completed': 1, 'payment.failed': 1, 'payment.refunded': 1,
  });
  registry.registerProjection('refunds', {
    'refund.requested': 1, 'refund.approved': 1, 'refund.rejected': 1, 'refund.executed': 1, 'refund.failed': 1,
  });
  registry.registerProjection('wallets', {
    'wallet.created': 1, 'wallet.credited': 1, 'wallet.debited': 1, 'wallet.reserved': 1, 'wallet.released': 1, 'wallet.closed': 1,
  });
  registry.registerProjection('treasury', {
    'treasury.account.created': 1, 'treasury.account.credited': 1, 'treasury.account.debited': 1,
    'treasury.position.opened': 1, 'treasury.position.closed': 1,
    'treasury.transfer.requested': 1, 'treasury.transfer.executed': 1, 'treasury.reconciliation.run': 1,
  });
  // M-RT-30: Register liquidity projection compatibility.
  registry.registerProjection('bandwidth', {
    'bandwidth.registered': 1, 'bandwidth.locked': 1, 'bandwidth.released': 1, 'bandwidth.escrowed': 1, 'bandwidth.slashed': 1,
  });
  registry.registerProjection('settlementContracts', {
    'settlement.contract.created': 1, 'settlement.contract.funded': 1, 'settlement.contract.claimed': 1,
    'settlement.contract.confirmed': 1, 'settlement.contract.released': 1, 'settlement.contract.closed': 1,
    'settlement.contract.expired': 1,
  });
  registry.registerProjection('disputes', {
    'settlement.disputed': 1, 'dispute.evidence_submitted': 1, 'dispute.status_changed': 1, 'dispute.resolved': 1,
  });
}
