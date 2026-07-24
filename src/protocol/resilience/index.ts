/**
 * PaySwap Protocol — Resilience / Barrel Export.
 * -----------------------------------------------------------------------------
 * Disaster-recovery infrastructure for the PaySwap protocol layer:
 *
 *   - Circuit breakers       → fast-fail when a connector/service is down
 *   - Outage manager         → declares + resolves outages, fallback strategies
 *   - Partial settlement     → recover half-done settlements (re-route or reverse)
 *   - Dedup store            → idempotency-key store for retry safety
 *   - Dead-letter queue      → persistent store for max-retries-exceeded items
 *   - Event replay engine    → deterministic event-stream replay
 *   - Retry safety policy    → at-most-once-effect retries
 *   - Recovery engine        → rebuild-from-events, snapshot-replay, multi-region readiness
 *   - Health check           → comprehensive health snapshot
 *
 * All code is in `src/protocol/resilience/` — the kernel is FROZEN, no kernel
 * files modified.
 *
 * INVARIANTS:
 *   1. A retried operation NEVER executes its side effect twice
 *      (dedup store guarantees this).
 *   2. A circuit breaker in `open` state rejects immediately
 *      (no upstream call).
 *   3. A partial settlement is either recovered or fully reversed —
 *      never left half-done.
 *   4. Event replay produces identical projections every time (deterministic).
 *   5. DLQ entries are auditable and replayable.
 *
 * Quick start:
 *   import {
 *     circuitBreakerRegistry, outageManager, dedupStore,
 *     deadLetterQueue, eventReplayEngine, recoveryEngine,
 *     healthCheck, safeRetry, partialSettlementRecovery,
 *   } from '@/protocol/resilience';
 */

// ─── Circuit breakers ────────────────────────────────────────────────────────
export {
  CircuitBreaker,
  CircuitBreakerRegistry,
  CircuitOpenError,
  circuitBreakerRegistry,
  DEFAULT_BREAKER_POLICY,
  BREAKER_NAMES,
  type CircuitState,
  type CircuitBreakerOptions,
  type CircuitBreakerMetrics,
} from './circuit-breaker';

// ─── Outage handler ──────────────────────────────────────────────────────────
export {
  OutageManager,
  outageManager,
  fallbackStrategyFor,
  defaultAffectedOperations,
  type OutageType,
  type OutageSeverity,
  type OutageStatus,
  type Outage,
} from './outage-handler';

// ─── Partial settlement recovery ─────────────────────────────────────────────
export {
  PartialSettlementRecovery,
  partialSettlementRecovery,
  type PartialSettlementState,
  type LPAllocation,
  type PartialSettlement,
} from './partial-settlement';

// ─── Dedup store ─────────────────────────────────────────────────────────────
export {
  DedupStore,
  dedupStore,
  idempotencyKey,
  dedupPayment,
  dedupWebhook,
  dedupPayout,
  dedupApiRequest,
  DEFAULT_TTL_MS,
  type DedupScope,
  type DedupKey,
  type DedupCheckResult,
} from './dedup';

// ─── Dead-letter queue ───────────────────────────────────────────────────────
export {
  DeadLetterQueue,
  deadLetterQueue,
  moveToDLQ,
  type DLQQueue,
  type DLQStatus,
  type DLQError,
  type DeadLetterEntry,
  type DLQFilter,
} from './dead-letter';

// ─── Event replay engine ─────────────────────────────────────────────────────
export {
  EventReplayEngine,
  eventReplayEngine,
  type ReplayTargetType,
  type ReplayTarget,
  type ReplayReport,
  type DeterminismResult,
} from './event-replay';

// ─── Retry safety policy ─────────────────────────────────────────────────────
export {
  safeRetry,
  webhookRetrySafety,
  paymentRetrySafety,
  payoutRetrySafety,
  defaultBackoff,
  RETRY_SAFETY_INVARIANT,
  type BackoffFn,
  type SafeRetryOptions,
  type SafeRetryResult,
} from './retry-safety';

// ─── Recovery engine ─────────────────────────────────────────────────────────
export {
  RecoveryEngine,
  recoveryEngine,
  type RecoveryStrategy,
  type RecoveryPlan,
  type RecoveryScenario,
  type RebuildResult,
  type SnapshotReplayResult,
  type BackupBlob,
  type ReadinessChecklistItem,
  type MultiRegionReadiness,
  type DataLossRisk,
} from './recovery';

// ─── Health check ────────────────────────────────────────────────────────────
export {
  healthCheck,
  ping,
  liveness,
  type HealthStatus,
  type ComponentHealth,
} from './health-check';
