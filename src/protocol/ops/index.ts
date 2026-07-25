/**
 * PaySwap Protocol — Operational Readiness — Barrel Export.
 *
 * Centralizes all ops exports + the `initOps()` lifecycle helper.
 *
 * Quick start:
 *   import {
 *     logger, withSpan, withCorrelation, metricsRegistry,
 *     alertManager, sloManager, systemOverview, initOps,
 *   } from '@/protocol/ops';
 *
 *   // 1. Establish correlation context for an inbound request:
 *   export async function POST(req: NextRequest) {
 *     return withRequest(req, () => {
 *       return withSpan('payment.create', () => {
 *         logger.info('payment received', { amount: 500 });
 *         metricsRegistry.getCounter('payswap_payments_total')!.inc({ status: 'success', currency: 'KES', corridor: 'GHS→KES' });
 *         return NextResponse.json({ ok: true });
 *       });
 *     });
 *   }
 *
 *   // 2. Start the background alert evaluator:
 *   const stopOps = initOps({ alertIntervalMs: 30_000 });
 *   // ... on shutdown:
 *   stopOps();
 *
 * Frozen-kernel compliance:
 *   - Imports only `eventEngine` from kernel (for `ops.alert_fired` events).
 *   - No kernel state is mutated.
 *   - All NEW files live in src/protocol/ops/.
 *   - Coexists with `src/kernel/metrics.ts` (legacy) and
 *     `src/protocol/connectors-v2/metrics.ts` (connector-scoped) without
 *     conflict — different module paths, different singletons.
 */

// ─── Metrics ──────────────────────────────────────────────────────────────────
export {
  // Types
  type MetricType,
  type LabelValues,
  type HistogramBucket,
  type HistogramValue,
  type Metric,
  type AnyMetric,
  // Classes
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  // Helpers
  labelKey,
  parseLabelKey,
  histogramPercentile,
  registerStandardMetrics,
  // Singleton
  metricsRegistry,
} from './metrics';

// ─── Correlation ──────────────────────────────────────────────────────────────
export {
  type CorrelationContext,
  newTraceId,
  newSpanId,
  currentCorrelation,
  withCorrelation,
  enterCorrelation,
  withRequest,
  withIdentity,
  correlationHeaders,
} from './correlation';

// ─── Tracing ──────────────────────────────────────────────────────────────────
export {
  type SpanKind,
  type SpanStatus,
  type SpanEvent,
  type Span,
  type SpanExporter,
  type SpanProcessor,
  type StartSpanOptions,
  type StartedSpan,
  type WithSpanOptions,
  InMemorySpanExporter,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  Tracer,
  TracerProvider,
  withSpan,
  withSpanAsync,
  SPAN_NAMES,
  tracerProvider,
  inMemorySpanExporter,
  tracer,
} from './tracing';

// ─── Logger ───────────────────────────────────────────────────────────────────
export {
  type LogLevel,
  type LogEntry,
  type LoggerOptions,
  LogBuffer,
  Logger,
  sharedLogBuffer,
  logger,
  log,
  logAt,
  LOG_LEVELS,
} from './logger';

// ─── Alerts ───────────────────────────────────────────────────────────────────
export {
  type AlertCondition,
  type AlertSeverity,
  type HistogramAspect,
  type AlertRule,
  type Alert,
  AlertManager,
  checkCondition,
  failureRate,
  counterSum,
  STANDARD_ALERT_RULES,
  alertManager,
} from './alerts';

// ─── SLOs ─────────────────────────────────────────────────────────────────────
export {
  type SLO,
  type SLOStatus,
  type ErrorBudgetReport,
  SLOManager,
  counterSumByStatus,
  histogramCountBelow,
  histogramTotalCount,
  STANDARD_SLOS,
  sloManager,
} from './slos';

// ─── Dashboards ───────────────────────────────────────────────────────────────
export {
  type SystemOverview,
  type ConnectorDashboard,
  type ConnectorDashboardRow,
  type SettlementDashboard,
  type SettlementCorridorRow,
  type LPDashboard,
  type LPRow,
  type LPCorridorCapacity,
  type MerchantDashboard,
  type MerchantRow,
  type TreasuryDashboard,
  systemOverview,
  connectorDashboard,
  settlementDashboard,
  lpDashboard,
  merchantDashboard,
  treasuryDashboard,
  allDashboards,
} from './dashboards';

// ─── initOps ───────────────────────────────────────────────────────────────────

import { metricsRegistry } from './metrics';
import { alertManager } from './alerts';
import { sloManager } from './slos';
import { logger } from './logger';
import { eventEngine } from '@/kernel/event';

export interface InitOpsOptions {
  /** Alert evaluation interval (default 30s). */
  alertIntervalMs?: number;
  /** Whether to log alert fires (default true). */
  logAlerts?: boolean;
  /** Whether to subscribe to ops events for logging (default true). */
  logOpsEvents?: boolean;
}

export interface OpsHandle {
  /** Stop the periodic alert evaluator. */
  stop: () => void;
  /** Force an immediate alert evaluation cycle. */
  evaluateNow: () => void;
}

/**
 * Initialize the ops subsystem — starts the periodic alert evaluator
 * (which calls `alertManager.evaluate(metricsRegistry)` on a timer) and
 * optionally subscribes to `ops.*` kernel events for structured logging.
 *
 * Returns a handle with a `stop()` function — call on shutdown to clear
 * the timer. Idempotent — calling `initOps()` again returns a new handle
 * (the caller is responsible for stopping the previous one).
 */
export function initOps(opts: InitOpsOptions = {}): OpsHandle {
  const alertIntervalMs = opts.alertIntervalMs ?? 30_000;
  const logAlerts = opts.logAlerts ?? true;
  const logOpsEvents = opts.logOpsEvents ?? true;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubEvent: (() => void) | undefined;

  const evaluateNow = (): void => {
    try {
      const fired = alertManager.evaluate(metricsRegistry);
      if (logAlerts) {
        for (const a of fired) {
          logger.log(a.severity === 'critical' ? 'error' : a.severity === 'warning' ? 'warn' : 'info',
            `alert fired: ${a.name}`,
            { alertId: a.id, ruleId: a.ruleId, value: a.value, threshold: a.threshold, labels: a.labels },
          );
        }
      }
      // Also evaluate SLOs (no side effects — purely for any internal tracking).
      sloManager.evaluate(metricsRegistry);
    } catch (err) {
      logger.error('ops evaluation error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const tick = (): void => {
    if (stopped) return;
    evaluateNow();
    if (!stopped) timer = setTimeout(tick, alertIntervalMs);
  };

  // Subscribe to ops events for structured logging.
  if (logOpsEvents) {
    unsubEvent = eventEngine.on('ops.', (evt) => {
      logger.info(`ops event: ${evt.type}`, { payload: evt.payload });
    });
  }

  // Fire immediately, then on interval.
  timer = setTimeout(tick, 0);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (unsubEvent) unsubEvent();
    },
    evaluateNow,
  };
}
