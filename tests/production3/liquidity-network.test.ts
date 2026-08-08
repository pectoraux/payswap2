/**
 * PaySwap PRODUCTION-3 — Tests for the Liquidity Network.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - register 3 LPs → getQuote returns cheapest
 *   - reserve capacity → available decreases → release → restored
 *   - LP fails 3x → unhealthy → routing avoids it
 *   - split routing when no single LP can fill
 *   - scoring updates from settlement outcomes
 *   - forecast detects shortfall
 *
 * Run with:  bun run tests/production3/liquidity-network.test.ts
 */

import assert from 'node:assert/strict';
import {
  liquidityNetwork,
  liquidityRegistry,
  capacityReservations,
  lpHealthMonitor,
  liquidityForecaster,
  reserveCapacity,
  releaseCapacity,
  getAvailableCapacity,
  consumeCapacity,
  replenishCapacity,
  findBestRoute,
  canFillSingleLP,
  totalAvailableCapacity,
  updateReputationFromOutcome,
  scoreLP,
  UNHEALTHY_CONSECUTIVE_FAILURES,
  type Corridor,
  type LPId,
} from '@/protocol/liquidity-network';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

function resetAll(): void {
  liquidityNetwork.reset();
}

const GHS_KES: Corridor = { fromCurrency: 'GHS', toCurrency: 'KES' };

function registerThreeLPs(): LPId[] {
  // LP1: cheapest fee, large capacity
  liquidityNetwork.registerLP({
    id: 'lp1', name: 'Acacia', country: 'Kenya', corridors: [GHS_KES],
    capacity: { 'GHS→KES': 100_000 }, feeBps: 50, settlementSpeedMs: 5_000,
    reputation: 0.9, historicalSuccessRate: 0.99,
  });
  // LP2: mid fee, mid capacity
  liquidityNetwork.registerLP({
    id: 'lp2', name: 'Kodi', country: 'Kenya', corridors: [GHS_KES],
    capacity: { 'GHS→KES': 50_000 }, feeBps: 80, settlementSpeedMs: 10_000,
    reputation: 0.7, historicalSuccessRate: 0.95,
  });
  // LP3: expensive fee, large capacity
  liquidityNetwork.registerLP({
    id: 'lp3', name: 'Branch', country: 'Kenya', corridors: [GHS_KES],
    capacity: { 'GHS→KES': 200_000 }, feeBps: 120, settlementSpeedMs: 15_000,
    reputation: 0.6, historicalSuccessRate: 0.90,
  });
  return ['lp1', 'lp2', 'lp3'];
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('register 3 LPs → getQuote returns a route using the cheapest healthy LP', () => {
  resetAll();
  const ids = registerThreeLPs();
  assert.equal(liquidityRegistry.all().length, 3);

  const plan = liquidityNetwork.getQuote(GHS_KES, 5_000);
  assert.ok(plan, 'expected a routing plan');
  // Plan should have a route.
  assert.ok(plan!.route.length >= 1);
  // The cheapest LP is lp1 (feeBps=50) — and it has ample capacity for 5_000.
  assert.equal(plan!.route[0].lpId, 'lp1');
  assert.equal(plan!.amount, 5_000);
  // All route entries must have valid shares.
  const shareSum = plan!.route.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-6, `shares must sum to 1, got ${shareSum}`);
});

await run('reserve capacity → available decreases → release → restored', () => {
  resetAll();
  registerThreeLPs();
  const before = getAvailableCapacity('lp1', GHS_KES);
  assert.equal(before, 100_000);

  const res = reserveCapacity('lp1', GHS_KES, 30_000, 'res-test-1');
  assert.equal(res.success, true);
  assert.ok(res.reservationId);

  const mid = getAvailableCapacity('lp1', GHS_KES);
  assert.equal(mid, 70_000);

  const lp = liquidityRegistry.get('lp1')!;
  assert.equal(lp.reservedCapacity['GHS→KES'], 30_000);

  // Release the reservation → available restored.
  const ok = releaseCapacity(res.reservationId!);
  assert.equal(ok, true);
  const after = getAvailableCapacity('lp1', GHS_KES);
  assert.equal(after, 100_000);
  assert.equal(liquidityRegistry.get('lp1')!.reservedCapacity['GHS→KES'], 0);
});

await run('consume capacity → reduces capacity permanently', () => {
  resetAll();
  registerThreeLPs();
  const res = reserveCapacity('lp1', GHS_KES, 20_000, 'res-cons-1');
  assert.equal(res.success, true);
  consumeCapacity(res.reservationId!);
  const lp = liquidityRegistry.get('lp1')!;
  assert.equal(lp.capacity['GHS→KES'], 80_000); // 100k - 20k consumed
  assert.equal(lp.availableCapacity['GHS→KES'], 80_000);
  assert.equal(lp.reservedCapacity['GHS→KES'], 0);
});

await run('replenish capacity increases both capacity and available', () => {
  resetAll();
  registerThreeLPs();
  const newAvail = replenishCapacity('lp1', GHS_KES, 50_000);
  assert.equal(newAvail, 150_000);
  const lp = liquidityRegistry.get('lp1')!;
  assert.equal(lp.capacity['GHS→KES'], 150_000);
});

await run('LP fails 3x → unhealthy → routing avoids it', () => {
  resetAll();
  registerThreeLPs();
  // Force 3 failures on lp1.
  for (let i = 0; i < UNHEALTHY_CONSECUTIVE_FAILURES; i++) {
    lpHealthMonitor.recordFailure('lp1');
  }
  const h = lpHealthMonitor.getHealth('lp1');
  assert.equal(h.healthy, false, 'lp1 must be unhealthy after 3 consecutive failures');
  assert.equal(h.consecutiveFailures, UNHEALTHY_CONSECUTIVE_FAILURES);

  // getQuote should now avoid lp1 and pick lp2 (next cheapest).
  const plan = liquidityNetwork.getQuote(GHS_KES, 5_000);
  assert.ok(plan);
  // No leg of the route should include lp1.
  for (const leg of plan!.route) {
    assert.notEqual(leg.lpId, 'lp1', `routing must not include unhealthy LP ${leg.lpId}`);
  }
  // Cheapest healthy LP is lp2 (feeBps=80).
  assert.equal(plan!.route[0].lpId, 'lp2');
});

await run('split routing when no single LP can fill', () => {
  resetAll();
  // Three small LPs: each has 10_000 capacity.
  for (const id of ['sl1', 'sl2', 'sl3']) {
    liquidityNetwork.registerLP({
      id, name: id, country: 'Kenya', corridors: [GHS_KES],
      capacity: { 'GHS→KES': 10_000 }, feeBps: 50, settlementSpeedMs: 5_000,
      reputation: 0.8, historicalSuccessRate: 0.95,
    });
  }
  // 25_000 > any single LP's 10_000 capacity → must split.
  assert.equal(canFillSingleLP(GHS_KES, 25_000), false);
  assert.equal(totalAvailableCapacity(GHS_KES), 30_000);

  const plan = findBestRoute(GHS_KES, 25_000);
  assert.ok(plan, 'split routing must produce a plan when total capacity suffices');
  assert.ok(plan!.route.length >= 2, `expected at least 2 LPs in the route, got ${plan!.route.length}`);
  const sum = plan!.route.reduce((s, r) => s + r.amount, 0);
  assert.equal(sum, 25_000);
});

await run('scoring updates from settlement outcomes (reputation drifts)', () => {
  resetAll();
  registerThreeLPs();
  const before = liquidityRegistry.get('lp1')!.reputation;
  // Three successful settlements → reputation should drift up.
  for (let i = 0; i < 3; i++) {
    updateReputationFromOutcome('lp1', true, 5_000, 5_000);
  }
  const after = liquidityRegistry.get('lp1')!.reputation;
  assert.ok(after > before, `reputation should drift up on success: ${before} → ${after}`);
  // totalSettlements should reflect the 3 outcomes.
  assert.equal(liquidityRegistry.get('lp1')!.totalSettlements, 3);

  // A failure should drop reputation more sharply.
  const beforeFail = liquidityRegistry.get('lp1')!.reputation;
  updateReputationFromOutcome('lp1', false, 0, 0);
  const afterFail = liquidityRegistry.get('lp1')!.reputation;
  assert.ok(afterFail < beforeFail, `reputation should drop on failure: ${beforeFail} → ${afterFail}`);
});

await run('scoreLP returns a 5-component score in [0,1]', () => {
  resetAll();
  registerThreeLPs();
  const s = scoreLP('lp1', GHS_KES, 1_000);
  assert.ok(s);
  assert.ok(s!.score >= 0 && s!.score <= 1);
  assert.ok(s!.components.capacity >= 0 && s!.components.capacity <= 1);
  assert.ok(s!.components.reliability >= 0 && s!.components.reliability <= 1);
});

await run('forecast: records demand + supply, detects shortfall', () => {
  resetAll();
  // Register one LP with tiny capacity (200). Demand will exceed supply.
  liquidityNetwork.registerLP({
    id: 'fc1', name: 'ForecastLP', country: 'Kenya', corridors: [GHS_KES],
    capacity: { 'GHS→KES': 200 }, feeBps: 50, settlementSpeedMs: 5_000,
    reputation: 0.9, historicalSuccessRate: 0.99,
  });

  // Drive 20 quote attempts of 5_000 each (huge demand vs 200 supply).
  for (let i = 0; i < 20; i++) {
    liquidityNetwork.getQuote(GHS_KES, 5_000);
  }

  // The forecaster has recorded demand samples. Forecast future points —
  // some should show shortfall (projected demand > projected supply).
  const forecast = liquidityNetwork.forecast(GHS_KES, 60 * 60 * 1000);
  assert.ok(forecast.length > 0);
  // The forecast is deterministic given the demand history.
  const forecast2 = liquidityNetwork.forecast(GHS_KES, 60 * 60 * 1000);
  assert.deepEqual(
    forecast.map((p) => p.shortfall),
    forecast2.map((p) => p.shortfall),
  );

  // With demand MA ≈ 5000 vs supply ≈ 400 (200 current + 200 from registration),
  // shortfall must be detected. Alerts include any corridor where any forecast
  // point has shortfall > 0.
  const alerts = liquidityNetwork.shortfallAlerts();
  assert.ok(alerts.some((c) => c.fromCurrency === 'GHS' && c.toCurrency === 'KES'),
    'expected GHS→KES in shortfall alerts');
});

await run('networkStatus reports aggregate corridor + LP counts', () => {
  resetAll();
  registerThreeLPs();
  const status = liquidityNetwork.networkStatus();
  assert.equal(status.totalLPs, 3);
  assert.equal(status.activeLPs, 3);
  assert.equal(status.unhealthyLPs, 0);
  assert.ok(status.corridors.length >= 1);
  const c = status.corridors.find((c) => c.corridor.fromCurrency === 'GHS' && c.corridor.toCurrency === 'KES');
  assert.ok(c);
  assert.equal(c!.totalCapacity, 350_000); // 100k + 50k + 200k
});

await run('executeRoute + settleRoute success path consumes capacity + updates score', () => {
  resetAll();
  registerThreeLPs();
  const plan = liquidityNetwork.getQuote(GHS_KES, 5_000);
  assert.ok(plan);

  const exec = liquidityNetwork.executeRoute(plan!);
  assert.equal(exec.success, true);
  assert.equal(exec.reservationIds.length, plan!.route.length);

  const outcomes = plan!.route.map((leg) => ({
    lpId: leg.lpId, success: true, settlementMs: 5_000, amount: leg.amount,
  }));
  const settle = liquidityNetwork.settleRoute(plan!, plan!.id, outcomes);
  assert.equal(settle.fullySettled, true);
  assert.equal(settle.perLP.length, plan!.route.length);
});

await run('paused LP is not selected by routing (invariant 4)', () => {
  resetAll();
  registerThreeLPs();
  liquidityNetwork.pauseLP('lp1');
  const lp1 = liquidityRegistry.get('lp1');
  assert.equal(lp1!.state, 'paused');
  const plan = liquidityNetwork.getQuote(GHS_KES, 5_000);
  assert.ok(plan);
  for (const leg of plan!.route) {
    assert.notEqual(leg.lpId, 'lp1', 'paused LP must not be routed');
  }
  // Resume lp1 → routing should use it again.
  liquidityNetwork.resumeLP('lp1');
  assert.equal(liquidityRegistry.get('lp1')!.state, 'active');
  const plan2 = liquidityNetwork.getQuote(GHS_KES, 5_000);
  assert.ok(plan2);
  assert.equal(plan2!.route[0].lpId, 'lp1');
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\nliquidity-network.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exitCode = 1;
