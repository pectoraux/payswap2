/**
 * Settlement Adapter Layer — pluggable blockchain settlement.
 * (M-RT-26, Phase 9.)
 *
 * Treasury owns settlement. Blockchain adapters are pluggable:
 *
 *   SettlementRequest → Treasury → SettlementAdapter → Blockchain → TransactionHash
 *
 *   SettlementAdapter
 *     ├── StellarAdapter
 *     ├── EthereumAdapter
 *     ├── PolygonAdapter
 *     ├── SolanaAdapter
 *     └── CBDCAdapter (future)
 *
 * The adapter performs settlement on external networks. The runtime never
 * talks to blockchains directly — only through adapters.
 */

// ─── Settlement Adapter Interface ──────────────────────────────────────────

/** A request to settle on an external network. */
export interface SettlementRequest {
  /** The network to settle on. */
  network: SettlementNetwork;
  /** The asset to settle (e.g., USDC, native). */
  asset: string;
  /** Source account (on the external network). */
  source: string;
  /** Destination account (on the external network). */
  destination: string;
  /** Amount to settle. */
  amount: number;
  /** Memo / reference. */
  memo?: string;
}

/** Supported settlement networks. */
export type SettlementNetwork = 'stellar' | 'ethereum' | 'polygon' | 'solana' | 'lightning' | 'cbdc';

/** The result of a settlement. */
export interface SettlementResult {
  /** Whether the settlement succeeded. */
  success: boolean;
  /** The transaction hash on the external network. */
  txHash: string | null;
  /** The network settled on. */
  network: SettlementNetwork;
  /** Settlement timestamp (epoch ms). */
  settledAt: number;
  /** Error message (if failed). */
  error?: string;
  /** Estimated confirmation time (ms). */
  estimatedConfirmationMs: number;
}

/**
 * SettlementAdapter — the interface every blockchain adapter implements.
 *
 * Adapters are STATELESS: they only translate between runtime settlement
 * requests and external network calls. The runtime (Treasury) owns all state.
 */
export interface SettlementAdapter {
  /** The network this adapter handles. */
  readonly network: SettlementNetwork;
  /** Human-readable name. */
  readonly name: string;

  /**
   * Execute a settlement on the external network.
   *
   * In production: calls the blockchain API (Stellar Horizon, Ethereum RPC, etc.).
   * In sandbox: simulates the settlement (returns a fake txHash).
   */
  settle(request: SettlementRequest): Promise<SettlementResult>;

  /** Check if the adapter is available (network reachable). */
  isAvailable(): Promise<boolean>;

  /** Get the estimated settlement time (ms). */
  getEstimatedLatency(): number;
}

// ─── Stellar Adapter ───────────────────────────────────────────────────────

/**
 * StellarAdapter — settles on the Stellar network.
 *
 * M-RT-26: stub implementation (returns simulated results).
 * Production: calls Stellar Horizon API to submit transactions.
 */
export class StellarAdapter implements SettlementAdapter {
  readonly network = 'stellar' as const;
  readonly name = 'Stellar';

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    // M-RT-26: simulated settlement. In production, this would:
    // 1. Build a Stellar transaction (payment operation)
    // 2. Sign with the source account's secret key
    // 3. Submit to Stellar Horizon
    // 4. Return the transaction hash

    return {
      success: true,
      txHash: `stellar_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      network: 'stellar',
      settledAt: Date.now(),
      estimatedConfirmationMs: 5000, // Stellar: ~5s average
    };
  }

  async isAvailable(): Promise<boolean> {
    return true; // simulated
  }

  getEstimatedLatency(): number {
    return 5000;
  }
}

// ─── Ethereum Adapter (future) ─────────────────────────────────────────────

/**
 * EthereumAdapter — settles on Ethereum (USDC, etc.).
 * M-RT-26: stub. Production: calls Ethereum RPC.
 */
export class EthereumAdapter implements SettlementAdapter {
  readonly network = 'ethereum' as const;
  readonly name = 'Ethereum';

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    return {
      success: true,
      txHash: `eth_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      network: 'ethereum',
      settledAt: Date.now(),
      estimatedConfirmationMs: 12_000, // Ethereum: ~12s (1 block)
    };
  }

  async isAvailable(): Promise<boolean> {
    return false; // not yet configured
  }

  getEstimatedLatency(): number {
    return 12_000;
  }
}

// ─── Polygon Adapter (future) ──────────────────────────────────────────────

export class PolygonAdapter implements SettlementAdapter {
  readonly network = 'polygon' as const;
  readonly name = 'Polygon';

  async settle(request: SettlementRequest): Promise<SettlementResult> {
    return {
      success: true,
      txHash: `polygon_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      network: 'polygon',
      settledAt: Date.now(),
      estimatedConfirmationMs: 2_000,
    };
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }

  getEstimatedLatency(): number {
    return 2_000;
  }
}

// ─── Settlement Adapter Registry ───────────────────────────────────────────

/**
 * SettlementAdapterRegistry — holds all registered settlement adapters.
 *
 * Treasury queries this registry to find the adapter for a given network.
 */
export class SettlementAdapterRegistry {
  private readonly adapters = new Map<SettlementNetwork, SettlementAdapter>();

  /** Register a settlement adapter. */
  register(adapter: SettlementAdapter): void {
    this.adapters.set(adapter.network, adapter);
  }

  /** Get the adapter for a network (or null). */
  get(network: SettlementNetwork): SettlementAdapter | null {
    return this.adapters.get(network) ?? null;
  }

  /** List all registered networks. */
  networks(): SettlementNetwork[] {
    return [...this.adapters.keys()];
  }

  /** List all available adapters. */
  availableAdapters(): SettlementAdapter[] {
    return [...this.adapters.values()];
  }
}

/** Default adapters (Stellar is the first settlement layer). */
export function createDefaultAdapters(): SettlementAdapterRegistry {
  const registry = new SettlementAdapterRegistry();
  registry.register(new StellarAdapter());
  registry.register(new EthereumAdapter());
  registry.register(new PolygonAdapter());
  return registry;
}
