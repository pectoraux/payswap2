/**
 * PaySwap Protocol — Provider Adapters — Registry.
 *
 * The `ProviderRegistry` is the single entry point for the rest of the
 * protocol layer. It owns a shared `HealthMonitor` + `MetricsCollector`
 * (separate from the `connectors-v2` registry's instances) so the
 * planner can ask "is the Stripe adapter healthy right now?" without
 * each adapter wiring its own dependencies.
 *
 * The singleton `providerRegistry` is pre-loaded with all 13 production
 * provider adapters using their default configs. Tests that need a
 * fresh registry can construct `new ProviderRegistry()`.
 *
 * The registry also exposes `getByType(type)` so the planner / executor
 * can request "all mobile_money providers" or "all blockchain_rpc
 * providers" without iterating the full set.
 *
 * Note on typing: each adapter's `ProductionConnector.config` is typed
 * as `ConnectorConfig` (with the frozen `ConnectorId` union). At runtime
 * the `id` / `type` fields are our richer `ProviderId` / `ProviderType`
 * strings. The registry casts through `ProviderConfig` (via
 * `asProviderConfig`) to recover the richer types where needed.
 */
import type {
  ConnectorHealth,
  ConnectorMetrics,
} from '@/protocol/connectors-v2/types';
import { HealthMonitor } from '@/protocol/connectors-v2/health';
import { MetricsCollector } from '@/protocol/connectors-v2/metrics';
import { ProductionConnector } from '@/protocol/connectors-v2/base';
import type { ProviderConfig, ProviderId, ProviderType } from './types';
import { MtnMomoConnector, DEFAULT_MTN_MOMO_CONFIG } from './mtn-momo';
import { AirtelMoneyConnector, DEFAULT_AIRTEL_MONEY_CONFIG } from './airtel-money';
import { StripeConnector, DEFAULT_STRIPE_CONFIG } from './stripe';
import { FlutterwaveConnector, DEFAULT_FLUTTERWAVE_CONFIG } from './flutterwave';
import { PaystackConnector, DEFAULT_PAYSTACK_CONFIG } from './paystack';
import { FireblocksConnector, DEFAULT_FIREBLOCKS_CONFIG } from './fireblocks';
import { ChainalysisConnector, DEFAULT_CHAINALYSIS_CONFIG } from './chainalysis';
import { TrmLabsConnector, DEFAULT_TRM_LABS_CONFIG } from './trm-labs';
import { OpenBankingPsd2Connector, DEFAULT_OPEN_BANKING_PSD2_CONFIG } from './open-banking';
import { EthereumRpcConnector } from './ethereum-rpc';
import { PolygonRpcConnector } from './polygon-rpc';
import { BaseRpcConnector } from './base-rpc';
import { StellarHorizonConnector } from './horizon';

/** Connector shape the registry accepts — must extend ProductionConnector. */
export type AnyProvider = ProductionConnector;

/** Health snapshot with the richer `ProviderId`. */
export type ProviderHealth = Omit<ConnectorHealth, 'id'> & { id: ProviderId };

/** Aggregate metrics with the richer `ProviderId`. */
export type ProviderMetrics = Omit<ConnectorMetrics, 'id'> & { id: ProviderId };

/** Recover the richer `ProviderConfig` view from a connector's config. */
function asProviderConfig(connector: ProductionConnector): ProviderConfig {
  return connector.config as unknown as ProviderConfig;
}

/** Map a ProviderId to its concrete connector class + default config. */
interface ProviderFactory {
  id: ProviderId;
  build: (h: HealthMonitor, m: MetricsCollector) => AnyProvider;
}

const PROVIDER_FACTORIES: ProviderFactory[] = [
  { id: 'mtn_momo',           build: (h, m) => new MtnMomoConnector(h, m) },
  { id: 'airtel_money',       build: (h, m) => new AirtelMoneyConnector(h, m) },
  { id: 'stripe',             build: (h, m) => new StripeConnector(h, m) },
  { id: 'flutterwave',        build: (h, m) => new FlutterwaveConnector(h, m) },
  { id: 'paystack',           build: (h, m) => new PaystackConnector(h, m) },
  { id: 'fireblocks',         build: (h, m) => new FireblocksConnector(h, m) },
  { id: 'chainalysis',        build: (h, m) => new ChainalysisConnector(h, m) },
  { id: 'trm_labs',           build: (h, m) => new TrmLabsConnector(h, m) },
  { id: 'open_banking_psd2',  build: (h, m) => new OpenBankingPsd2Connector(h, m) },
  { id: 'ethereum_rpc',       build: (h, m) => new EthereumRpcConnector(h, m) },
  { id: 'polygon_rpc',        build: (h, m) => new PolygonRpcConnector(h, m) },
  { id: 'base_rpc',           build: (h, m) => new BaseRpcConnector(h, m) },
  { id: 'stellar_horizon',    build: (h, m) => new StellarHorizonConnector(h, m) },
];

export class ProviderRegistry {
  private providers = new Map<ProviderId, AnyProvider>();
  readonly health: HealthMonitor;
  readonly metrics: MetricsCollector;

  constructor() {
    this.health = new HealthMonitor();
    this.metrics = new MetricsCollector();
  }

  /** Register a provider. Overwrites an existing one with the same id. */
  register(provider: AnyProvider): void {
    const id = asProviderConfig(provider).id;
    this.providers.set(id, provider);
  }

  /** Look up a provider by id. */
  get(id: ProviderId): AnyProvider | undefined {
    return this.providers.get(id);
  }

  /** All registered providers. */
  all(): AnyProvider[] {
    return [...this.providers.values()];
  }

  /** All provider ids registered. */
  ids(): ProviderId[] {
    return [...this.providers.keys()];
  }

  /** Providers of a given type (bank, mobile_money, psp, custody, compliance, blockchain_rpc). */
  getByType(type: ProviderType): AnyProvider[] {
    return this.all().filter((p) => asProviderConfig(p).type === type);
  }

  /** Run health checks against every provider. Returns the full report. */
  async healthReport(): Promise<ProviderHealth[]> {
    const out: ProviderHealth[] = [];
    for (const provider of this.providers.values()) {
      const probe = await provider.healthCheck();
      const id = asProviderConfig(provider).id;
      if (probe.healthy) {
        this.health.recordSuccess(provider.id, probe.latencyMs);
      } else {
        this.health.recordFailure(provider.id, {
          code: 'UNKNOWN',
          message: 'health_check_failed',
          retryable: false,
        });
      }
      const snapshot = this.health.getHealth(provider.id);
      out.push({ ...snapshot, id });
    }
    return out;
  }

  /** Synchronous snapshot of cached health (no probes). */
  healthSnapshot(): ProviderHealth[] {
    return this.health.all().map((h) => ({ ...h, id: h.id as unknown as ProviderId }));
  }

  /** Metrics report — one entry per provider seen so far. */
  metricsReport(): ProviderMetrics[] {
    return this.metrics.all().map((m) => ({ ...m, id: m.id as unknown as ProviderId }));
  }

  /** Convenience: get the type of a provider. */
  typeOf(id: ProviderId): ProviderType | undefined {
    const provider = this.providers.get(id);
    return provider ? asProviderConfig(provider).type : undefined;
  }

  /** Number of registered providers. */
  size(): number {
    return this.providers.size;
  }
}

/**
 * Singleton registry with all 13 production providers pre-registered.
 * The rest of the protocol layer imports this directly.
 *
 * Singleton pattern follows the kernel's `globalThis.__PAYSWAP_*`
 * convention so Next.js dev-mode module re-instantiation cannot create
 * duplicates.
 */
declare global {
  var __PAYSWAP_PROVIDER_REGISTRY: ProviderRegistry | undefined;
}

export const providerRegistry: ProviderRegistry =
  globalThis.__PAYSWAP_PROVIDER_REGISTRY ?? new ProviderRegistry();

if (!globalThis.__PAYSWAP_PROVIDER_REGISTRY) {
  globalThis.__PAYSWAP_PROVIDER_REGISTRY = providerRegistry;
  // Pre-register all 13 default providers.
  for (const factory of PROVIDER_FACTORIES) {
    providerRegistry.register(factory.build(providerRegistry.health, providerRegistry.metrics));
  }
}

/** Re-export the default configs for callers that want to construct customised providers. */
export const PROVIDER_DEFAULT_CONFIGS = {
  mtn_momo: DEFAULT_MTN_MOMO_CONFIG,
  airtel_money: DEFAULT_AIRTEL_MONEY_CONFIG,
  stripe: DEFAULT_STRIPE_CONFIG,
  flutterwave: DEFAULT_FLUTTERWAVE_CONFIG,
  paystack: DEFAULT_PAYSTACK_CONFIG,
  fireblocks: DEFAULT_FIREBLOCKS_CONFIG,
  chainalysis: DEFAULT_CHAINALYSIS_CONFIG,
  trm_labs: DEFAULT_TRM_LABS_CONFIG,
  open_banking_psd2: DEFAULT_OPEN_BANKING_PSD2_CONFIG,
} as const;
