/**
 * PaySwap Protocol — Observability Module — Barrel Export.
 *
 * Production observability for PaySwap: distributed tracing, business KPIs,
 * payment / settlement / connector / merchant / LP analytics, real-time
 * dashboards, and persona-specific dashboard aggregators.
 *
 * Surface:
 *   - Tracing:        Tracer, TracerProvider, Span, StartedSpan, SpanProcessor,
 *                     SpanExporter, InMemorySpanExporter, SimpleSpanProcessor,
 *                     BatchSpanProcessor, SPAN_NAMES, tracer, tracerProvider,
 *                     inMemorySpanExporter, startSpan, withSpan
 *   - KPIs:           BusinessKPI, KPITracker, kpiTracker, DEFAULT_KPI_SPECS
 *   - Payment:        PaymentAnalyticsService, paymentAnalytics
 *   - Settlement:     SettlementAnalyticsService, settlementAnalytics
 *   - Connector:      ConnectorAnalyticsService, connectorAnalytics
 *   - Merchant:       MerchantAnalyticsService, merchantAnalytics
 *   - LP:             LPAnalyticsService, lpAnalytics
 *   - Real-time:      RealTimeDashboard, realTimeDashboard
 *   - Dashboards:     executiveDashboard, operationsDashboard,
 *                     complianceDashboard, treasuryDashboard,
 *                     merchantDashboard, lpDashboard, developerDashboard,
 *                     observabilitySnapshot
 *
 * DESIGN PRINCIPLE — Observability is non-invasive. Analytics services
 * subscribe to events on the kernel event bus and aggregate in the
 * background. Business logic never blocks on analytics. Dashboards are
 * read-only projections. Every dashboard function is defensive — any thrown
 * error is caught and an empty-shaped result is returned with an `error`
 * field, so a single broken subsystem can never take down the whole view.
 *
 * USAGE — wire everything up once at process start:
 *   import { paymentAnalytics, settlementAnalytics, connectorAnalytics,
 *            merchantAnalytics, lpAnalytics, realTimeDashboard } from
 *            '@/protocol/observability';
 *   paymentAnalytics.subscribe();
 *   settlementAnalytics.subscribe();
 *   connectorAnalytics.subscribe();
 *   merchantAnalytics.subscribe();
 *   lpAnalytics.subscribe();
 *   realTimeDashboard.attach();
 *
 * The kernel is FROZEN — this module imports only from `@/kernel/*` and the
 * sibling observability + treasury-v2 modules. No kernel files are modified.
 */

// Tracing -------------------------------------------------------------------
export {
  Tracer,
  TracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
  SPAN_NAMES,
  tracerProvider,
  tracer,
  inMemorySpanExporter,
  startSpan,
  withSpan,
} from './tracing';
export type {
  Span,
  SpanKind,
  SpanStatus,
  SpanEvent,
  SpanContext,
  SpanEndOptions,
  StartedSpan,
  SpanProcessor,
  SpanExporter,
} from './tracing';

// Business KPIs -------------------------------------------------------------
export {
  KPITracker,
  kpiTracker,
  DEFAULT_KPI_SPECS,
} from './business-kpis';
export type {
  BusinessKPI,
  KPITrend,
  KPIStatus,
  KPIPeriod,
  KPICategory,
  KPISpec,
} from './business-kpis';

// Payment analytics ---------------------------------------------------------
export {
  PaymentAnalyticsService,
  paymentAnalytics,
} from './payment-analytics';
export type {
  PaymentRecord,
  PayoutRecord,
  PaymentStatus,
  PayoutStatus,
  TimeRange as PaymentTimeRange,
  AggregationGranularity,
  TimeSeriesPoint,
  CorridorBreakdown,
  CurrencyBreakdown,
  MethodBreakdown,
} from './payment-analytics';

// Settlement analytics ------------------------------------------------------
export {
  SettlementAnalyticsService,
  settlementAnalytics,
} from './settlement-analytics';
export type {
  SettlementRecord,
  SettlementStatus,
  CorridorSettlementBreakdown,
  LPSettlementBreakdown,
  SettlementDistribution,
  TimeRange as SettlementTimeRange,
} from './settlement-analytics';

// Connector analytics -------------------------------------------------------
export {
  ConnectorAnalyticsService,
  connectorAnalytics,
} from './connector-analytics';
export type {
  ConnectorRequest,
  ConnectorStats,
  ConnectorComparison,
  ConnectorTimeSeriesPoint,
  TimeRange as ConnectorTimeRange,
} from './connector-analytics';

// Merchant analytics --------------------------------------------------------
export {
  MerchantAnalyticsService,
  merchantAnalytics,
} from './merchant-analytics';
export type {
  MerchantActivityEvent,
  MerchantActivityType,
  MerchantActivityRecord,
  MerchantStats,
  TopMerchant,
  MerchantGrowthPoint,
  MerchantChurnPoint,
  MerchantCohort,
  TimeRange as MerchantTimeRange,
} from './merchant-analytics';

// LP analytics --------------------------------------------------------------
export {
  LPAnalyticsService,
  lpAnalytics,
} from './lp-analytics';
export type {
  LPActivityEvent,
  LPActivityType,
  LPActivityRecord,
  TopLP,
  LPReward,
  LPUtilizationPoint,
  LPHealthScore,
  CorridorCoverage,
  TimeRange as LPTimeRange,
} from './lp-analytics';

// Real-time dashboard -------------------------------------------------------
export {
  RealTimeDashboard,
  realTimeDashboard,
} from './real-time-dashboard';
export type {
  DashboardEventType,
  DashboardAlert,
  SystemMetrics,
  DashboardOverview,
  DashboardEventPayload,
  DashboardSubscriber,
} from './real-time-dashboard';

// High-level dashboards -----------------------------------------------------
export {
  executiveDashboard,
  operationsDashboard,
  complianceDashboard,
  treasuryDashboard,
  merchantDashboard,
  lpDashboard,
  developerDashboard,
  observabilitySnapshot,
} from './dashboards';
export type {
  ExecutiveDashboard,
  OperationsDashboard,
  ComplianceDashboard,
  TreasuryDashboard,
  MerchantDashboard,
  LPDashboard,
  DeveloperDashboard,
  ObservabilitySnapshot,
} from './dashboards';
