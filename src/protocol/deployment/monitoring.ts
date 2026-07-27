/**
 * PaySwap Protocol — Deployment — Production Monitoring Configuration.
 *
 * Owns the canonical monitoring configuration for PaySwap production:
 *   - Prometheus scrape endpoint config,
 *   - Grafana dashboard definitions (executive / operations / treasury /
 *     developer — exported as JSON),
 *   - Alert rules (Prometheus-style alerting rules),
 *   - SLO targets (99.9% payment success, 99.95% API availability,
 *     p99 < 5s settlement),
 *   - Log aggregation config (structured JSON logs to stdout for
 *     Loki / CloudWatch / Datadog ingestion).
 *
 * The service is a **configuration exporter** — it doesn't run the
 * monitoring stack itself. A separate process (Prometheus, Grafana,
 * Alertmanager) consumes the exported configs.
 *
 * The kernel is FROZEN — this module imports only `nowTs` from
 * `@/kernel/support` and `eventEngine` from `@/kernel/event`. No kernel
 * files are modified.
 */
import { eventEngine } from '@/kernel/event';
import { nowTs } from '@/kernel/support';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Prometheus scrape target. */
export interface PrometheusTarget {
  /** Job name (e.g. `payswap-api`). */
  jobName: string;
  /** Scrape interval (e.g. `15s`). */
  interval: string;
  /** Scrape timeout (e.g. `10s`). */
  timeout: string;
  /** Metrics path (default `/metrics`). */
  metricsPath: string;
  /** Static target address (e.g. `payswap-api:3000`). */
  staticTarget: string;
}

/** Prometheus scrape config. */
export interface PrometheusScrapeConfig {
  /** Global scrape interval. */
  globalScrapeInterval: string;
  /** Global scrape timeout. */
  globalScrapeTimeout: string;
  /** External labels attached to all metrics. */
  externalLabels: Record<string, string>;
  /** Scrape targets. */
  targets: PrometheusTarget[];
}

/** Grafana dashboard panel. */
export interface GrafanaPanel {
  title: string;
  type: 'stat' | 'graph' | 'table' | 'gauge' | 'heatmap';
  /** PromQL query. */
  query: string;
  /** Panel grid position. */
  gridPos: { x: number; y: number; w: number; h: number };
}

/** Grafana dashboard definition. */
export interface GrafanaDashboard {
  uid: string;
  title: string;
  tags: string[];
  timezone: string;
  schemaVersion: number;
  panels: GrafanaPanel[];
  /** Templating variables (e.g. `$environment`, `$corridor`). */
  templating: { list: Array<{ name: string; query: string; type: string }> };
  time: { from: string; to: string };
}

/** Prometheus alerting rule. */
export interface AlertRule {
  /** Alert name (e.g. `HighPaymentFailureRate`). */
  name: string;
  /** PromQL expression. */
  expr: string;
  /** How long the expression must be true before firing. */
  forDuration: string;
  /** Severity labels. */
  labels: { severity: 'info' | 'warning' | 'critical' };
  /** Annotation message + runbook URL. */
  annotations: { summary: string; description: string; runbook: string };
}

/** SLO target. */
export interface SLOTarget {
  /** SLO name (e.g. `payment_success_rate`). */
  name: string;
  /** Description. */
  description: string;
  /** Target ratio (0..1, e.g. 0.999 = 99.9%). */
  target: number;
  /** Measurement window (e.g. `30d`). */
  window: string;
  /** PromQL expression that returns the measured ratio. */
  sliQuery: string;
  /** Error budget remaining (0..1, computed from target). */
  errorBudget: number;
}

/** Log aggregation config. */
export interface LogAggregationConfig {
  /** Log format (`json` for structured logs). */
  format: 'json' | 'text';
  /** Log level. */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Fields to include in every log line. */
  defaultFields: Record<string, string>;
  /** Destination (stdout for container ingestion). */
  destination: 'stdout' | 'file' | 'otlp';
  /** Sampling rate for non-error logs (0..1). */
  samplingRate: number;
}

/** The full monitoring configuration. */
export interface MonitoringConfig {
  prometheusEndpoint: string;
  prometheusConfig: PrometheusScrapeConfig;
  grafanaDashboards: GrafanaDashboard[];
  alertRules: AlertRule[];
  sloTargets: SLOTarget[];
  logAggregation: LogAggregationConfig;
}

// ---------------------------------------------------------------------------
// Pre-configured SLO targets
// ---------------------------------------------------------------------------

/**
 * Pre-configured SLO targets. Matches the task spec exactly:
 *   - 99.9% payment success,
 *   - 99.95% API availability,
 *   - p99 < 5s settlement.
 */
export const DEFAULT_SLO_TARGETS: SLOTarget[] = [
  {
    name: 'payment_success_rate',
    description: 'Percentage of payments that complete successfully (not refunded, not failed).',
    target: 0.999,
    window: '30d',
    sliQuery:
      'sum(rate(payment_success_total[30d])) / sum(rate(payment_total[30d]))',
    errorBudget: 0.001, // 0.1% of requests can fail over 30d
  },
  {
    name: 'api_availability',
    description: 'Percentage of API requests that return a non-5xx response.',
    target: 0.9995,
    window: '30d',
    sliQuery:
      '1 - (sum(rate(http_requests_total{status=~"5.."}[30d])) / sum(rate(http_requests_total[30d])))',
    errorBudget: 0.0005, // 0.05% of requests can 5xx over 30d
  },
  {
    name: 'settlement_p99_latency',
    description: '99th-percentile settlement latency must be under 5 seconds.',
    target: 0.99,
    window: '30d',
    sliQuery:
      'histogram_quantile(0.99, sum(rate(settlement_duration_seconds_bucket[30d])) by (le))',
    errorBudget: 0.01, // 1% of settlements can exceed 5s over 30d
  },
];

// ---------------------------------------------------------------------------
// Pre-configured alert rules
// ---------------------------------------------------------------------------

/**
 * Pre-configured alert rules. Cover payment failure rate, API error
 * rate, settlement latency, connector outage, treasury gate breaches,
 * and DR replication lag.
 */
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: 'HighPaymentFailureRate',
    expr: '(sum(rate(payment_failed_total[5m])) / sum(rate(payment_total[5m]))) > 0.05',
    forDuration: '5m',
    labels: { severity: 'critical' },
    annotations: {
      summary: 'Payment failure rate > 5% over 5 minutes',
      description:
        'Payment failure rate is {{ $value | humanizePercentage }} — investigate connectors, treasury gates, and compliance blocks.',
      runbook: 'https://runbooks.payswap.io/high-payment-failure-rate',
    },
  },
  {
    name: 'HighAPIErrorRate',
    expr: '(sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) > 0.02',
    forDuration: '5m',
    labels: { severity: 'critical' },
    annotations: {
      summary: 'API 5xx error rate > 2% over 5 minutes',
      description: 'API 5xx error rate is {{ $value | humanizePercentage }}.',
      runbook: 'https://runbooks.payswap.io/high-api-error-rate',
    },
  },
  {
    name: 'HighSettlementLatency',
    expr: 'histogram_quantile(0.99, sum(rate(settlement_duration_seconds_bucket[5m])) by (le)) > 5',
    forDuration: '10m',
    labels: { severity: 'warning' },
    annotations: {
      summary: 'Settlement p99 latency > 5s over 10 minutes',
      description: 'Settlement p99 latency is {{ $value }}s — check connector health and LP capacity.',
      runbook: 'https://runbooks.payswap.io/high-settlement-latency',
    },
  },
  {
    name: 'ConnectorOutage',
    expr: 'connector_health{healthy="false"} == 1',
    forDuration: '2m',
    labels: { severity: 'critical' },
    annotations: {
      summary: 'Connector {{ $labels.connector_id }} is unhealthy',
      description: 'Connector has been unhealthy for 2 minutes.',
      runbook: 'https://runbooks.payswap.io/connector-outage',
    },
  },
  {
    name: 'TreasuryGateBreach',
    expr: 'increase(treasury_gate_blocked_total[5m]) > 0',
    forDuration: '1m',
    labels: { severity: 'critical' },
    annotations: {
      summary: 'Treasury gate blocked a transaction',
      description: 'A treasury pre-mint / pre-burn / backing-mismatch gate blocked a transaction.',
      runbook: 'https://runbooks.payswap.io/treasury-gate-breach',
    },
  },
  {
    name: 'HighReplicationLag',
    expr: 'max(dr_replication_lag_ms) > 5000',
    forDuration: '5m',
    labels: { severity: 'warning' },
    annotations: {
      summary: 'DR replication lag > 5s',
      description: 'Multi-region replication lag exceeds 5s — RPO at risk.',
      runbook: 'https://runbooks.payswap.io/high-replication-lag',
    },
  },
  {
    name: 'RPOViolation',
    expr: 'dr_rpo_ms > 60000',
    forDuration: '1m',
    labels: { severity: 'critical' },
    annotations: {
      summary: 'RPO exceeded 60s',
      description: 'Recovery point objective violated — potential data loss > 60s.',
      runbook: 'https://runbooks.payswap.io/rpo-violation',
    },
  },
  {
    name: 'RTOViolation',
    expr: 'dr_rto_ms > 300000',
    forDuration: '1m',
    labels: { severity: 'critical' },
    annotations: {
      summary: 'RTO exceeded 5 minutes',
      description: 'Recovery time objective violated — recovery took > 5 minutes.',
      runbook: 'https://runbooks.payswap.io/rto-violation',
    },
  },
];

// ---------------------------------------------------------------------------
// Pre-configured Grafana dashboards
// ---------------------------------------------------------------------------

/** Executive dashboard — revenue / volume / success rates. */
export const EXECUTIVE_DASHBOARD: GrafanaDashboard = {
  uid: 'payswap-executive',
  title: 'PaySwap — Executive Overview',
  tags: ['payswap', 'executive'],
  timezone: 'browser',
  schemaVersion: 39,
  panels: [
    {
      title: 'Payment Volume (24h)',
      type: 'stat',
      query: 'sum(payment_volume_usd_total[24h])',
      gridPos: { x: 0, y: 0, w: 6, h: 4 },
    },
    {
      title: 'Payment Success Rate (24h)',
      type: 'gauge',
      query: 'sum(rate(payment_success_total[24h])) / sum(rate(payment_total[24h]))',
      gridPos: { x: 6, y: 0, w: 6, h: 4 },
    },
    {
      title: 'Settlement Count (24h)',
      type: 'stat',
      query: 'sum(settlement_total[24h])',
      gridPos: { x: 12, y: 0, w: 6, h: 4 },
    },
    {
      title: 'Active Merchants (24h)',
      type: 'stat',
      query: 'count(count by (merchant_id) (rate(payment_total[24h]) > 0))',
      gridPos: { x: 18, y: 0, w: 6, h: 4 },
    },
    {
      title: 'Volume by Corridor (7d)',
      type: 'graph',
      query: 'sum by (corridor) (rate(payment_volume_usd_total[7d]))',
      gridPos: { x: 0, y: 4, w: 12, h: 8 },
    },
    {
      title: 'Settlement p99 Latency (24h)',
      type: 'graph',
      query: 'histogram_quantile(0.99, sum(rate(settlement_duration_seconds_bucket[24h])) by (le, corridor))',
      gridPos: { x: 12, y: 4, w: 12, h: 8 },
    },
  ],
  templating: {
    list: [
      { name: 'environment', query: 'label_values(environment)', type: 'query' },
      { name: 'corridor', query: 'label_values(corridor)', type: 'query' },
    ],
  },
  time: { from: 'now-24h', to: 'now' },
};

/** Operations dashboard — connector health + settlement queue. */
export const OPERATIONS_DASHBOARD: GrafanaDashboard = {
  uid: 'payswap-operations',
  title: 'PaySwap — Operations',
  tags: ['payswap', 'operations'],
  timezone: 'browser',
  schemaVersion: 39,
  panels: [
    {
      title: 'Connector Health',
      type: 'table',
      query: 'connector_health',
      gridPos: { x: 0, y: 0, w: 24, h: 6 },
    },
    {
      title: 'Connector Latency (5m)',
      type: 'graph',
      query: 'avg by (connector_id) (rate(connector_latency_ms[5m]))',
      gridPos: { x: 0, y: 6, w: 12, h: 8 },
    },
    {
      title: 'Settlement Queue Depth',
      type: 'graph',
      query: 'settlement_queue_depth',
      gridPos: { x: 12, y: 6, w: 12, h: 8 },
    },
  ],
  templating: {
    list: [
      { name: 'environment', query: 'label_values(environment)', type: 'query' },
    ],
  },
  time: { from: 'now-1h', to: 'now' },
};

/** Treasury dashboard — reserves / gates / backing. */
export const TREASURY_DASHBOARD: GrafanaDashboard = {
  uid: 'payswap-treasury',
  title: 'PaySwap — Treasury',
  tags: ['payswap', 'treasury'],
  timezone: 'browser',
  schemaVersion: 39,
  panels: [
    {
      title: 'Reserve Ratio',
      type: 'gauge',
      query: 'treasury_reserve_ratio',
      gridPos: { x: 0, y: 0, w: 8, h: 6 },
    },
    {
      title: 'Pre-Mint Gate Blocks (1h)',
      type: 'stat',
      query: 'increase(treasury_pre_mint_blocked_total[1h])',
      gridPos: { x: 8, y: 0, w: 8, h: 6 },
    },
    {
      title: 'Pre-Burn Gate Blocks (1h)',
      type: 'stat',
      query: 'increase(treasury_pre_burn_blocked_total[1h])',
      gridPos: { x: 16, y: 0, w: 8, h: 6 },
    },
    {
      title: 'Backing Mismatch (24h)',
      type: 'graph',
      query: 'increase(treasury_backing_mismatch_total[24h])',
      gridPos: { x: 0, y: 6, w: 24, h: 8 },
    },
  ],
  templating: {
    list: [
      { name: 'environment', query: 'label_values(environment)', type: 'query' },
    ],
  },
  time: { from: 'now-24h', to: 'now' },
};

/** Developer dashboard — API usage / spans / errors. */
export const DEVELOPER_DASHBOARD: GrafanaDashboard = {
  uid: 'payswap-developer',
  title: 'PaySwap — Developer',
  tags: ['payswap', 'developer'],
  timezone: 'browser',
  schemaVersion: 39,
  panels: [
    {
      title: 'API Requests / sec',
      type: 'graph',
      query: 'sum(rate(http_requests_total[5m])) by (route)',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
    },
    {
      title: 'API p99 Latency by Route',
      type: 'graph',
      query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))',
      gridPos: { x: 12, y: 0, w: 12, h: 8 },
    },
    {
      title: 'Span Duration by Name (p99)',
      type: 'graph',
      query: 'histogram_quantile(0.99, sum(rate(trace_span_duration_seconds_bucket[5m])) by (le, span_name))',
      gridPos: { x: 0, y: 8, w: 24, h: 8 },
    },
  ],
  templating: {
    list: [
      { name: 'environment', query: 'label_values(environment)', type: 'query' },
      { name: 'route', query: 'label_values(route)', type: 'query' },
    ],
  },
  time: { from: 'now-1h', to: 'now' },
};

/** All pre-configured dashboards. */
export const DEFAULT_GRAFANA_DASHBOARDS: GrafanaDashboard[] = [
  EXECUTIVE_DASHBOARD,
  OPERATIONS_DASHBOARD,
  TREASURY_DASHBOARD,
  DEVELOPER_DASHBOARD,
];

// ---------------------------------------------------------------------------
// Default Prometheus config
// ---------------------------------------------------------------------------

export const DEFAULT_PROMETHEUS_CONFIG: PrometheusScrapeConfig = {
  globalScrapeInterval: '15s',
  globalScrapeTimeout: '10s',
  externalLabels: {
    cluster: 'payswap-prod',
    environment: 'production',
  },
  targets: [
    {
      jobName: 'payswap-api',
      interval: '15s',
      timeout: '10s',
      metricsPath: '/metrics',
      staticTarget: 'payswap-api:3000',
    },
    {
      jobName: 'payswap-settlement-worker',
      interval: '15s',
      timeout: '10s',
      metricsPath: '/metrics',
      staticTarget: 'payswap-settlement-worker:3001',
    },
    {
      jobName: 'payswap-webhook-dispatcher',
      interval: '15s',
      timeout: '10s',
      metricsPath: '/metrics',
      staticTarget: 'payswap-webhook-dispatcher:3002',
    },
    {
      jobName: 'node-exporter',
      interval: '30s',
      timeout: '10s',
      metricsPath: '/metrics',
      staticTarget: 'node-exporter:9100',
    },
  ],
};

// ---------------------------------------------------------------------------
// Default log aggregation config
// ---------------------------------------------------------------------------

export const DEFAULT_LOG_AGGREGATION: LogAggregationConfig = {
  format: 'json',
  level: 'info',
  defaultFields: {
    service: 'payswap',
    environment: 'production',
  },
  destination: 'stdout',
  samplingRate: 1.0,
};

// ---------------------------------------------------------------------------
// MonitoringService
// ---------------------------------------------------------------------------

/**
 * Production monitoring configuration service. Owns the canonical
 * config and exports it in the formats the monitoring stack expects
 * (Prometheus YAML, Grafana JSON, alerting rules YAML).
 */
export class MonitoringService {
  private config: MonitoringConfig;

  constructor() {
    this.config = {
      prometheusEndpoint: '/metrics',
      prometheusConfig: { ...DEFAULT_PROMETHEUS_CONFIG },
      grafanaDashboards: DEFAULT_GRAFANA_DASHBOARDS.map((d) => ({
        ...d,
        panels: [...d.panels],
        templating: { list: [...d.templating.list] },
      })),
      alertRules: [...DEFAULT_ALERT_RULES],
      sloTargets: [...DEFAULT_SLO_TARGETS],
      logAggregation: { ...DEFAULT_LOG_AGGREGATION },
    };
  }

  /** Get the full monitoring config (snapshot). */
  getConfig(): MonitoringConfig {
    return {
      prometheusEndpoint: this.config.prometheusEndpoint,
      prometheusConfig: {
        ...this.config.prometheusConfig,
        externalLabels: { ...this.config.prometheusConfig.externalLabels },
        targets: this.config.prometheusConfig.targets.map((t) => ({ ...t })),
      },
      grafanaDashboards: this.config.grafanaDashboards.map((d) => ({
        ...d,
        panels: [...d.panels],
        templating: { list: [...d.templating.list] },
      })),
      alertRules: [...this.config.alertRules],
      sloTargets: [...this.config.sloTargets],
      logAggregation: { ...this.config.logAggregation },
    };
  }

  /** Export the Prometheus scrape config as YAML. */
  exportPrometheusConfig(): string {
    const cfg = this.config.prometheusConfig;
    const lines: string[] = [
      '# PaySwap — Prometheus scrape config (generated by MonitoringService)',
      'global:',
      `  scrape_interval: ${cfg.globalScrapeInterval}`,
      `  scrape_timeout: ${cfg.globalScrapeTimeout}`,
      '  external_labels:',
      ...Object.entries(cfg.externalLabels).map(([k, v]) => `    ${k}: ${v}`),
      '',
      'scrape_configs:',
      ...cfg.targets.flatMap((t) => [
        `  - job_name: '${t.jobName}'`,
        `    scrape_interval: ${t.interval}`,
        `    scrape_timeout: ${t.timeout}`,
        `    metrics_path: ${t.metricsPath}`,
        '    static_configs:',
        '      - targets:',
        `          - '${t.staticTarget}'`,
      ]),
    ];
    return lines.join('\n');
  }

  /**
   * Export a single Grafana dashboard as JSON. Returns null if the
   * dashboard name is unknown.
   */
  exportGrafanaDashboard(name: string): string | null {
    const dashboard = this.config.grafanaDashboards.find(
      (d) => d.uid === name || d.title === name,
    );
    if (!dashboard) return null;
    return JSON.stringify(dashboard, null, 2);
  }

  /** Export all Grafana dashboards as a single JSON array. */
  exportAllGrafanaDashboards(): string {
    return JSON.stringify(this.config.grafanaDashboards, null, 2);
  }

  /** Export the alert rules as Prometheus YAML. */
  exportAlertRules(): string {
    const lines: string[] = [
      '# PaySwap — Prometheus alerting rules (generated by MonitoringService)',
      'groups:',
      '  - name: payswap-alerts',
      '    interval: 30s',
      '    rules:',
      ...this.config.alertRules.flatMap((r) => [
        '      - alert: ' + r.name,
        `        expr: ${r.expr}`,
        `        for: ${r.forDuration}`,
        '        labels:',
        ...Object.entries(r.labels).map(([k, v]) => `          ${k}: ${v}`),
        '        annotations:',
        ...Object.entries(r.annotations).map(
          ([k, v]) => `          ${k}: "${v}"`,
        ),
      ]),
    ];
    return lines.join('\n');
  }

  /** Export the SLO targets as a JSON array (for consumption by Sloth / similar). */
  exportSLOTargets(): string {
    return JSON.stringify(this.config.sloTargets, null, 2);
  }

  /**
   * Get a single SLO target by name (or null).
   */
  getSLO(name: string): SLOTarget | null {
    return this.config.sloTargets.find((s) => s.name === name) ?? null;
  }

  /**
   * Add (or replace) an SLO target. Emits `monitoring.slo_set`.
   */
  setSLO(slo: SLOTarget): void {
    const idx = this.config.sloTargets.findIndex((s) => s.name === slo.name);
    if (idx >= 0) {
      this.config.sloTargets[idx] = { ...slo };
    } else {
      this.config.sloTargets.push({ ...slo });
    }
    eventEngine.emit('monitoring.slo_set', { name: slo.name, target: slo.target });
  }

  /**
   * Add (or replace) an alert rule. Emits `monitoring.alert_set`.
   */
  setAlertRule(rule: AlertRule): void {
    const idx = this.config.alertRules.findIndex((r) => r.name === rule.name);
    if (idx >= 0) {
      this.config.alertRules[idx] = { ...rule };
    } else {
      this.config.alertRules.push({ ...rule });
    }
    eventEngine.emit('monitoring.alert_set', { name: rule.name });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const _globalForMonitoring = globalThis as unknown as {
  __PAYSWAP_MONITORING?: MonitoringService;
};

export const monitoringService =
  _globalForMonitoring.__PAYSWAP_MONITORING ?? new MonitoringService();

if (!_globalForMonitoring.__PAYSWAP_MONITORING) {
  _globalForMonitoring.__PAYSWAP_MONITORING = monitoringService;
}
