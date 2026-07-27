/**
 * Event Registry — registers event types with version history + compatibility.
 * (M-RT-27, Event Evolution.)
 *
 * Every event type has a version history:
 *
 *   wallet.created v1 → v2 → v3
 *
 * with adapters (upcasters) between them. The registry tracks:
 *   - which versions exist for each event type
 *   - which version is "current" (the latest)
 *   - upcasters that transform old versions to new ones
 *   - compatibility level (which versions are mutually compatible)
 */

// ─── Event Registration ────────────────────────────────────────────────────

/** Metadata for one version of an event type. */
export interface EventVersionInfo {
  /** The event type (e.g., "wallet.created"). */
  eventType: string;
  /** The version number (1, 2, 3, ...). */
  version: number;
  /** Schema version (bumped when the payload structure changes). */
  schemaVersion: number;
  /** Migration version (bumped when an upcaster is added). */
  migrationVersion: number;
  /** Compatibility level (events with the same level are compatible). */
  compatibilityLevel: number;
  /** When this version was introduced (epoch ms). */
  introducedAt: number;
  /** Human-readable description of what changed. */
  description: string;
}

/** An upcaster function: transforms an old event payload to a new version. */
export type Upcaster = (payload: Record<string, unknown>) => Record<string, unknown>;

/** A registered upcaster between two versions. */
export interface RegisteredUpcaster {
  eventType: string;
  fromVersion: number;
  toVersion: number;
  fn: Upcaster;
}

/**
 * EventRegistry — holds all event types + their version history + upcasters.
 *
 * Usage:
 *   registry.register('wallet.created', 1, { schemaVersion: 1, ... });
 *   registry.register('wallet.created', 2, { schemaVersion: 2, ... });
 *   registry.registerUpcaster('wallet.created', 1, 2, (p) => ({ ...p, newField: 'default' }));
 *
 *   const current = registry.getCurrentVersion('wallet.created'); // 2
 *   const upcasted = registry.upcast('wallet.created', 1, oldPayload); // v2 payload
 */
export class EventRegistry {
  private readonly versions = new Map<string, EventVersionInfo[]>();
  private readonly upcasters = new Map<string, RegisteredUpcaster[]>();

  /**
   * Register a version of an event type.
   * Throws if the version is already registered.
   */
  register(
    eventType: string,
    version: number,
    info: {
      schemaVersion?: number;
      migrationVersion?: number;
      compatibilityLevel?: number;
      description?: string;
    } = {},
  ): void {
    const existing = this.versions.get(eventType) ?? [];
    if (existing.some((v) => v.version === version)) {
      throw new Error(`Event ${eventType} v${version} already registered`);
    }
    existing.push({
      eventType,
      version,
      schemaVersion: info.schemaVersion ?? version,
      migrationVersion: info.migrationVersion ?? 0,
      compatibilityLevel: info.compatibilityLevel ?? 1,
      introducedAt: Date.now(),
      description: info.description ?? `Version ${version}`,
    });
    existing.sort((a, b) => a.version - b.version);
    this.versions.set(eventType, existing);
  }

  /**
   * Register an upcaster that transforms an event from one version to another.
   */
  registerUpcaster(
    eventType: string,
    fromVersion: number,
    toVersion: number,
    fn: Upcaster,
  ): void {
    const existing = this.upcasters.get(eventType) ?? [];
    existing.push({ eventType, fromVersion, toVersion, fn });
    this.upcasters.set(eventType, existing);
  }

  /** Get the current (latest) version of an event type. Returns 0 if unregistered. */
  getCurrentVersion(eventType: string): number {
    const versions = this.versions.get(eventType);
    if (!versions || versions.length === 0) return 0;
    return versions[versions.length - 1].version;
  }

  /** Get all registered versions of an event type. */
  getVersions(eventType: string): EventVersionInfo[] {
    return this.versions.get(eventType) ?? [];
  }

  /** Get all registered event types. */
  getEventTypes(): string[] {
    return [...this.versions.keys()].sort();
  }

  /** Get all registered upcasters for an event type. */
  getUpcasters(eventType: string): RegisteredUpcaster[] {
    return this.upcasters.get(eventType) ?? [];
  }

  /**
   * Upcast an event payload from a given version to the current version.
   *
   * Applies all upcasters in sequence: v1 → v2 → v3 → ... → current.
   * If no upcasters are needed (version is already current), returns the payload unchanged.
   * If the event type is unregistered, returns the payload unchanged (backward compat).
   */
  upcast(eventType: string, fromVersion: number, payload: Record<string, unknown>): {
    payload: Record<string, unknown>;
    toVersion: number;
    upcastersApplied: number;
  } {
    const currentVersion = this.getCurrentVersion(eventType);
    if (currentVersion === 0 || fromVersion >= currentVersion) {
      return { payload, toVersion: fromVersion, upcastersApplied: 0 };
    }

    const upcasters = this.upcasters.get(eventType) ?? [];
    let currentPayload = payload;
    let currentVer = fromVersion;
    let applied = 0;

    // Apply upcasters in order (v1→v2, v2→v3, etc.).
    while (currentVer < currentVersion) {
      const upcaster = upcasters.find((u) => u.fromVersion === currentVer);
      if (!upcaster) {
        // No upcaster for this step — stop (can't upgrade further).
        break;
      }
      currentPayload = upcaster.fn(currentPayload);
      currentVer = upcaster.toVersion;
      applied++;
    }

    return { payload: currentPayload, toVersion: currentVer, upcastersApplied: applied };
  }

  /** Check if an event type is registered. */
  isRegistered(eventType: string): boolean {
    return this.versions.has(eventType);
  }

  /** Total registered event types. */
  count(): number {
    return this.versions.size;
  }

  /** Total registered upcasters. */
  upcasterCount(): number {
    let count = 0;
    for (const upcasters of this.upcasters.values()) count += upcasters.length;
    return count;
  }
}
