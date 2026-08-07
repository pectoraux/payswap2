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
export { AlertManager, alertManager, checkCondition, STANDARD_ALERT_RULES } from './alerts';
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

// Correlation + tracing (used by tests + middleware) -----------------------
export { withCorrelation, currentCorrelation } from './correlation';
export type { CorrelationContext } from './correlation';

// Tracing (span-based) ------------------------------------------------------
export {
  withSpan,
  withSpanAsync,
  inMemorySpanExporter,
  TracerProvider,
  tracerProvider,
} from './tracing';
export type { Span, SpanContext, SpanKind, SpanStatus } from './tracing';

// Logger --------------------------------------------------------------------
export { logger, sharedLogBuffer } from './logger';
export type { LogEntry, LogLevel } from './logger';

// Metrics helpers -----------------------------------------------------------
export { labelKey } from './metrics';

/** Compute the p-th percentile of a sorted array of values. */
export function histogramPercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (p <= 0) return sortedValues[0];
  if (p >= 100) return sortedValues[sortedValues.length - 1];
  const idx = Math.floor((p / 100) * sortedValues.length);
  return sortedValues[Math.min(idx, sortedValues.length - 1)];
}
