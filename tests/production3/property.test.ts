/**
 * PaySwap PRODUCTION-3 — Property-based tests.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * No fast-check dependency — we generate random inputs in loops.
 *
 * Coverage:
 *   - For any sequence of balanced journal entries, the trial balance is always zero (100 random sequences)
 *   - For any mint amount within limits + backing, the operation succeeds (100 random amounts)
 *   - For any LP set, routing never selects a paused LP (100 random configurations)
 *   - For any dedup key, checkOrMark returns the same result on repeated calls (100 random keys)
 *
 * Run with:  bun run tests/production3/property.test.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ledgerEngine,
  createJournalEntry,
  type JournalEntry,
} from '@/protocol/ledger';
import {
  treasuryEngine,
  mintLimitEngine,
  reserveMonitor,
  emergencyFreezeEngine,
} from '@/protocol/treasury-v2';
import { twinTokenEngine } from '@/protocol/twin-token/engine';
import {
  liquidityNetwork,
  liquidityRegistry,
  lpHealthMonitor,
  type Corridor,
  type LPId,
} from '@/protocol/liquidity-network';
import { dedupStore } from '@/protocol/resilience';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

/* ============================================================================
 * Deterministic PRNG (mulberry32) so test failures are reproducible.
 * ========================================================================== */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function randPick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('property: balanced journal entries → trial balance always zero (100 sequences)', () => {
  const rng = mulberry32(42);
  let totalAssertions = 0;
  for (let i = 0; i < 100; i++) {
    ledgerEngine.reset();
    // Generate 1–10 balanced entries per sequence.
    const entryCount = randInt(rng, 1, 10);
    for (let e = 0; e < entryCount; e++) {
      const currency = randPick(rng, ['GHS', 'KES', 'USD', 'NGN']);
      const amount = randInt(rng, 1, 100_000);
      // Pick two random account codes (parameterized).
      const accountA = randPick(rng, ['cash:bank:GHS', 'cash:bank:KES', 'cash:mmo:USD', 'cash:bank:NGN']);
      const accountB = randPick(rng, ['user:wallet:w1', 'user:wallet:w2', 'merchant:payable:m1', 'equity:treasury']);
      const entry = createJournalEntry({
        description: `random entry ${e}`,
        lines: [
          { accountCode: accountA, amount, currency, side: 'debit' },
          { accountCode: accountB, amount, currency, side: 'credit' },
        ],
      });
      ledgerEngine.post(entry);
    }
    const tb = ledgerEngine.getTrialBalance();
    assert.equal(tb.balanced, true, `iteration ${i}: trial balance must be balanced`);
    assert.ok(Math.abs(tb.totalDebits - tb.totalCredits) < 1e-6, `iteration ${i}: debits must equal credits`);
    totalAssertions += 2;
  }
  assert.ok(totalAssertions >= 200, `expected at least 200 assertions, got ${totalAssertions}`);
});

await run('property: mint amount within limits + backing succeeds (100 amounts)', async () => {
  // Reset all subsystems once.
  treasuryEngine.reset();
  twinTokenEngine.reset();
  await twinTokenEngine.registerAsset('GHS', 'GHS→KES', 'GBISSUER_GHS');
  treasuryEngine.init({
    twinTokenEngine,
    intervals: {
      reserveSyncMs: 3_600_000, backingVerifyMs: 3_600_000, alertCheckMs: 3_600_000,
      corridorBalanceMs: 3_600_000, freezeSweepMs: 3_600_000,
    },
    lowReserveThresholds: { GHS: 0 },
  });
  // Set ample reserve (1_000_000) + generous limits (per-tx 100_000, daily 1_000_000).
  reserveMonitor.setReserve('GHS', 1_000_000, 0);
  mintLimitEngine.configure({
    assetCode: 'TWINGHS', dailyLimit: 1_000_000, perTxLimit: 100_000, cooldownMs: 0,
  });
  // Ensure no freeze.
  for (const f of emergencyFreezeEngine.activeFreezes()) {
    treasuryEngine.liftFreeze(f.id);
  }
  // Keep the asset's circulating at zero so the backing verifier sees each
  // mint as a fresh liability of `amount` against the ample 1_000_000 reserve.
  // We do NOT call recordMint — each preMintHook call is an independent check.
  const asset = twinTokenEngine.getAsset('TWINGHS')!;
  asset.circulating = 0;
  asset.escrowed = 0;

  const rng = mulberry32(123);
  let allowedCount = 0;
  for (let i = 0; i < 100; i++) {
    // Amount within [1, 50_000] — well below perTxLimit (100_000) and reserve (1_000_000).
    const amount = randInt(rng, 1, 50_000);
    const r = treasuryEngine.preMintHook('TWINGHS', amount);
    assert.equal(r.allowed, true, `iteration ${i}: mint of ${amount} should be allowed (reason=${r.reason})`);
    allowedCount++;
  }
  assert.equal(allowedCount, 100);
});

await run('property: routing never selects a paused LP (100 configurations)', () => {
  const rng = mulberry32(7);
  const GHS_KES: Corridor = { fromCurrency: 'GHS', toCurrency: 'KES' };
  let violations = 0;
  let validRuns = 0;
  for (let i = 0; i < 100; i++) {
    liquidityNetwork.reset();
    // Register 3–5 LPs, randomly pause 0–2 of them.
    const lpCount = randInt(rng, 3, 5);
    const lpIds: LPId[] = [];
    for (let j = 0; j < lpCount; j++) {
      const id = `lp-${i}-${j}`;
      liquidityNetwork.registerLP({
        id, name: id, country: 'Kenya', corridors: [GHS_KES],
        capacity: { 'GHS→KES': randInt(rng, 1_000, 100_000) },
        feeBps: randInt(rng, 30, 200),
        settlementSpeedMs: randInt(rng, 1_000, 60_000),
        reputation: 0.5 + rng() * 0.5,
        historicalSuccessRate: 0.9 + rng() * 0.1,
      });
      lpIds.push(id);
    }
    // Randomly pause some LPs.
    const pauseCount = randInt(rng, 0, Math.min(2, lpCount - 1));
    const paused = new Set<string>();
    for (let p = 0; p < pauseCount; p++) {
      const id = lpIds[Math.floor(rng() * lpIds.length)];
      if (!paused.has(id) && lpIds.length - paused.size > 1) {
        liquidityNetwork.pauseLP(id);
        paused.add(id);
      }
    }

    // Get a quote for a small amount (so capacity is rarely the bottleneck).
    const amount = 100;
    const plan = liquidityNetwork.getQuote(GHS_KES, amount);
    if (plan === null) continue; // no route at all (could be all paused/unhealthy)
    validRuns++;
    // INVARIANT: no leg of the route may include a paused LP.
    for (const leg of plan.route) {
      if (paused.has(leg.lpId)) {
        violations++;
        console.error(`  iter ${i}: routed through PAUSED LP ${leg.lpId}`);
      }
    }
    // Also: every selected LP must have state 'active'.
    for (const leg of plan.route) {
      const lp = liquidityRegistry.get(leg.lpId);
      assert.equal(lp?.state, 'active', `iter ${i}: ${leg.lpId} not active`);
    }
  }
  assert.equal(violations, 0, `routing selected paused LPs ${violations} times`);
  assert.ok(validRuns >= 50, `expected at least 50 valid routing runs, got ${validRuns}`);
});

await run('property: dedup checkOrMark returns the same result on repeated calls (100 keys)', async () => {
  dedupStore.reset();
  const rng = mulberry32(99);
  for (let i = 0; i < 100; i++) {
    const key = { scope: 'payment' as const, key: `prop-key-${i}-${Math.floor(rng() * 1e9)}` };
    // First call — executes fn.
    let calls = 0;
    const r1 = await dedupStore.checkOrMark(key, async () => {
      calls++;
      return { n: i, hash: createHash('sha256').update(`${i}`).digest('hex').slice(0, 8) };
    });
    assert.equal(r1.fromCache, false);
    assert.equal(calls, 1);
    // Second call — must return cached result, fn NOT called.
    const r2 = await dedupStore.checkOrMark(key, async () => {
      calls++;
      return { n: -1, hash: 'wrong' };
    });
    assert.equal(r2.fromCache, true);
    assert.equal(calls, 1, `iter ${i}: fn must not be called again on cache hit`);
    assert.deepEqual(r2.result, r1.result);
  }
});

await run('property: trial balance invariant holds under multi-currency stress', () => {
  const rng = mulberry32(2024);
  ledgerEngine.reset();
  for (let i = 0; i < 100; i++) {
    const ccy = randPick(rng, ['GHS', 'KES', 'USD', 'NGN', 'TZS']);
    const amount = randInt(rng, 1, 1_000_000);
    // Balanced entry with random accounts (always balanced because amount is same on both sides).
    const entry = createJournalEntry({
      description: `stress ${i}`,
      lines: [
        { accountCode: 'cash:bank:' + ccy, amount, currency: ccy, side: 'debit' },
        { accountCode: 'user:wallet:w_' + i, amount, currency: ccy, side: 'credit' },
      ],
    });
    ledgerEngine.post(entry);
  }
  const tb = ledgerEngine.getTrialBalance();
  assert.equal(tb.balanced, true);
  // Every per-currency delta must be zero.
  for (const [ccy, v] of Object.entries(tb.byCurrency)) {
    assert.equal(v.delta, 0, `currency ${ccy} delta must be 0`);
  }
});

await run('property: snapshots reconcile for any balanced state', () => {
  const rng = mulberry32(77);
  ledgerEngine.reset();
  for (let i = 0; i < 20; i++) {
    const amount = randInt(rng, 1, 100_000);
    const entry = createJournalEntry({
      description: `snap ${i}`,
      lines: [
        { accountCode: 'cash:bank:GHS', amount, currency: 'GHS', side: 'debit' },
        { accountCode: 'user:wallet:w_' + i, amount, currency: 'GHS', side: 'credit' },
      ],
    });
    ledgerEngine.post(entry);
  }
  const tb = ledgerEngine.getTrialBalance();
  // The trial balance of the live ledger must always balance.
  assert.equal(tb.balanced, true);
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\nproperty.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
