/**
 * PaySwap Protocol — Ops Module — Barrel Export.
 *
 * Operational observability for PaySwap: a Prometheus-style metrics
 * registry, rule-driven alerting, SLO tracking, and dashboard aggregators.
 *
 * Surface:
 *   - Metrics: Counter, Gauge, Histogram, MetricsRegistry, metricsRegistry
 *   - Alerts:  AlertRule, Alert, AlertManager, alertManager
 *   - SLOs:    SLO, SLOStatus, ErrorBudget, SLOManager, sloManager
 *   - Dashboards: systemOverview, connectorDashboard, settlementDashboard,
 *                 lpDashboard, treasuryDashboard, opsSnapshot,
 *                 refreshDerivedMetrics
 *
 * The kernel is FROZEN — this module only consumes `@/kernel/event` and
 * `@/kernel/support`. All new code lives in `src/protocol/ops/`.
 */

// Metrics -------------------------------------------------------------------
export {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  metricsRegistry,
  METRIC_NAMES,
  DEFAULT_BUCKETS_MS,
  labelKey,
  histogramPercentile,
} from './metrics';
export type {
  LabelSet,
  MetricType,
  MetricDescriptor,
  MetricEntry,
  HistogramBucket,
  HistogramSnapshot,
  AnyMetric,
  MetricJsonSnapshot,
} from './metrics';

// Alerts --------------------------------------------------------------------
export {
  AlertManager,
  alertManager,
  STANDARD_ALERT_RULES,
  checkCondition,
} from './alerts';
export type {
  AlertRule,
  Alert,
  AlertSeverity,
  AlertCondition,
  AlertTimeRange,
} from './alerts';

// SLOs ----------------------------------------------------------------------
export { SLOManager, sloManager } from './slos';
export type { SLO, SLOStatus, SLODirection, ErrorBudget } from './slos';

// Correlation ---------------------------------------------------------------
export {
  withCorrelation,
  currentCorrelation,
  newTraceId,
  newSpanId,
  enterCorrelation,
  correlationHeaders,
} from './correlation';
export type { CorrelationContext } from './correlation';

// Tracing -------------------------------------------------------------------
export {
  withSpan,
  withSpanAsync,
  inMemorySpanExporter,
  tracerProvider,
  tracer,
  SPAN_NAMES,
} from './tracing';
export type {
  Span,
  SpanEvent,
  SpanKind,
  SpanStatus,
  SpanExporter,
  SpanProcessor,
  StartedSpan,
  StartSpanOptions,
  WithSpanOptions,
} from './tracing';

// Logger --------------------------------------------------------------------
export {
  logger,
  sharedLogBuffer,
  log,
  logAt,
  Logger,
  LogBuffer,
} from './logger';
export type { LogEntry, LogLevel, LoggerOptions } from './logger';

// Dashboards ----------------------------------------------------------------
export {
  systemOverview,
  connectorDashboard,
  settlementDashboard,
  lpDashboard,
  treasuryDashboard,
  opsSnapshot,
  refreshDerivedMetrics,
} from './dashboards';
export type {
  SystemOverview,
  ConnectorDashboard,
  SettlementDashboard,
  LPDashboard,
  TreasuryDashboard,
  OpsSnapshot,
} from './dashboards';
