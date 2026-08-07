/**
 * PaySwap Protocol — Resilience Module.
 *
 * Protocol-layer resilience primitives — circuit breakers, dedup/idempotency,
 * dead-letter queue, event-replay determinism verification, and an aggregate
 * health check. Built on top of the FROZEN kernel primitives (`@/kernel/event`,
 * `@/kernel/support`, `@/kernel/types`). The kernel is never written to from
 * here.
 *
 * Singletons exported from this barrel:
 *   - `circuitBreakerRegistry` — pre-registered breakers for the six protocol
 *     rails (open_banking, mpesa, fx_rate, stellar_horizon, ethereum_rpc, db).
 *   - `dedupStore`               — in-memory TTL-bounded dedup store.
 *   - `deadLetterQueue`          — in-memory DLQ with replay/discard.
 *   - `eventReplayEngine`        — ledger replay determinism checker.
 *
 * Standalone function:
 *   - `healthCheck()`            — aggregate HealthStatus snapshot.
 */
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  DEFAULT_BREAKER_NAMES,
  DEFAULT_BREAKER_POLICY,
  buildDefaultCircuitBreakerRegistry,
  circuitBreakerRegistry,
} from './circuit-breaker';
export type {
  CircuitState,
  CircuitBreakerOptions,
  CircuitBreakerMetrics,
} from './circuit-breaker';

export {
  DedupStore,
  DEFAULT_DEDUP_TTL_MS,
  dedupStore,
  idempotencyKey,
} from './dedup';
export type { DedupCheckResult } from './dedup';

export {
  DeadLetterQueue,
  deadLetterQueue,
} from './dead-letter';
export type {
  DeadLetterEntry,
  DeadLetterError,
  DeadLetterStatus,
  DeadLetterListFilter,
  DeadLetterPushInput,
} from './dead-letter';

export {
  EventReplayEngine,
  eventReplayEngine,
} from './event-replay';
export type {
  ReplayDeterminismResult,
  ReplayReportResult,
  ReplayError,
} from './event-replay';

export {
  healthCheck,
  DEFAULT_HEALTH_THRESHOLDS,
} from './health-check';
export type {
  OverallHealth,
  ComponentHealth,
  CircuitHealthSummary,
  HealthStatus,
  HealthCheckThresholds,
} from './health-check';
