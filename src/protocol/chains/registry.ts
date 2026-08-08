/**
 * PaySwap Protocol — Chain Registry.
 *
 * Central registry of all `ChainAdapter` instances. The protocol layer looks
 * up chains by name via `chainRegistry.get('stellar')`. Auto-registration of
 * the default Stellar adapter happens on import of `./index.ts`.
 *
 * Supports:
 *   - register(adapter)            — register a chain adapter
 *   - get(chain)                   — look up by chain id
 *   - all()                        — list all registered adapters
 *   - default()                    — the configured default chain (Stellar)
 *   - healthReport()               — health snapshot of every chain
 *   - setMode(mode)                — broadcast a mode switch (sim ↔ live)
 *
 * Mode switching is the killer feature: `chainRegistry.setMode('live')`
 * flips every registered adapter from simulation to live in one call. This
 * lets us develop/test in simulation and flip to production without code
 * changes.
 */
import type { ChainAdapter, ChainMode, ChainHealthResult } from './adapter';

export const STELLAR_CHAIN = 'stellar';
export const ETHEREUM_CHAIN = 'ethereum';
export const BASE_CHAIN = 'base';
export const POLYGON_CHAIN = 'polygon';

export class ChainRegistry {
  private adapters = new Map<string, ChainAdapter>();
  private defaultChain: string = STELLAR_CHAIN;

  /** Register a chain adapter. Re-registrations replace the previous instance. */
  register(adapter: ChainAdapter): ChainAdapter {
    this.adapters.set(adapter.chain, adapter);
    if (!this.adapters.has(this.defaultChain)) {
      this.defaultChain = adapter.chain;
    }
    return adapter;
  }

  /** Look up an adapter by chain id. */
  get(chain: string): ChainAdapter | undefined {
    return this.adapters.get(chain);
  }

  /** Get an adapter or throw a structured error (avoids `undefined` checks downstream). */
  require(chain: string): ChainAdapter {
    const a = this.adapters.get(chain);
    if (!a) {
      throw new Error(`chain_registry: adapter not registered for chain '${chain}'`);
    }
    return a;
  }

  /** All registered adapters. */
  all(): ChainAdapter[] {
    return [...this.adapters.values()];
  }

  /** List all registered chain ids. */
  chains(): string[] {
    return [...this.adapters.keys()];
  }

  /** The configured default chain (used by settlement helpers when caller
   *  doesn't specify a chain explicitly). */
  default(): ChainAdapter | undefined {
    return this.adapters.get(this.defaultChain);
  }

  /** Override the default chain. */
  setDefault(chain: string): void {
    if (!this.adapters.has(chain)) {
      throw new Error(`chain_registry: cannot set default to unknown chain '${chain}'`);
    }
    this.defaultChain = chain;
  }

  /** Broadcast a mode switch (simulation ↔ live) to every registered adapter. */
  async setMode(mode: ChainMode): Promise<{ [chain: string]: { success: boolean; error?: string } }> {
    const out: { [chain: string]: { success: boolean; error?: string } } = {};
    for (const adapter of this.adapters.values()) {
      try {
        const res = await adapter.setMode(mode);
        out[adapter.chain] = { success: res.success, error: res.error };
      } catch (err) {
        out[adapter.chain] = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return out;
  }

  /** Snapshot health of every registered adapter. */
  async healthReport(): Promise<ChainHealthResult[]> {
    const reports: ChainHealthResult[] = [];
    for (const adapter of this.adapters.values()) {
      try {
        reports.push(await adapter.healthCheck());
      } catch (err) {
        reports.push({
          chain: adapter.chain,
          healthy: false,
          mode: adapter.mode,
          latencyMs: 0,
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    return reports;
  }

  /** True if any adapter is registered for this chain. */
  has(chain: string): boolean {
    return this.adapters.has(chain);
  }

  /** Alias for `has`. */
  isRegistered(chain: string): boolean {
    return this.adapters.has(chain);
  }

  /** Reset the registry — clears all adapters + restores default to stellar. Test helper. */
  reset(): void {
    this.adapters.clear();
    this.defaultChain = STELLAR_CHAIN;
  }
}

/** Singleton registry instance. */
export const chainRegistry = new ChainRegistry();
