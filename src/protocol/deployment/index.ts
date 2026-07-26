/**
 * PaySwap Protocol — Deployment Module — Barrel Export.
 *
 * Production deployment infrastructure for PaySwap: feature flags,
 * secret management, autoscaling policies, deployment strategies
 * (blue-green / canary / rolling), Kubernetes-style health probes,
 * and production monitoring configuration (Prometheus / Grafana /
 * alerting rules / SLO targets / log aggregation).
 *
 * Surface:
 *   - Feature flags:     FeatureFlagService, featureFlags,
 *                        FeatureFlag, DEFAULT_FEATURE_FLAGS
 *   - Secret management: SecretManager, secretManager,
 *                        SecretProvider, EnvSecretProvider,
 *                        VaultSecretProvider, VaultProviderConfig,
 *                        SecretResult, SecretListResult,
 *                        SecretRotateResult, SecretMetadata
 *   - Autoscaling:       AutoscalingService, autoscalingService,
 *                        ScalingPolicy, ScalingMetric, ScalingMetrics,
 *                        ScalingDecision, DEFAULT_SCALING_POLICIES
 *   - Deployment:        DeploymentService, deploymentService,
 *                        DeploymentStrategy, DeploymentStatus,
 *                        DeploymentConfig, DeploymentRecord,
 *                        DeploymentResult, DeploymentHistoryEntry,
 *                        BlueGreenEnvironment
 *   - Health probes:     HealthProbe, healthProbes,
 *                        ProbeConfig, ProbeResult,
 *                        DEFAULT_PROBE_CONFIGS
 *   - Monitoring:        MonitoringService, monitoringService,
 *                        MonitoringConfig, PrometheusScrapeConfig,
 *                        PrometheusTarget, GrafanaDashboard, GrafanaPanel,
 *                        AlertRule, SLOTarget, LogAggregationConfig,
 *                        DEFAULT_PROMETHEUS_CONFIG, DEFAULT_ALERT_RULES,
 *                        DEFAULT_SLO_TARGETS, DEFAULT_GRAFANA_DASHBOARDS,
 *                        DEFAULT_LOG_AGGREGATION
 *
 * DESIGN PRINCIPLE — Deployment is non-invasive. Every service is a
 * pure abstraction that runs alongside the kernel without modifying
 * it. Feature flags gate behaviour at call sites (the caller checks
 * `featureFlags.isEnabled('live_stellar')` before switching to mainnet);
 * secrets are loaded at bootstrap; autoscaling + deployment strategies
 * are operational concerns external to the business logic; health
 * probes are read-only projections; monitoring config is exported for
 * a separate monitoring stack to consume.
 *
 * USAGE — wire everything up once at process start:
 *   ```ts
 *   import { featureFlags, secretManager, healthProbes, monitoringService }
 *     from '@/protocol/deployment';
 *
 *   // Flip flags at runtime (no redeploy).
 *   featureFlags.set({ key: 'live_stellar', enabled: true, ... });
 *
 *   // Swap to Vault in production.
 *   secretManager.setProvider(new VaultSecretProvider({
 *     address: process.env.VAULT_ADDRESS!,
 *     token: process.env.VAULT_TOKEN!,
 *   }));
 *
 *   // Wire /healthz, /readyz, /startupz endpoints.
 *   app.get('/healthz', (req, res) => {
 *     const r = healthProbes.liveness();
 *     res.status(r.healthy ? 200 : 503).json(r);
 *   });
 *
 *   // Export Prometheus config for the scraper.
 *   fs.writeFileSync('prometheus.yml', monitoringService.exportPrometheusConfig());
 *   ```
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/*`
 * and the sibling protocol modules (`@/protocol/persistence/event-store`,
 * `@/protocol/chains/registry`, `@/protocol/connectors-v2/registry`).
 * No kernel files are modified.
 */

// Feature flags --------------------------------------------------------------
export {
  FeatureFlagService,
  featureFlags,
  DEFAULT_FEATURE_FLAGS,
} from './feature-flags';
export type { FeatureFlag } from './feature-flags';

// Secret management ----------------------------------------------------------
export {
  SecretManager,
  secretManager,
  EnvSecretProvider,
  VaultSecretProvider,
} from './secret-management';
export type {
  SecretProvider,
  VaultProviderConfig,
  SecretResult,
  SecretListResult,
  SecretRotateResult,
  SecretMetadata,
} from './secret-management';

// Autoscaling ----------------------------------------------------------------
export {
  AutoscalingService,
  autoscalingService,
  DEFAULT_SCALING_POLICIES,
} from './autoscaling';
export type {
  ScalingPolicy,
  ScalingMetric,
  ScalingMetrics,
  ScalingDecision,
} from './autoscaling';

// Deployment strategy --------------------------------------------------------
export {
  DeploymentService,
  deploymentService,
} from './deployment-strategy';
export type {
  DeploymentStrategy,
  DeploymentStatus,
  DeploymentConfig,
  DeploymentRecord,
  DeploymentResult,
  DeploymentHistoryEntry,
  BlueGreenEnvironment,
} from './deployment-strategy';

// Health probes --------------------------------------------------------------
export {
  HealthProbe,
  healthProbes,
  DEFAULT_PROBE_CONFIGS,
} from './health-probes';
export type { ProbeConfig, ProbeResult } from './health-probes';

// Monitoring -----------------------------------------------------------------
export {
  MonitoringService,
  monitoringService,
  DEFAULT_PROMETHEUS_CONFIG,
  DEFAULT_ALERT_RULES,
  DEFAULT_SLO_TARGETS,
  DEFAULT_GRAFANA_DASHBOARDS,
  DEFAULT_LOG_AGGREGATION,
  EXECUTIVE_DASHBOARD,
  OPERATIONS_DASHBOARD,
  TREASURY_DASHBOARD,
  DEVELOPER_DASHBOARD,
} from './monitoring';
export type {
  MonitoringConfig,
  PrometheusScrapeConfig,
  PrometheusTarget,
  GrafanaDashboard,
  GrafanaPanel,
  AlertRule,
  SLOTarget,
  LogAggregationConfig,
} from './monitoring';
