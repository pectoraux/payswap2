/**
 * Event Upcaster — the versioned replay pipeline. (M-RT-27.)
 *
 * During replay, events are upgraded to their current version BEFORE
 * projections see them:
 *
 *   Raw Event (v1) → Upcaster → Current Event (v3) → Projection → Read Model
 *
 * This keeps projections simple: they always handle the current version.
 *
 * The upcaster also attaches evolution metadata to events:
 *   eventVersion, schemaVersion, migrationVersion, compatibilityLevel
 */

import type { StoredEvent } from '../events';
import type { EventRegistry } from './event-registry';

/** An event with evolution metadata attached. */
export interface VersionedEvent extends StoredEvent {
  /** The event's version (from the registry). */
  eventVersion: number;
  /** The schema version (from the registry). */
  schemaVersion: number;
  /** The migration version (from the registry). */
  migrationVersion: number;
  /** The compatibility level (from the registry). */
  compatibilityLevel: number;
  /** Whether this event was upcasted from an older version. */
  wasUpcasted: boolean;
  /** The original version (before upcasting). */
  originalVersion?: number;
  /** Number of upcasters applied. */
  upcastersApplied: number;
}

/** Result of upcasting a batch of events. */
export interface UpcastResult {
  /** The upcasted events. */
  events: VersionedEvent[];
  /** Number of events that were upcasted. */
  upcastedCount: number;
  /** Number of events that were already current. */
  currentCount: number;
  /** Number of events for unregistered types (passed through unchanged). */
  unregisteredCount: number;
}

/**
 * EventUpcaster — applies upcasters to events during replay.
 *
 * Pure: same events + registry → same upcasted events.
 */
export class EventUpcaster {
  constructor(private registry: EventRegistry) {}

  /**
   * Upcast a batch of events to their current versions.
   *
   * For each event:
   *   1. Look up the event type in the registry
   *   2. If registered, upcast the payload to the current version
   *   3. Attach evolution metadata (eventVersion, schemaVersion, etc.)
   *   4. Return the versioned event
   *
   * Events for unregistered types are passed through unchanged (backward compat).
   */
  upcast(events: StoredEvent[]): UpcastResult {
    let upcastedCount = 0;
    let currentCount = 0;
    let unregisteredCount = 0;

    const versionedEvents: VersionedEvent[] = events.map((event) => {
      const eventType = event.type;
      const isRegistered = this.registry.isRegistered(eventType);

      if (!isRegistered) {
        // Unregistered event type — pass through unchanged.
        unregisteredCount++;
        return {
          ...event,
          eventVersion: 1, // default
          schemaVersion: 1,
          migrationVersion: 0,
          compatibilityLevel: 1,
          wasUpcasted: false,
          upcastersApplied: 0,
        };
      }

      // Determine the event's version.
      // For M-RT-27, all existing events are v1 (no version field on the event yet).
      // Future events will carry an explicit eventVersion in their payload or metadata.
      const fromVersion = (event.payload as Record<string, unknown>).eventVersion as number ?? 1;
      const currentVersion = this.registry.getCurrentVersion(eventType);

      if (fromVersion >= currentVersion) {
        // Already current — no upcasting needed.
        currentCount++;
        const versions = this.registry.getVersions(eventType);
        const info = versions.find((v) => v.version === fromVersion) ?? versions[versions.length - 1];
        return {
          ...event,
          eventVersion: fromVersion,
          schemaVersion: info?.schemaVersion ?? fromVersion,
          migrationVersion: info?.migrationVersion ?? 0,
          compatibilityLevel: info?.compatibilityLevel ?? 1,
          wasUpcasted: false,
          upcastersApplied: 0,
        };
      }

      // Upcast the payload.
      const { payload, toVersion, upcastersApplied } = this.registry.upcast(eventType, fromVersion, event.payload);
      const versions = this.registry.getVersions(eventType);
      const info = versions.find((v) => v.version === toVersion) ?? versions[versions.length - 1];

      upcastedCount += upcastersApplied > 0 ? 1 : 0;
      currentCount += upcastersApplied === 0 ? 1 : 0;

      return {
        ...event,
        payload,
        eventVersion: toVersion,
        schemaVersion: info?.schemaVersion ?? toVersion,
        migrationVersion: info?.migrationVersion ?? 0,
        compatibilityLevel: info?.compatibilityLevel ?? 1,
        wasUpcasted: upcastersApplied > 0,
        originalVersion: fromVersion,
        upcastersApplied,
      };
    });

    return {
      events: versionedEvents,
      upcastedCount,
      currentCount,
      unregisteredCount,
    };
  }

  /**
   * Upcast a single event. Convenience method.
   */
  upcastOne(event: StoredEvent): VersionedEvent {
    return this.upcast([event]).events[0];
  }
}
