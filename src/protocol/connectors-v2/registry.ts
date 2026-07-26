/**
 * PaySwap Protocol — Production Connectors v2 — Registry.
 *
 * The registry is the single entry point for the rest of the protocol
 * layer. It owns a shared `HealthMonitor` + `MetricsCollector` so the
 * planner can ask "is the open_banking connector healthy right now?"
 * without each connector having to wire its own dependencies.
 *
 * The singleton `productionConnectorRegistry` is pre-loaded with all 5
 * production connectors using their default configs. Tests that need a
 * fresh registry can construct `new ProductionConnectorRegistry()`.
 */
import type { ConnectorHealth, ConnectorId, ConnectorMetrics } from './types';
import { HealthMonitor } from './health';
import { MetricsCollector } from './metrics';
import { getAuditLog, type AuditLogFilter, type ConnectorAuditEntry } from './audit';
import { ProductionConnector } from './base';
import { OpenBankingConnector } from './open-banking';
import { MpesaConnector } from './mpesa';
import { FxRateConnector } from './fx-rate';
import { StellarHorizonConnector } from './stellar-horizon';
import { EthereumRpcConnector } from './ethereum-rpc';

/** Connector shape the registry accepts — must extend ProductionConnector. */
export type AnyProductionConnector = ProductionConnector;

export class ProductionConnectorRegistry {
  private connectors = new Map<ConnectorId, AnyProductionConnector>();
  readonly health: HealthMonitor;
  readonly metrics: MetricsCollector;

  constructor() {
    this.health = new HealthMonitor();
    this.metrics = new MetricsCollector();
  }

  /** Register a connector. Overwrites an existing one with the same id. */
  register(connector: AnyProductionConnector): void {
    this.connectors.set(connector.id, connector);
  }

  /** Look up a connector by id. */
  get(id: ConnectorId): AnyProductionConnector | undefined {
    return this.connectors.get(id);
  }

  /** All registered connectors. */
  all(): AnyProductionConnector[] {
    return [...this.connectors.values()];
  }

  /** Run health checks against every connector. Returns the full report. */
  async healthReport(): Promise<ConnectorHealth[]> {
    const out: ConnectorHealth[] = [];
    for (const c of this.connectors.values()) {
      const probe = await c.healthCheck();
      if (probe.healthy) {
        this.health.recordSuccess(c.id, probe.latencyMs);
      } else {
        // Coerce the probe failure into a synthetic error for the monitor.
        this.health.recordFailure(c.id, {
          code: 'UNKNOWN',
          message: 'health_check_failed',
          retryable: false,
        });
      }
      out.push(this.health.getHealth(c.id));
    }
    return out;
  }

  /** Synchronous snapshot of cached health (no probes). */
  healthSnapshot(): ConnectorHealth[] {
    return this.health.all();
  }

  /** Metrics report — one entry per connector seen so far. */
  metricsReport(): ConnectorMetrics[] {
    return this.metrics.all();
  }

  /** Filtered view of the audit log. */
  auditReport(filter?: AuditLogFilter): ConnectorAuditEntry[] {
    return getAuditLog(filter);
  }
}

/**
 * Singleton registry with all 5 production connectors pre-registered.
 * The rest of the protocol layer imports this directly.
 */
export const productionConnectorRegistry = new ProductionConnectorRegistry();

productionConnectorRegistry.register(
  new OpenBankingConnector(productionConnectorRegistry.health, productionConnectorRegistry.metrics),
);
productionConnectorRegistry.register(
  new MpesaConnector(productionConnectorRegistry.health, productionConnectorRegistry.metrics),
);
productionConnectorRegistry.register(
  new FxRateConnector(productionConnectorRegistry.health, productionConnectorRegistry.metrics),
);
productionConnectorRegistry.register(
  new StellarHorizonConnector(productionConnectorRegistry.health, productionConnectorRegistry.metrics),
);
productionConnectorRegistry.register(
  new EthereumRpcConnector(productionConnectorRegistry.health, productionConnectorRegistry.metrics),
);
