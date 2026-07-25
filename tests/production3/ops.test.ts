/**
 * PaySwap PRODUCTION-3 — Tests for Ops Readiness.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - metrics: counter inc, gauge set, histogram observe + percentile
 *   - correlation: withCorrelation propagates across async
 *   - tracing: startSpan → endSpan, linked to correlation
 *   - logger: JSON output with correlation context
 *   - alerts: rule fires when metric exceeds threshold
 *   - SLO: error budget computed
 *
 * Run with:  bun run tests/production3/ops.test.ts
 */

import assert from 'node:assert/strict';
import {
  metricsRegistry,
  Counter,
  Gauge,
  Histogram,
  histogramPercentile,
  labelKey,
  withCorrelation,
  currentCorrelation,
  withSpan,
  withSpanAsync,
  inMemorySpanExporter,
  logger,
  sharedLogBuffer,
  alertManager,
  sloManager,
  STANDARD_ALERT_RULES,
  checkCondition,
} from '@/protocol/ops';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

function resetAll(): void {
  metricsRegistry.reset();
  inMemorySpanExporter.reset();
  sharedLogBuffer.reset();
  alertManager.reset();
  // SLO manager doesn't expose reset; we re-evaluate fresh each test.
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('metrics: Counter inc + get', () => {
  resetAll();
  const c = metricsRegistry.registerCounter('test_counter_total', 'test', ['status']);
  c.inc({ status: 'success' });
  c.inc({ status: 'success' });
  c.inc({ status: 'failed' }, 5);
  assert.equal(c.get({ status: 'success' }), 2);
  assert.equal(c.get({ status: 'failed' }), 5);
  // Negative inc ignored (counters are monotonic).
  c.inc({ status: 'success' }, -1);
  assert.equal(c.get({ status: 'success' }), 2);
});

await run('metrics: Gauge set + inc + dec', () => {
  resetAll();
  const g = metricsRegistry.registerGauge('test_gauge', 'test', ['asset']);
  g.set({ asset: 'XLM' }, 100);
  assert.equal(g.get({ asset: 'XLM' }), 100);
  g.inc({ asset: 'XLM' }, 50);
  assert.equal(g.get({ asset: 'XLM' }), 150);
  g.dec({ asset: 'XLM' }, 30);
  assert.equal(g.get({ asset: 'XLM' }), 120);
});

await run('metrics: Histogram observe + percentile', () => {
  resetAll();
  const h = metricsRegistry.registerHistogram(
    'test_hist', 'test', ['op'],
    [10, 50, 100, 500, 1000],
  );
  for (const v of [5, 15, 75, 200, 800, 950]) h.observe({ op: 'q' }, v);
  const hv = h.get({ op: 'q' })!;
  assert.equal(hv.count, 6);
  assert.equal(hv.sum, 5 + 15 + 75 + 200 + 800 + 950);
  // p50 should be between 75 and 200.
  const p50 = h.percentile({ op: 'q' }, 0.5);
  assert.ok(p50 >= 50 && p50 <= 200, `p50=${p50}`);
  // p99 should be at the high end.
  const p99 = h.percentile({ op: 'q' }, 0.99);
  assert.ok(p99 >= 500, `p99=${p99}`);
});

await run('metrics: histogramPercentile returns 0 for empty histogram', () => {
  const hv = { count: 0, sum: 0, buckets: [{ le: 10, count: 0 }, { le: 100, count: 0 }] };
  assert.equal(histogramPercentile(hv, 0.5), 0);
});

await run('metrics: labelKey canonicalizes labels (sorted, quoted)', () => {
  const k = labelKey(['a', 'b', 'c'], { c: '3', a: '1', b: '2' });
  assert.equal(k, 'a="1",b="2",c="3"');
  const empty = labelKey(['a'], {});
  assert.equal(empty, '');
});

await run('correlation: withCorrelation propagates across async', async () => {
  await withCorrelation({ traceId: 'trace-abc', spanId: 'span-1' }, async () => {
    const ctx = currentCorrelation();
    assert.ok(ctx);
    assert.equal(ctx!.traceId, 'trace-abc');
    assert.equal(ctx!.spanId, 'span-1');
    // Await a microtask — the AsyncLocalStorage must preserve context.
    await new Promise<void>((r) => setImmediate(r));
    const ctx2 = currentCorrelation();
    assert.ok(ctx2);
    assert.equal(ctx2!.traceId, 'trace-abc');
  });
  // Outside withCorrelation → no context.
  const outside = currentCorrelation();
  assert.equal(outside, undefined);
});

await run('correlation: nested withCorrelation inherits traceId + sets parentSpanId', async () => {
  await withCorrelation({ traceId: 'parent-trace', spanId: 'parent-span' }, async () => {
    await withCorrelation({ spanId: 'child-span' }, async () => {
      const ctx = currentCorrelation();
      assert.ok(ctx);
      assert.equal(ctx!.traceId, 'parent-trace'); // inherited
      assert.equal(ctx!.spanId, 'child-span');
      assert.equal(ctx!.parentSpanId, 'parent-span'); // linked
    });
  });
});

await run('tracing: withSpan ends the span + records it in the exporter', async () => {
  resetAll();
  await withSpanAsync('test.span', async () => {
    // Span is active during the function body.
    const ctx = currentCorrelation();
    assert.ok(ctx);
    assert.equal(ctx!.spanId.length, 16); // OTel W3C span-id format
    return 'ok';
  });
  const spans = inMemorySpanExporter.all();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, 'test.span');
  assert.equal(spans[0].status, 'ok');
  assert.ok(spans[0].durationMs !== undefined);
});

await run('tracing: withSpan on error records the exception + status=error', async () => {
  resetAll();
  let caught = false;
  try {
    await withSpanAsync('test.span.error', async () => {
      throw new Error('boom');
    });
  } catch {
    caught = true;
  }
  assert.equal(caught, true);
  const spans = inMemorySpanExporter.all();
  assert.equal(spans.length, 1);
  assert.equal(spans[0].status, 'error');
  assert.ok(spans[0].events.some((e) => e.name === 'exception'));
});

await run('logger: JSON output with correlation context', async () => {
  resetAll();
  await withCorrelation({ traceId: 'trace-xyz', spanId: 'span-xyz' }, async () => {
    logger.info('test message', { field: 'value' });
  });
  const entries = sharedLogBuffer.query({ traceId: 'trace-xyz' });
  assert.ok(entries.length >= 1);
  const e = entries[entries.length - 1];
  assert.equal(e.level, 'info');
  assert.equal(e.msg, 'test message');
  assert.ok(e.correlation);
  assert.equal(e.correlation!.traceId, 'trace-xyz');
  assert.equal(e.fields!.field, 'value');
});

await run('alerts: rule fires when metric exceeds threshold', () => {
  resetAll();
  // Build a custom rule and add it.
  alertManager.addRule({
    id: 'test_rule_high',
    name: 'Test counter > 5',
    metric: 'test_alert_counter',
    condition: 'gt',
    threshold: 5,
    windowMs: 60_000,
    severity: 'warning',
    cooldownMs: 0,
  });
  // Register the metric and push a value > threshold.
  const c = metricsRegistry.registerCounter('test_alert_counter', 'test', ['status']);
  c.inc({ status: 'ok' }, 10);
  const fired = alertManager.evaluate(metricsRegistry);
  assert.ok(fired.length >= 1, 'rule must fire when threshold exceeded');
  const our = fired.find((a) => a.ruleId === 'test_rule_high');
  assert.ok(our);
  assert.equal(our!.severity, 'warning');
  assert.equal(our!.value, 10);
});

await run('alerts: checkCondition helper', () => {
  assert.equal(checkCondition('gt', 10, 5), true);
  assert.equal(checkCondition('gt', 5, 10), false);
  assert.equal(checkCondition('lt', 5, 10), true);
  assert.equal(checkCondition('gte', 10, 10), true);
  assert.equal(checkCondition('lte', 10, 10), true);
  assert.equal(checkCondition('eq', 10, 10), true);
});

await run('alerts: cooldown suppresses repeat fires', () => {
  resetAll();
  alertManager.addRule({
    id: 'cooldown_rule', name: 'Cooldown test', metric: 'cd_metric',
    condition: 'gt', threshold: 1, windowMs: 60_000,
    severity: 'info', cooldownMs: 10_000,
  });
  const c = metricsRegistry.registerCounter('cd_metric', 'test');
  c.inc(undefined, 5);
  const f1 = alertManager.evaluate(metricsRegistry);
  assert.ok(f1.length >= 1);
  // Immediate re-evaluation — should NOT fire again (cooldown).
  const f2 = alertManager.evaluate(metricsRegistry);
  assert.equal(f2.find((a) => a.ruleId === 'cooldown_rule'), undefined);
});

await run('SLO: error budget computed', () => {
  resetAll();
  // Set up the standard payments counter with 99 successes and 1 failure.
  const c = metricsRegistry.getCounter('payswap_payments_total')!;
  c.inc({ status: 'success', currency: 'KES', corridor: 'GHS→KES' }, 99);
  c.inc({ status: 'failed', currency: 'KES', corridor: 'GHS→KES' }, 1);

  const statuses = sloManager.evaluate(metricsRegistry);
  const ss = statuses.find((s) => s.slo.id === 'settlement_success');
  assert.ok(ss);
  // target = 0.999, errorBudget = 0.001, errorRate = 1/100 = 0.01
  assert.equal(ss!.goodCount, 99);
  assert.equal(ss!.totalCount, 100);
  assert.ok(Math.abs(ss!.errorBudget - 0.001) < 1e-9);
  assert.ok(Math.abs(ss!.errorRate - 0.01) < 1e-9);
  // Budget exhausted (0.01 > 0.001) → onTrack = false.
  assert.equal(ss!.onTrack, false);
  assert.ok(ss!.errorBudgetConsumed > 1, 'error budget consumed must be >1 (over)');
});

await run('SLO: error budget report for a specific SLO', () => {
  resetAll();
  const c = metricsRegistry.getCounter('payswap_payouts_total')!;
  c.inc({ method: 'bank', status: 'success' }, 200);
  c.inc({ method: 'bank', status: 'failed' }, 1);
  const report = sloManager.errorBudget('payout_completion', metricsRegistry);
  assert.ok(report);
  assert.equal(report!.sloId, 'payout_completion');
  assert.ok(Math.abs(report!.budget - (1 - 0.995)) < 1e-9);
  assert.ok(report!.consumed > 0);
});

await run('STANDARD_ALERT_RULES includes the 5 critical PaySwap rules', () => {
  const ids = STANDARD_ALERT_RULES.map((r) => r.id);
  assert.ok(ids.includes('settlement_p99_high'));
  assert.ok(ids.includes('connector_error_rate_high'));
  assert.ok(ids.includes('treasury_reserve_ratio_low'));
  assert.ok(ids.includes('lp_active_count_low'));
  assert.ok(ids.includes('webhook_failure_rate_high'));
});

await run('metrics: registry.expose() produces Prometheus text format', () => {
  resetAll();
  const c = metricsRegistry.registerCounter('expose_test', 'help text', []);
  c.inc(undefined, 7);
  const text = metricsRegistry.expose();
  assert.ok(text.includes('# HELP expose_test help text'));
  assert.ok(text.includes('# TYPE expose_test counter'));
  assert.ok(text.includes('expose_test 7'));
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\nops.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
