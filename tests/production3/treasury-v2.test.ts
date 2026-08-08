/**
 * PaySwap PRODUCTION-3 — Tests for Treasury v2.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - mint limit: daily cap enforced
 *   - backing verifier blocks mint that would exceed reserve
 *   - emergency freeze halts operations
 *   - alert raised on low reserve
 *   - daily report contains all sections
 *
 * Run with:  bun run tests/production3/treasury-v2.test.ts
 */

import assert from 'node:assert/strict';
import {
  treasuryEngine,
  reserveMonitor,
  mintLimitEngine,
  burnLimitEngine,
  backingVerifier,
  alertEngine,
  emergencyFreezeEngine,
  corridorBalancer,
  yieldEngine,
  DEFAULT_DAILY_MINT_LIMIT,
  DEFAULT_PER_TX_MINT_LIMIT,
  MIN_BACKING_RATIO,
} from '@/protocol/treasury-v2';
import { twinTokenEngine } from '@/protocol/twin-token/engine';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

async function resetAll(): Promise<void> {
  treasuryEngine.reset();
  twinTokenEngine.reset();
  // Register the TWINGHS asset and bind the engine.
  await twinTokenEngine.registerAsset('GHS', 'GHS→KES', 'GBISSUER_GHS');
  treasuryEngine.init({
    twinTokenEngine,
    intervals: {
      reserveSyncMs: 3_600_000,
      backingVerifyMs: 3_600_000,
      alertCheckMs: 3_600_000,
      corridorBalanceMs: 3_600_000,
      freezeSweepMs: 3_600_000,
    },
    lowReserveThresholds: { GHS: 1_000 },
  });
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('mint limit: per-tx + daily cap enforced', async () => {
  await resetAll();
  mintLimitEngine.configure({
    assetCode: 'TWINGHS',
    dailyLimit: 5_000,
    perTxLimit: 1_000,
    cooldownMs: 0,
  });
  // Provide ample reserve so backing doesn't block.
  reserveMonitor.setReserve('GHS', 1_000_000, 0);

  // Within per-tx limit → allowed.
  const ok1 = mintLimitEngine.checkMint('TWINGHS', 500);
  assert.equal(ok1.allowed, true);

  // Exceeds per-tx limit (1_000) → blocked.
  const tooBig = mintLimitEngine.checkMint('TWINGHS', 2_000);
  assert.equal(tooBig.allowed, false);
  assert.equal(tooBig.reason, 'per_tx_exceeded');

  // Record enough mints to push daily usage close to the daily cap.
  mintLimitEngine.recordMint('TWINGHS', 1_000);
  mintLimitEngine.recordMint('TWINGHS', 1_000);
  mintLimitEngine.recordMint('TWINGHS', 1_000);
  mintLimitEngine.recordMint('TWINGHS', 1_000);
  // dailyUsed = 4_000, dailyLimit = 5_000, remaining = 1_000.

  // Mint within remaining daily allowance is allowed.
  const ok2 = mintLimitEngine.checkMint('TWINGHS', 1_000);
  assert.equal(ok2.allowed, true);

  // Record it → dailyUsed = 5_000 (cap reached).
  mintLimitEngine.recordMint('TWINGHS', 1_000);

  // Subsequent mint is denied with daily_exceeded.
  const denied = mintLimitEngine.checkMint('TWINGHS', 1);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'daily_exceeded');
});

await run('backing verifier blocks mint that would exceed reserve', async () => {
  await resetAll();
  // Register asset + set a small reserve (1000 GHS).
  reserveMonitor.setReserve('GHS', 1_000, 0);

  // Set a generous mint limit so the backing check is the bottleneck.
  mintLimitEngine.configure({
    assetCode: 'TWINGHS',
    dailyLimit: 1_000_000,
    perTxLimit: 1_000_000,
    cooldownMs: 0,
  });

  // Mint 500 → backing check passes (reserve 1_000 >= liabilities 500).
  const ok500 = treasuryEngine.preMintHook('TWINGHS', 500);
  assert.equal(ok500.allowed, true);

  // Simulate the mint by recording it (updates reserved counter on the reserve).
  treasuryEngine.recordMint('TWINGHS', 500);
  // Now circulating+escrowed should reflect 500 worth of liability.
  // (The twinTokenEngine didn't actually mint, so circulating=0; but the
  // reserve monitor's `reserved` was bumped by 500 by recordMint.)
  // The backingVerifier reads circulating from the twin-token engine — which
  // is 0 — so the post-mint liabilities stay at 0 in the verifier's view.
  // To force the verifier to see real liabilities, we mutate the asset:
  const asset = twinTokenEngine.getAsset('TWINGHS')!;
  asset.circulating = 500;
  reserveMonitor.refreshBackingRatios();

  // A second mint of 600 would push circulating to 1100 > reserve 1000.
  // The verifier's onMint computes post-mint liabilities = (500 + 600) + 0 = 1100.
  // Reserve available = 1000 - 500 (reserved) = 500. 1100 > 500 → blocked.
  const blocked = treasuryEngine.preMintHook('TWINGHS', 600);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'backing_insufficient');
});

await run('emergency freeze halts mint/burn operations', async () => {
  await resetAll();
  reserveMonitor.setReserve('GHS', 1_000_000, 0);
  mintLimitEngine.configure({
    assetCode: 'TWINGHS', dailyLimit: 1_000_000, perTxLimit: 1_000_000, cooldownMs: 0,
  });

  // Mint is allowed before freeze.
  const okBefore = treasuryEngine.preMintHook('TWINGHS', 100);
  assert.equal(okBefore.allowed, true);

  // Freeze the asset.
  emergencyFreezeEngine.freezeAsset('TWINGHS', 'compliance investigation', 'ops-user');

  // Mint is now blocked with reason 'asset_frozen'.
  const blocked = treasuryEngine.preMintHook('TWINGHS', 100);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'asset_frozen');

  // Burn is also blocked.
  const burnBlocked = treasuryEngine.preBurnHook('TWINGHS', 100);
  assert.equal(burnBlocked.allowed, false);
  assert.equal(burnBlocked.reason, 'asset_frozen');

  // Transfer is also blocked.
  const transferBlocked = treasuryEngine.preTransferHook('TWINGHS', 100, 'merchant:m1');
  assert.equal(transferBlocked.allowed, false);
  assert.equal(transferBlocked.reason, 'asset_frozen');

  // Lift the freeze → mint allowed again.
  const freeze = emergencyFreezeEngine.activeFreezes().find((f) => f.scope === 'asset' && f.target === 'TWINGHS');
  assert.ok(freeze);
  treasuryEngine.liftFreeze(freeze!.id);
  const okAfter = treasuryEngine.preMintHook('TWINGHS', 100);
  assert.equal(okAfter.allowed, true);
});

await run('alert raised on low reserve', async () => {
  await resetAll();
  reserveMonitor.setReserve('GHS', 500, 0); // below threshold of 1_000
  // Run the reserve check.
  alertEngine.checkReserves(reserveMonitor, { GHS: 1_000 });
  const alerts = alertEngine.active().filter((a) => a.type === 'low_reserve');
  assert.ok(alerts.length >= 1, 'expected at least one low_reserve alert');
  assert.equal(alerts[0].currency, 'GHS');
});

await run('daily report contains all sections', async () => {
  await resetAll();
  // Seed some state.
  reserveMonitor.setReserve('GHS', 100_000, 5_000);
  reserveMonitor.setReserve('KES', 50_000, 1_000);
  mintLimitEngine.configure({ assetCode: 'TWINGHS', dailyLimit: 10_000, perTxLimit: 1_000 });
  burnLimitEngine.configure({ assetCode: 'TWINGHS', dailyLimit: 10_000, perTxLimit: 1_000 });
  mintLimitEngine.recordMint('TWINGHS', 1_500);
  emergencyFreezeEngine.freezeAsset('TWINGHS', 'audit', 'ops');

  const report = await treasuryEngine.dailyReport();
  assert.ok(report, 'dailyReport must return a report');
  assert.ok(Array.isArray(report.reserves));
  assert.ok(report.reserves.length >= 1);
  assert.ok(report.backingVerified !== undefined, 'backingVerified must exist');
  assert.ok(Array.isArray(report.mintUsage));
  assert.ok(Array.isArray(report.burnUsage));
  assert.ok(Array.isArray(report.alerts));
  assert.ok(Array.isArray(report.yields));
  assert.ok(report.capitalEfficiency !== undefined, 'capitalEfficiency must exist');
  assert.ok(Array.isArray(report.corridors));
  assert.ok(Array.isArray(report.frozenAssets));
  // The freeze we applied should be reflected.
  assert.ok(report.frozenAssets.includes('TWINGHS'));
  // The mint usage should show 1500 used out of 10000.
  const mu = report.mintUsage.find((m) => m.assetCode === 'TWINGHS');
  assert.ok(mu);
  assert.equal(mu!.dailyUsed, 1_500);
  assert.equal(mu!.dailyLimit, 10_000);
});

await run('backing verifier: verifyAll returns results for every registered asset', async () => {
  await resetAll();
  reserveMonitor.setReserve('GHS', 10_000, 0);
  const { allVerified, results } = backingVerifier.verifyAll(twinTokenEngine, reserveMonitor);
  assert.ok(Array.isArray(results));
  assert.equal(typeof allVerified, 'boolean');
  // We registered TWINGHS, so we expect at least one result.
  assert.ok(results.length >= 1);
  for (const r of results) {
    assert.equal(typeof r.verified, 'boolean');
    assert.equal(typeof r.backingRatio, 'number');
  }
});

await run('MIN_BACKING_RATIO is 1.0 and reserves below threshold mark backing false', async () => {
  assert.equal(MIN_BACKING_RATIO, 1.0);
  await resetAll();
  // Register the asset first (required for getAsset to return non-undefined).
  twinTokenEngine.registerAsset('GHS', 'Ghana:United States', 'issuer_test');
  // Reserve = 0, liabilities = 100 → ratio = 0 → not verified.
  reserveMonitor.setReserve('GHS', 0, 0);
  const asset = twinTokenEngine.getAsset('TWINGHS')!;
  asset.totalSupply = 100;
  reserveMonitor.refreshBackingRatios();
  const r = backingVerifier.verifyBacking('TWINGHS', twinTokenEngine, reserveMonitor);
  assert.equal(r.verified, false);
  assert.ok(r.backingRatio < MIN_BACKING_RATIO);
});

await run('default mint/burn limits are exposed constants', () => {
  assert.ok(DEFAULT_DAILY_MINT_LIMIT > 0);
  assert.ok(DEFAULT_PER_TX_MINT_LIMIT > 0);
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\ntreasury-v2.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exitCode = 1;
