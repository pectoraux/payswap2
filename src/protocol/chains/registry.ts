/**
 * PaySwap Protocol — Chain Registry.
 *
 * Single source of truth for chain adapters. The protocol layer queries the
 * registry; the registry delegates to the appropriate adapter.
 *
 * Idempotent: re-registering the same chain replaces the existing adapter
 * (useful in tests). Default chain is Stellar.
 *
 * Health: maintains a per-chain health cache, refreshed on `healthReport()`.
 */
import type { ChainAdapter, HealthResult } from './adapter';

class ChainRegistry {
  private adapters: Map<string, ChainAdapter> = new Map();
  private registrationOrder: string[] = [];
  private healthCache: Map<string, HealthResult> = new Map();
  private defaultChain = 'stellar';

  /** Idempotent registration. Re-registering replaces. */
  register(adapter: ChainAdapter): void {
    const chain = adapter.chain;
    if (!this.adapters.has(chain)) {
      this.registrationOrder.push(chain);
    }
    this.adapters.set(chain, adapter);
  }

  /** Unregister a chain (rarely used outside of tests). */
  unregister(chain: string): boolean {
    const had = this.adapters.delete(chain);
    if (had) {
      this.registrationOrder = this.registrationOrder.filter((c) => c !== chain);
      this.healthCache.delete(chain);
    }
    return had;
  }

  /** Get an adapter by chain id. */
  get(chain: string): ChainAdapter | undefined {
    return this.adapters.get(chain);
  }

  /** Get an adapter or throw a descriptive error. */
  require(chain: string): ChainAdapter {
    const a = this.adapters.get(chain);
    if (!a) throw new Error(`Chain adapter not registered: ${chain}`);
    return a;
  }

  /** All registered adapters (registration order). */
  all(): ChainAdapter[] {
    return this.registrationOrder.map((c) => this.adapters.get(c)!).filter(Boolean);
  }

  /** Chain identifiers in registration order. */
  chains(): string[] {
    return [...this.registrationOrder];
  }

  /** Is a chain registered? */
  isRegistered(chain: string): boolean {
    return this.adapters.has(chain);
  }

  /** Default adapter — Stellar by convention. */
  default(): ChainAdapter | undefined {
    return (
      this.adapters.get(this.defaultChain) ??
      this.adapters.get(this.registrationOrder[0] ?? '')
    );
  }

  /** Set the default chain (must already be registered). */
  setDefault(chain: string): void {
    if (!this.adapters.has(chain)) {
      throw new Error(`Cannot set default to unregistered chain: ${chain}`);
    }
    this.defaultChain = chain;
  }

  /** Per-chain health report — refreshes cache. */
  async healthReport(): Promise<Record<string, HealthResult>> {
    const entries = await Promise.all(
      this.all().map(async (a) => {
        const h = await a.healthCheck();
        this.healthCache.set(a.chain, h);
        return [a.chain, h] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  /** Cached health (does not re-query). */
  cachedHealth(chain: string): HealthResult | undefined {
    return this.healthCache.get(chain);
  }

  /** Reset — for tests. */
  reset(): void {
    this.adapters.clear();
    this.registrationOrder = [];
    this.healthCache.clear();
    this.defaultChain = 'stellar';
  }
}

export const chainRegistry = new ChainRegistry();
