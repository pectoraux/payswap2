# PaySwap PRODUCTION-3 — Operations Runbook

> For on-call SREs and ops engineers. Tells you what to monitor, what to alert
> on, and how to recover from outages.

## 1. Health check endpoint

```
GET /api/protocol/health
```

Returns a `HealthStatus` snapshot computed synchronously from in-memory state
(no DB / network calls — the check itself can't become a bottleneck):

```json
{
  "overall": "healthy" | "degraded" | "unhealthy",
  "components": [
    { "name": "circuit:open_banking", "healthy": true, "details": "state=closed, failures=0, trips=0" },
    { "name": "connector:mpesa", "healthy": true, "latencyMs": 42 },
    { "name": "dlq", "healthy": true, "details": "empty" },
    { "name": "partial_settlements", "healthy": true, "details": "none" },
    { "name": "ledger:integrity", "healthy": true, "details": "balanced=true, discrepancy=0" }
  ],
  "outages": [],
  "circuits": [{ "name": "open_banking", "state": "closed" }, ...],
  "dlqDepth": 0,
  "partialSettlementsPending": 0,
  "lastCheckTs": 1737000000000
}
```

- **healthy** → all components healthy, no outages, no open circuits, DLQ empty.
- **degraded** → at least one component unhealthy OR an outage active OR a
  circuit open OR DLQ has entries.
- **unhealthy** → multiple components unhealthy OR a `full` outage active.

Kubernetes:
- Liveness probe → `GET /api/protocol/health` returns 200 if `liveness()` is
  true (always, unless the process can't compute health).
- Readiness probe → `GET /api/protocol/health` returns 200 if `ping()` is
  true (overall is `healthy` or `degraded`, NOT `unhealthy`).

## 2. Metrics — what to monitor

All metrics are pre-registered in `src/protocol/ops/metrics.ts` and exposed in
Prometheus text format at `GET /api/metrics`.

| Metric                                  | Type      | Labels                          | Alert threshold |
| --------------------------------------- | --------- | ------------------------------- | --------------- |
| `payswap_payments_total`                | counter   | status, currency, corridor      | failure rate > 0.1% |
| `payswap_payouts_total`                 | counter   | method, status                  | failure rate > 0.5% |
| `payswap_settlement_duration_ms`        | histogram | corridor                        | p99 > 10s       |
| `payswap_planner_latency_ms`            | histogram | (none)                          | p99 > 100ms     |
| `payswap_connector_latency_ms`          | histogram | connector                       | p99 > 1s        |
| `payswap_connector_requests_total`      | counter   | connector, status               | failure rate > 5% |
| `payswap_twin_tokens_supply`            | gauge     | asset                           | (use in dashboards) |
| `payswap_twin_tokens_escrowed`          | gauge     | asset                           | (use in dashboards) |
| `payswap_lp_active_count`               | gauge     | (none)                          | < 3             |
| `payswap_lp_capacity_available`         | gauge     | corridor                        | < 10% of historical avg |
| `payswap_ledger_posted_total`           | counter   | (none)                          | (use in dashboards) |
| `payswap_webhook_deliveries_total`      | counter   | status                          | failure rate > 10% |
| `payswap_treasury_reserve_ratio`        | gauge     | currency                        | < 1.1           |
| `payswap_db_query_duration_ms`          | histogram | (none)                          | p99 > 100ms     |

## 3. SLOs + error budgets

Five SLOs are pre-registered in `src/protocol/ops/slos.ts`. Each SLO has a
target success ratio; the error budget is `1 - target`. `sloManager.evaluate(metricsRegistry)`
returns the current status of every SLO.

| SLO ID                    | Target    | Window | Error budget | Description |
| ------------------------- | --------- | ------ | -----------: | ----------- |
| `settlement_success`      | 99.9%     | 30d    | 0.1%         | Payments must settle successfully |
| `settlement_latency`      | 99%       | 30d    | 1%           | p99 ≤ 5s |
| `connector_availability`  | 99.95%    | 30d    | 0.05%        | Connector requests must succeed (≈4.3m downtime / 30d) |
| `payout_completion`       | 99.5%     | 30d    | 0.5%         | Payouts must complete successfully |
| `webhook_delivery`        | 99%       | 7d     | 1%           | Webhook deliveries must succeed |

### Error budget report

```typescript
import { sloManager, metricsRegistry } from '@/protocol/ops';

const report = sloManager.errorBudget('settlement_success', metricsRegistry);
// {
//   sloId: 'settlement_success',
//   budget: 0.001,
//   consumed: 0.0005,        // current error rate
//   remaining: 0.0005,       // budget - consumed (negative if over)
//   consumedFraction: 0.5,   // 1.0 = exactly exhausted, >1 = over
// }
```

If `consumedFraction > 1`, the SLO is being violated — the budget has been
exhausted. A feature freeze / capacity review may be warranted.

## 4. Alert rules + response procedures

Five alert rules are pre-registered in `src/protocol/ops/alerts.ts`:

| Rule ID                       | Severity  | Condition                                            | Runbook |
| ----------------------------- | --------- | ---------------------------------------------------- | ------- |
| `settlement_p99_high`         | warning   | `payswap_settlement_duration_ms` p99 > 10s           | `r/settlement-p99` |
| `connector_error_rate_high`   | critical  | `payswap_connector_requests_total` failure rate > 5% | `r/connector-errors` |
| `treasury_reserve_ratio_low`  | critical  | `payswap_treasury_reserve_ratio` < 1.1 for any ccy   | `r/reserve-ratio` |
| `lp_active_count_low`         | warning   | `payswap_lp_active_count` < 3                        | `r/lp-count` |
| `webhook_failure_rate_high`   | critical  | `payswap_webhook_deliveries_total` failure rate > 10%| `r/webhook-failures` |

The alert manager evaluates every rule against the live metrics on a 30-second
timer (started by `initOps()`). Each fire emits an `ops.alert_fired` kernel
event. Per-rule cooldown prevents flapping (default 5 minutes).

### Response procedure: `connector_error_rate_high` (critical)

1. **Acknowledge** the page within 5 minutes.
2. **Identify the failing connector** via `payswap_connector_requests_total{status=~"failed|error"}`
   in Prometheus.
3. **Check the circuit breaker state** for that connector — if `open`, the
   system is already protecting itself (no upstream calls). Wait for it to
   transition to `half_open` and either close (recovered) or re-trip (still
   failing).
4. **Check the DLQ** for entries from that connector — `deadLetterQueue.list({ queue: 'connector' })`.
   Replay any entries that are still `pending_review` after the connector recovers.
5. **Check the upstream status page** — Open Banking / M-Pesa / Infura /
   Stellar / OpenExchangeRates.
6. **If the upstream is down**, declare an outage via `outageManager.declare('connector', connectorId, 'partial')`.
   The fallback strategy (`fallbackStrategyFor('connector')`) is:
   "cached evidence + queue" — keep serving cached responses and queue new
   requests to the DLQ for replay after recovery.
7. **Resolve** the alert in `alertManager` once the failure rate drops below 5%
   for 5 minutes.

### Response procedure: `treasury_reserve_ratio_low` (critical)

1. **Acknowledge** immediately — this is the highest-severity alert.
2. **Identify the currency** — `payswap_treasury_reserve_ratio{currency=...}` < 1.1.
3. **Check the reserve monitor** — `reserveMonitor.getReserve(currency)` shows
   balance, reserved, available.
4. **Two recovery options**:
   a. **Add reserve** — call `reserveMonitor.setReserve(currency, newBalance, reserved)`
      with the new bank balance (after wire-transfer in).
   b. **Halt mints** — `emergencyFreezeEngine.freezeAsset('TWIN' + currency, 'reserve low', 'ops')`.
      This blocks all mints (and transfers) for that asset until the reserve
      is replenished.
5. **Investigate root cause** — was there a sudden surge in mints (limit bypass)?
   A failed bank sync? A mis-configured `lowReserveThresholds`?
6. **Resolve** the alert once ratio >= 1.1.

### Response procedure: `lp_active_count_low` (warning)

1. **Check `liquidityNetwork.networkStatus()`** — see which LPs are unhealthy
   or paused.
2. **For each unhealthy LP**, check `lpHealthMonitor.getHealth(lpId)` — if
   `consecutiveFailures >= 3`, the LP needs investigation. Contact the LP
   directly (out-of-band).
3. **For each paused LP**, check whether the pause was operator-initiated
   (`liquidityNetwork.pauseLP(...)`) or automatic. If automatic (e.g. the LP
   failed health probes), try `liquidityNetwork.resumeLP(lpId)` after
   confirming the LP is healthy.
4. **Add a backup LP** — `liquidityNetwork.registerLP(...)` for a new LP that
   serves the same corridor.

### Response procedure: `webhook_failure_rate_high` (critical)

1. **Check `webhooks/engine.ts`** for retry attempts + DLQ entries.
2. **Identify the failing endpoint** — likely a single merchant's webhook URL
   is 5xx'ing.
3. **Pause webhooks to that endpoint** — `webhookEngine.pauseEndpoint(endpointId)`.
4. **Notify the merchant** via the dashboard banner + email.
5. **Replay DLQ entries** after the merchant fixes their endpoint.

## 5. Disaster recovery

### Circuit breaker states

Pre-configured breakers (one per connector + `stellar_settlement` + `db`):

```
closed    → open       (failures in window ≥ threshold, default 5 in 60s)
open      → half_open  (cooldownMs elapsed, default 30s)
half_open → open       (any trial failure)
half_open → closed     (successThresholdToClose consecutive successes, default 2)
```

State transitions emit `resilience.circuit_open` / `circuit_half_open` /
`resilience.circuit_closed` events.

### DLQ replay

When a queue item (webhook, payment, payout, settlement, connector) has been
retried up to its max-attempts limit and still fails, it's moved to the DLQ:

```typescript
import { deadLetterQueue } from '@/protocol/resilience';

// List pending-review entries.
const entries = deadLetterQueue.list({ status: 'pending_review' });

// Replay a single entry.
await deadLetterQueue.replay(entry.id, async (entry) => {
  // Re-enqueue the payload via the appropriate service.
  await webhookEngine.redeliver(entry.payload);
  return true; // success
});

// Bulk-replay all pending entries for a queue.
const result = await deadLetterQueue.replayAll('webhook', async (entry) => {
  await webhookEngine.redeliver(entry.payload);
  return true;
});
// { attempted: 5, succeeded: 4, failed: 1 }

// Permanently discard an entry (audit-logged).
deadLetterQueue.discard(entry.id, 'duplicate event');
```

### Event rebuild procedure (db corruption)

When the DB is corrupted, the entire state can be rebuilt from the event
stream:

```typescript
import { recoveryEngine } from '@/protocol/resilience';

const plan = recoveryEngine.planFor('db_corruption');
console.log(plan.strategy);        // 'event_sourced_rebuild'
console.log(plan.steps);           // 10 steps
console.log(plan.dataLossRisk);    // 'none' (event-sourced)

const result = await recoveryEngine.executeRebuildFromEvents({
  // rebuildFns: map of module name → rebuild function
  ledger: (events) => rebuildLedgerFromEvents(events),
  // twin-token balances, merchant state, LP state — same pattern.
});
// { success: true, rebuiltModules: ['ledger'], durationMs: 4200, eventCount: 1_000_000, errors: [] }
```

The rebuild is **deterministic** — replaying the same events through the same
projection always produces byte-identical state. Verify with
`eventReplayEngine.verifyReplayDeterminism(...)`.

### Snapshot-replay procedure (partial state loss)

When a single projection is corrupted (but the DB is fine), restore from the
nearest snapshot + replay post-snapshot events:

```typescript
import { recoveryEngine } from '@/protocol/resilience';

const plan = recoveryEngine.planFor('partial_state_loss');
console.log(plan.strategy);    // 'snapshot_replay'
console.log(plan.estimatedRecoveryMs);  // 60_000 (1 minute)

const result = await recoveryEngine.executeSnapshotReplay(
  targetTs,
  ['ledger'], // modules to rebuild
  // rebuildFns
);
// { success: true, usedSnapshotTs, replayedEventCount, ... }
```

### Multi-region failover (region loss)

```typescript
const plan = recoveryEngine.planFor('region_loss');
console.log(plan.strategy);    // 'multi_region_failover'
console.log(plan.dataLossRisk); // 'minimal' (cross-region replication lag)
console.log(plan.prerequisites);
// [
//   'Multi-region replication is configured + verified.',
//   'DNS TTL is < 60s (otherwise failover is delayed by TTL).',
//   'Failover runbook is tested (game-day exercises).',
//   'Cross-region replication lag is monitored + alerting.',
// ]
```

Steps:
1. Declare region outage: `outageManager.declare('region', regionName, 'full')`.
2. Update DNS to point at the failover region.
3. Wait for cross-region replication to catch up.
4. Promote failover region to primary.
5. Drain queued operations from the DLQ.
6. When the failed region recovers, demote it to secondary (do NOT auto-promote).

### Multi-region readiness checklist

```typescript
import { recoveryEngine } from '@/protocol/resilience';

const readiness = recoveryEngine.assessMultiRegionReadiness();
// {
//   overall: 'partial',
//   items: [
//     { name: 'replication_lag', status: 'ready', details: 'lag < 1s' },
//     { name: 'dns_ttl', status: 'ready', details: 'TTL=30s' },
//     { name: 'failover_tested', status: 'not_ready', details: 'last test 90d ago' },
//     ...
//   ],
//   readyCount: 3,
//   totalCount: 5,
// }
```

## 6. Security operations

### JWT rotation

JWTs are signed with HS256 + a `kid` (key id) header. Rotation:
1. Generate a new signing secret.
2. Call `jwtService.rotateSigningSecret()` — current demotes to previous,
   still valid for verification during the 24h overlap window.
3. After 24h, the previous secret is dropped automatically.
4. Emits `security.jwt_rotated` event.

```typescript
import { jwtService } from '@/protocol/security';
const { oldKid, newKid } = jwtService.rotateSigningSecret();
```

### Secret rotation

Secrets are stored in the AES-256-GCM `SecretsVault`. Rotation:
1. Generate a new 32-byte master key.
2. Call `vault.rotateMasterKey(newKey)` — re-encrypts every secret under the
   new key + wipes the old key from memory.
3. Persist the new master key in your external secrets manager (AWS Secrets
   Manager, Vault, etc.).

```typescript
import { secretsVault } from '@/protocol/security';
import { randomBytes } from 'node:crypto';
const newKey = randomBytes(32);
const reEncryptedCount = secretsVault.rotateMasterKey(newKey);
```

For backup/restore:
```typescript
const blob = secretsVault.exportEncrypted();           // JSON blob
const restored = new SecretsVault({ masterKey: newKey });
restored.importEncrypted(blob, newKey);                // restores all secrets
```

### Emergency freeze procedure

Use when a Twin Token asset must be halted immediately (e.g. compliance
investigation, exploit response):

```typescript
import { treasuryEngine } from '@/protocol/treasury-v2';

// Freeze the asset — blocks all mints, burns, transfers.
treasuryEngine.freezeAsset('TWINGHS', 'SEC investigation #1234', 'oncall-user');

// ... later, after the investigation concludes ...
const freezes = treasuryEngine.getEmergencyFreezeEngine().activeFreezes();
const freeze = freezes.find((f) => f.scope === 'asset' && f.target === 'TWINGHS');
if (freeze) treasuryEngine.liftFreeze(freeze.id);
```

Every freeze / lift emits a `treasury.freeze_triggered` /
`treasury.freeze_lifted` event with the initiator + reason — fully auditable.

For finer-grained control, the freeze engine supports three scopes:
- `account` — freezes a single Twin Token holder (calls
  `twinTokenEngine.freezeAccount(accountId)`).
- `asset` — halts ALL mint/burn/transfer for the asset.
- `corridor` — halts routing through a corridor (the corridor balancer checks
  `isFrozen('corridor', corridorKey)`).

## 7. Audit log queries

The security audit log is a ring buffer (last 50k events) + a kernel event
stream. Query it via:

```typescript
import { auditLog } from '@/protocol/security';

// All denied actions in the last hour.
const denied = auditLog.query({
  result: 'denied',
  since: Date.now() - 3_600_000,
});

// All actions by a specific user.
const byUser = auditLog.query({ actorId: 'user-123' });

// All treasury freeze actions.
const freezes = auditLog.query({ action: 'treasury.freeze' });

// All actions on a specific resource.
const byResource = auditLog.query({ resourceType: 'payment', resourceId: 'pay-abc' });
```

The audit log captures: WHO (actor + role + scopes + ip), WHAT (action), WHICH
(resource type + id), RESULT (success / denied / error), WHEN (ts), TRACE
(correlation traceId + spanId for cross-service tracing), DETAILS (structured
fields, PII minimized).

## 8. Periodic background jobs

Started by `initOps()` (default intervals shown):

| Job                    | Interval | Description |
| ---------------------- | -------- | ----------- |
| Alert evaluator        | 30s      | Evaluates every `AlertRule` against the metrics registry |
| Treasury reserve sync  | 60s      | Pulls on-chain reserve balances via the Stellar adapter |
| Treasury backing verify| 30s      | Verifies every Twin Token asset is fully backed |
| Treasury alert check   | 30s      | Checks reserves, backing, corridors against thresholds |
| Treasury corridor balance | 60s   | Rebalances over-reserved corridors to under-reserved ones |
| Treasury freeze sweep  | 60s      | Lifts expired temporary freezes |
| LP capacity sweep      | on access| Lazy-evicts expired capacity reservations |
| Health monitor probe   | 30s      | Periodic connector healthCheck() |

```typescript
import { initOps } from '@/protocol/ops';
const stop = initOps({ alertIntervalMs: 30_000 });
// ... on shutdown:
stop();
```

## 9. Useful dashboards

The `dashboards.ts` module in `src/protocol/ops/` exposes 7 dashboard
aggregators that return JSON-serializable payloads:

- `systemOverview()` — overall health + key counters
- `connectorDashboard()` — per-connector health + latency + error rate
- `settlementDashboard()` — per-corridor settlement volume + p99
- `lpDashboard()` — per-LP capacity, reputation, score
- `merchantDashboard(merchantId?)` — per-merchant payment/payout volume + errors
- `treasuryDashboard()` — reserves, backing ratios, alerts, frozen assets
- `allDashboards()` — every dashboard + Prometheus exposition in one payload

These are suitable for direct return from Next.js route handlers
(`/api/protocol/dashboard/<name>`).
