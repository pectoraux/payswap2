/**
 * ProjectionHealthRegistry — collects health metrics from every migrated
 * projection. (M-RT-19, Capability Migration Framework.)
 *
 * Each migrated capability registers a health provider (a function that
 * returns ProjectionHealth). The registry aggregates them for the
 * `/api/runtime/projections` endpoint (the ops dashboard view).
 *
 * USAGE:
 *   // At runtime construction:
 *   runtime.health.register('payments', () => paymentsService.health());
 *   runtime.health.register('refunds', () => refundsService.health());
 *
 *   // From the API:
 *   const all = runtime.health.all();  // [PaymentHealth, RefundHealth, ...]
 *   const one = runtime.health.get('refunds');  // RefundHealth
 */

import type { ProjectionHealth } from './types';

/** A function that returns the current health of one projection. */
export type HealthProvider = () => Promise<ProjectionHealth> | ProjectionHealth;

/**
 * ProjectionHealthRegistry — holds health providers for every migrated
 * projection. Insertion order is preserved (the order capabilities were
 * migrated in).
 */
export class ProjectionHealthRegistry {
  private readonly providers = new Map<string, HealthProvider>();
  private readonly order: string[] = [];

  /** Register a health provider for a projection. Overwrites if already registered. */
  register(name: string, provider: HealthProvider): void {
    if (!this.providers.has(name)) {
      this.order.push(name);
    }
    this.providers.set(name, provider);
  }

  /** Get the health of one projection (or null if not registered). */
  async get(name: string): Promise<ProjectionHealth | null> {
    const provider = this.providers.get(name);
    if (!provider) return null;
    return provider();
  }

  /** Get the health of every registered projection. */
  async all(): Promise<ProjectionHealth[]> {
    const results: ProjectionHealth[] = [];
    for (const name of this.order) {
      const provider = this.providers.get(name);
      if (provider) {
        try {
          results.push(await provider());
        } catch (err) {
          // A failing provider shouldn't break the whole list.
          results.push({
            projection: name,
            version: 0,
            eventsApplied: 0,
            rows: 0,
            lag: 0,
            healthy: false,
            lastReplayMs: null,
            checkpoint: -1,
            message: `health check failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
    return results;
  }

  /** List of registered projection names. */
  names(): string[] {
    return [...this.order];
  }
}
