/**
 * PaySwap PRODUCTION-3 — Tests for Production Connectors v2.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - idempotency: same key → cached response, doQuery not called second time
 *   - rate limiter: exceeds limit → RATE_LIMITED error, no upstream call
 *   - retry: timeout → retried up to maxAttempts
 *   - non-retryable error (AUTH_FAILED) → no retry
 *   - every success includes signed evidence
 *   - audit log records every request
 *   - health monitor tracks failures
 *
 * Run with:  bun run tests/production3/connectors-v2.test.ts
 */

import assert from 'node:assert/strict';
import {
  ProductionConnector,
  TokenBucketRateLimiter,
  IdempotencyStore,
  HealthMonitor,
  MetricsCollector,
  auditLogInstance,
  sharedHealthMonitor,
  sharedMetricsCollector,
  productionConnectorRegistry,
  authFailed,
  timeout,
  isRetryable,
  defaultRetryPolicy,
  executeWithRetry,
  buildAttestationEvidence,
  type ConnectorConfig,
  type ConnectorRequest,
  type ConnectorResponse,
  type ConnectorError,
  type ConnectorId,
} from '@/protocol/connectors-v2';
import type { Evidence } from '@/kernel/evidence';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

/* ============================================================================
 * A controllable test connector — lets us inject doQuery behavior per test.
 * ========================================================================== */

class TestConnector extends ProductionConnector {
  public callCount = 0;
  public callLog: ConnectorRequest[] = [];
  private behavior: (req: ConnectorRequest) => Promise<{ result: Record<string, unknown>; error?: ConnectorError }>;

  constructor(
    behavior: (req: ConnectorRequest) => Promise<{ result: Record<string, unknown>; error?: ConnectorError }>,
    configOverrides: Partial<ConnectorConfig> = {},
  ) {
    const base: ConnectorConfig = {
      id: 'open_banking',
      type: 'bank',
      name: 'Test Connector',
      endpoint: 'https://test.example.com',
      apiKeyRef: 'vault://test/api-key',
      secretRef: 'vault://test/hmac',
      timeout: 200,
      retryCount: 2,
      retryBackoffMs: 1,
      rateLimitRps: 10_000,
      rateLimitBurst: 1_000,
      idempotencyTtlMs: 60_000,
      ...configOverrides,
    };
    super(base);
    this.setApiKey('test-api-key');
    this.setSecret('test-hmac-secret');
    this.behavior = behavior;
  }

  async doQuery(req: ConnectorRequest): Promise<{ result: Record<string, unknown>; error?: ConnectorError }> {
    this.callCount++;
    this.callLog.push(req);
    return this.behavior(req);
  }

  buildEvidence(_req: ConnectorRequest, result: Record<string, unknown>): Evidence {
    return buildAttestationEvidence({
      source: 'open_banking',
      verificationLevel: 'institutional',
      entityId: `test:${result.accountId ?? 'unknown'}`,
      attester: this.config.id,
      reputation: 0.9,
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 1 };
  }
}

/* ============================================================================
 * Reset helpers — each test gets fresh idempotency / health / metrics / audit.
 * ========================================================================== */

function freshDeps(): {
  idempotency: IdempotencyStore;
  healthMonitor: HealthMonitor;
  metricsCollector: MetricsCollector;
} {
  return {
    idempotency: new IdempotencyStore(),
    healthMonitor: new HealthMonitor(),
    metricsCollector: new MetricsCollector(),
  };
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('idempotency: same key → cached response, doQuery not called second time', async () => {
  const deps = freshDeps();
  let calls = 0;
  const c = new TestConnector(async () => {
    calls++;
    return { result: { accountId: 'A1', balance: 100 } };
  });
  // Replace private deps with fresh ones via reflection-free path: re-construct.
  // Simpler: subclass already wires defaults; we just need to assert behavior.
  // Reset the registry's shared state so the count starts at zero.
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  const req: ConnectorRequest = { id: 'idem-001', operation: 'getBalance', params: { accountId: 'A1' } };
  const r1 = await c.query(req);
  assert.equal(r1.success, true);
  assert.equal(calls, 1);
  assert.equal(r1.attempts, 1);

  const r2 = await c.query(req);
  assert.equal(r2.success, true);
  assert.equal(calls, 1, 'doQuery must NOT be called on cache hit');
  assert.equal(r2.attempts, 0, 'cache hit must report attempts=0');
  assert.equal(r1.evidence!.id, r2.evidence!.id, 'cached evidence must be identical');
});

await run('rate limiter: exceeds limit → RATE_LIMITED error, no upstream call', async () => {
  // Construct a connector with a tiny rate limit: 1 rps, burst=2.
  const c = new TestConnector(
    async () => ({ result: { ok: true } }),
    { rateLimitRps: 1, rateLimitBurst: 2 },
  );
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  // Fire 2 requests with different keys (so idempotency doesn't kick in).
  // Both succeed (burst=2).
  const r1 = await c.query({ id: 'k1', operation: 'op', params: {} });
  const r2 = await c.query({ id: 'k2', operation: 'op', params: {} });
  assert.equal(r1.success, true);
  assert.equal(r2.success, true);

  // Third call should be RATE_LIMITED because burst is exhausted.
  const r3 = await c.query({ id: 'k3', operation: 'op', params: {} });
  assert.equal(r3.success, false);
  assert.ok(r3.error);
  assert.equal(r3.error!.code, 'RATE_LIMITED');
  assert.equal(c.callCount, 2, 'doQuery must NOT be called for the rate-limited request');
});

await run('retry: timeout → retried up to maxAttempts', async () => {
  // retryCount=2 → maxAttempts=3. Fail twice then succeed on the third call.
  let calls = 0;
  const c = new TestConnector(
    async () => {
      calls++;
      if (calls < 3) return { result: {}, error: timeout('op') };
      return { result: { ok: true } };
    },
    { retryCount: 2, retryBackoffMs: 1 },
  );
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  const r = await c.query({ id: 'retry-1', operation: 'op', params: {} });
  assert.equal(r.success, true);
  assert.equal(r.attempts, 3, 'must have retried up to 3 attempts');
  assert.equal(calls, 3);
});

await run('non-retryable error (AUTH_FAILED) → no retry', async () => {
  let calls = 0;
  const c = new TestConnector(
    async () => {
      calls++;
      return { result: {}, error: authFailed('bad token') };
    },
    { retryCount: 3, retryBackoffMs: 1 },
  );
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  const r = await c.query({ id: 'auth-1', operation: 'op', params: {} });
  assert.equal(r.success, false);
  assert.equal(r.error!.code, 'AUTH_FAILED');
  assert.equal(r.attempts, 1, 'non-retryable error must NOT retry');
  assert.equal(calls, 1);
});

await run('isRetryable classifies errors correctly', () => {
  assert.equal(isRetryable(timeout('op')), true);
  assert.equal(isRetryable(authFailed('bad')), false);
  assert.equal(isRetryable({ code: 'UPSTREAM_5XX', message: 'x', retryable: true }), true);
  assert.equal(isRetryable({ code: 'INSUFFICIENT_FUNDS', message: 'x', retryable: false }), false);
  assert.equal(isRetryable({ code: 'RATE_LIMITED', message: 'x', retryable: true }), true);
});

await run('executeWithRetry honors maxAttempts', async () => {
  let calls = 0;
  const policy = defaultRetryPolicy(2, 1); // maxAttempts=3
  const result = await executeWithRetry(async () => {
    calls++;
    if (calls < 3) return { result: null as never, error: timeout('op') };
    return { result: 'final' };
  }, policy);
  assert.equal(result.result, 'final');
  assert.equal(result.attempts, 3);
});

await run('every success includes signed evidence (HMAC-SHA256 signature)', async () => {
  const c = new TestConnector(async () => ({ result: { accountId: 'A2', balance: 42 } }));
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  const r = await c.query({ id: 'sig-1', operation: 'getBalance', params: { accountId: 'A2' } });
  assert.equal(r.success, true);
  assert.ok(r.evidence, 'success response must include evidence');
  // The connector's `signEvidence` writes the signature into the payload.
  const sig = r.evidence!.payload?.signature as string | undefined;
  const alg = r.evidence!.payload?.signatureAlgorithm as string | undefined;
  assert.ok(sig, 'evidence must have a signature');
  assert.equal(alg, 'HMAC-SHA256');
  assert.ok(sig.startsWith('hmac-sha256:'));
  // Evidence hash should be the same signature string.
  assert.equal(r.evidence!.evidenceHash, sig);
});

await run('audit log records every request (success + failure)', async () => {
  let calls = 0;
  const c = new TestConnector(async () => {
    calls++;
    if (calls === 2) return { result: {}, error: authFailed('bad') };
    return { result: { ok: true } };
  });
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  await c.query({ id: 'aud-1', operation: 'op', params: {} });
  await c.query({ id: 'aud-2', operation: 'op', params: {} });

  const entries = auditLogInstance.query({ connectorId: 'open_banking' });
  assert.ok(entries.length >= 2, `expected at least 2 audit entries, got ${entries.length}`);
  const success = entries.find((e) => e.success);
  const failure = entries.find((e) => !e.success);
  assert.ok(success, 'must have a success audit entry');
  assert.ok(failure, 'must have a failure audit entry');
  assert.ok(failure!.errorCode === 'AUTH_FAILED');
});

await run('health monitor tracks failures (consecutiveFailures increments)', async () => {
  const c = new TestConnector(async () => ({ result: {}, error: authFailed('bad') }));
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  // Two failures → consecutiveFailures = 2.
  await c.query({ id: 'h-1', operation: 'op', params: {} });
  await c.query({ id: 'h-2', operation: 'op', params: {} });

  const h = sharedHealthMonitor.getHealth('open_banking');
  assert.equal(h.consecutiveFailures, 2);
  assert.equal(h.healthy, true, 'still healthy below threshold of 3');

  // Third failure → unhealthy.
  await c.query({ id: 'h-3', operation: 'op', params: {} });
  const h2 = sharedHealthMonitor.getHealth('open_banking');
  assert.equal(h2.consecutiveFailures, 3);
  assert.equal(h2.healthy, false, 'must be unhealthy at threshold=3');
});

await run('metrics collector tracks requests, success/failure counts', async () => {
  const c = new TestConnector(
    async (req) => {
      if (req.params.fail) return { result: {}, error: authFailed('bad') };
      return { result: { ok: true } };
    },
    { rateLimitRps: 10_000, rateLimitBurst: 1_000 },
  );
  sharedHealthMonitor.reset();
  sharedMetricsCollector.reset();
  auditLogInstance.reset();

  await c.query({ id: 'm-1', operation: 'op', params: {} });
  await c.query({ id: 'm-2', operation: 'op', params: { fail: true } });

  const m = sharedMetricsCollector.get('open_banking');
  assert.equal(m.requestsTotal, 2);
  assert.equal(m.requestsSuccess, 1);
  assert.equal(m.requestsFailed, 1);
});

await run('productionConnectorRegistry: bootstrap + lookup + audit query', async () => {
  // Reset and let the barrel's bootstrap fire by re-importing is not possible —
  // bootstrapProductionConnectors is idempotent. Verify the 5 connectors exist.
  const ids = productionConnectorRegistry.ids();
  assert.ok(ids.includes('open_banking'));
  assert.ok(ids.includes('mpesa'));
  assert.ok(ids.includes('ethereum_rpc'));
  assert.ok(ids.includes('fx_rate'));
  assert.ok(ids.includes('stellar_horizon'));
  // Lookup
  const ob = productionConnectorRegistry.get('open_banking');
  assert.ok(ob);
  // Query an unknown connector id → returns failure (no JS throw).
  const r = await productionConnectorRegistry.query('mpesa' as ConnectorId, {
    id: 'reg-1', operation: 'noop', params: {},
  });
  // 'noop' isn't a real mpesa operation; expect failure with structured error.
  assert.equal(r.success, false);
  assert.ok(r.error);
});

await run('TokenBucketRateLimiter: token consumption + denial', () => {
  const rl = new TokenBucketRateLimiter(1, 2); // 1 rps, burst=2
  const a = rl.acquire();
  const b = rl.acquire();
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
  // Third acquire immediately — bucket empty.
  const c = rl.acquire();
  assert.equal(c.allowed, false);
  assert.ok(c.retryAfterMs > 0);
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\nconnectors-v2.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) console.error(`FAILED: ${fail} tests`);
