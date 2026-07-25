/**
 * PaySwap Protocol — Production Connectors v2 — Registry.
 *
 * Singleton registry holding all 5 production connectors with sane defaults.
 * The registry also acts as the secret resolver: it holds a per-connector
 * secrets map (apiKey + hmacSecret) and injects them into each connector at
 * construction time.
 *
 * In production, the secrets map is populated from the secrets manager
 * (Vault, AWS Secrets Manager, etc.) at boot. In this sandbox we use
 * deterministic test secrets so the HMAC signatures are reproducible.
 *
 * Exposes:
 *   - register(connector)        → register a custom connector (overrides default)
 *   - get(id)                    → fetch a connector by id
 *   - all()                      → all registered connectors
 *   - healthReport()             → all connectors' health snapshots
 *   - metricsReport()            → all connectors' metrics snapshots
 *   - auditReport(filter)        → filtered audit entries
 *   - startHealthProbes(intervalMs) → start periodic healthCheck() probes
 *
 * The OLD `src/protocol/connectors/` registry remains available for backward
 * compatibility — the v2 registry is additive.
 */
import type { ConnectorHealth, ConnectorId, ConnectorMetrics } from './types';
import { sharedHealthMonitor } from './health';
import { sharedMetricsCollector } from './metrics';
import { auditLogInstance, type AuditFilter } from './audit';
import { OpenBankingConnector } from './open-banking';
import { MpesaConnector } from './mpesa';
import { EthereumRpcConnector } from './ethereum-rpc';
import { FxRateConnector } from './fx-rate';
import { StellarHorizonConnector } from './stellar-horizon';
import type { ProductionConnector } from './base';

/** Simulated secrets for each connector (in production: from secrets manager). */
const SIMULATED_SECRETS: Record<ConnectorId, { apiKey: string; hmacSecret: string }> = {
  open_banking: {
    apiKey: 'ob_prod_bearer_2c8f1a9e4b7d6038',
    hmacSecret: 'ob_prod_hmac_secret_b9d3f1a7c8e24065',
  },
  mpesa: {
    apiKey: 'mpesa_prod_consumer_key_3a8b2c1d4e5f60718293a4b5c6d7e8f9',
    hmacSecret: 'mpesa_prod_hmac_secret_5f4e3d2c1b0a9988',
  },
  ethereum_rpc: {
    apiKey: 'eth_prod_project_id_1a2b3c4d5e6f7a8b',
    hmacSecret: 'eth_prod_hmac_secret_9f8e7d6c5b4a3928',
  },
  fx_rate: {
    apiKey: 'fx_prod_api_key_7a8b9c0d1e2f3a4b',
    hmacSecret: 'fx_prod_hmac_secret_1f2e3d4c5b6a7988',
  },
  stellar_horizon: {
    apiKey: 'stellar_prod_api_key_5e6f7a8b9c0d1e2f',
    hmacSecret: 'stellar_prod_hmac_secret_3b4c5d6e7f8090a1',
  },
};

/**
 * Production connector registry. Singleton `productionConnectorRegistry` is
 * pre-populated with all 5 connectors.
 */
export class ProductionConnectorRegistry {
  private connectors: Map<ConnectorId, ProductionConnector> = new Map();
  private healthStopFn: (() => void) | null = null;

  /** Register a connector. If a connector with the same id exists, it's replaced. */
  register(connector: ProductionConnector): void {
    this.connectors.set(connector.getConfig().id, connector);
  }

  /** Fetch a connector by id. */
  get(id: ConnectorId): ProductionConnector | undefined {
    return this.connectors.get(id);
  }

  /** All registered connectors. */
  all(): ProductionConnector[] {
    return [...this.connectors.values()];
  }

  /** All registered connector ids. */
  ids(): ConnectorId[] {
    return [...this.connectors.keys()];
  }

  /** Whether a connector is registered. */
  has(id: ConnectorId): boolean {
    return this.connectors.has(id);
  }

  /**
   * Convenience: execute a query against a specific connector.
   * Returns undefined response if the connector isn't registered.
   */
  async query(
    id: ConnectorId,
    request: import('./types').ConnectorRequest,
  ): Promise<import('./types').ConnectorResponse> {
    const connector = this.connectors.get(id);
    if (!connector) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN',
          message: `Connector not registered: ${id}`,
          retryable: false,
        },
        latencyMs: 0,
        attempts: 0,
        requestId: `req_missing_${Date.now()}`,
      };
    }
    return connector.query(request);
  }

  /** Health snapshot for every registered connector. */
  healthReport(): ConnectorHealth[] {
    return sharedHealthMonitor.all().filter(
      (h) => this.connectors.has(h.id),
    );
  }

  /** Metrics snapshot for every registered connector. */
  metricsReport(): ConnectorMetrics[] {
    return sharedMetricsCollector.all().filter(
      (m) => this.connectors.has(m.id),
    );
  }

  /** Filtered audit entries. */
  auditReport(filter: AuditFilter = {}): ReturnType<typeof auditLogInstance.query> {
    return auditLogInstance.query(filter);
  }

  /** Total audit entries written (monotonic — survives ring-buffer wrap). */
  auditTotal(): number {
    return auditLogInstance.total();
  }

  /**
   * Start periodic health probes. Each probe calls `healthCheck()` on every
   * registered connector and records the result in the health monitor.
   * Returns a stop function.
   */
  startHealthProbes(intervalMs: number = 30_000): () => void {
    if (this.healthStopFn) {
      // Already started — stop the previous one first.
      this.healthStopFn();
    }
    this.healthStopFn = sharedHealthMonitor.startPeriodic(async () => {
      for (const connector of this.connectors.values()) {
        const id = connector.getConfig().id;
        try {
          const probe = await connector.healthCheck();
          if (probe.healthy) {
            sharedHealthMonitor.recordSuccess(id, probe.latencyMs);
          } else {
            sharedHealthMonitor.recordFailure(id, {
              code: 'UNKNOWN',
              message: 'healthCheck returned unhealthy',
              retryable: false,
            });
          }
        } catch {
          sharedHealthMonitor.recordFailure(id, {
            code: 'NETWORK',
            message: 'healthCheck threw',
            retryable: true,
          });
        }
      }
    }, intervalMs);
    return () => {
      this.healthStopFn?.();
      this.healthStopFn = null;
    };
  }

  /** Reset all metrics, health, audit, and idempotency state. */
  reset(): void {
    sharedHealthMonitor.reset();
    sharedMetricsCollector.reset();
    auditLogInstance.reset();
  }
}

/**
 * Singleton production connector registry — pre-populated with all 5
 * connectors and their resolved secrets.
 */
export const productionConnectorRegistry = new ProductionConnectorRegistry();

/**
 * Bootstrap the registry with all 5 default connectors + their secrets.
 * Called once at module load. Idempotent (safe to call multiple times).
 */
export function bootstrapProductionConnectors(): void {
  const registry = productionConnectorRegistry;

  // Build the 5 connectors with default configs.
  const connectors: ProductionConnector[] = [
    new OpenBankingConnector(),
    new MpesaConnector(),
    new EthereumRpcConnector(),
    new FxRateConnector(),
    new StellarHorizonConnector(),
  ];

  for (const connector of connectors) {
    const id = connector.getConfig().id;
    const secrets = SIMULATED_SECRETS[id];
    if (secrets) {
      connector.setApiKey(secrets.apiKey);
      connector.setSecret(secrets.hmacSecret);
    }
    registry.register(connector);
  }
}

// Auto-bootstrap on module load (idempotent — guarded by registry state).
if (productionConnectorRegistry.all().length === 0) {
  bootstrapProductionConnectors();
}
