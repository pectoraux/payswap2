/**
 * PaySwap PRODUCTION-3 — Cross-module replay-determinism tests.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - Emit a sequence of events (mint, transfer, escrow, payout)
 *   - Rebuild ledger from events twice → identical trial balance
 *   - Rebuild twin-token balances from events twice → identical
 *   - verifyReplayDeterminism returns true
 *
 * Run with:  bun run tests/production3/replay-determinism.test.ts
 */

import assert from 'node:assert/strict';
import {
  ledgerEngine,
  rebuildLedgerFromEvents,
  takeSnapshot,
  snapshotStore,
} from '@/protocol/ledger';
import { eventReplayEngine } from '@/protocol/resilience';
import type { SimulationEvent } from '@/kernel/types';

interface TestResult { name: string; ok: boolean; err?: string; }
const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); }
  catch (err) {
    results.push({ name, ok: false, err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
  }
}

function resetAll(): void {
  ledgerEngine.reset();
  snapshotStore.reset();
}

/* ============================================================================
 * A representative event sequence — mint, transfer, escrow, release, burn,
 * payout, wallet credit/debit. Deterministic input → deterministic output.
 * ========================================================================== */

function buildEventSequence(): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  let ts = 1_000;
  let idCounter = 0;
  const nextId = () => `evt-${++idCounter}`;

  // Mint TWINGHS to merchant:m1, TWINKES to merchant:m2.
  events.push({ id: nextId(), type: 'twintoken.minted', ts: ts++, frame: 0,
    payload: { opId: 'op1', assetCode: 'TWINGHS', amount: 500, to: 'merchant:m1', txHash: 'h1' } });
  events.push({ id: nextId(), type: 'twintoken.minted', ts: ts++, frame: 0,
    payload: { opId: 'op2', assetCode: 'TWINKES', amount: 300, to: 'merchant:m2', txHash: 'h2' } });

  // Transfer 100 TWINGHS from m1 to a buyer.
  events.push({ id: nextId(), type: 'twintoken.transferred', ts: ts++, frame: 0,
    payload: { opId: 'op3', assetCode: 'TWINGHS', amount: 100, from: 'merchant:m1', to: 'buyer:b1', txHash: 'h3' } });

  // Escrow 50 TWINGHS for settlement, then release.
  events.push({ id: nextId(), type: 'twintoken.escrowed', ts: ts++, frame: 0,
    payload: { opId: 'op4', assetCode: 'TWINGHS', amount: 50, from: 'merchant:m1', escrowId: 'esc1' } });
  events.push({ id: nextId(), type: 'twintoken.released', ts: ts++, frame: 0,
    payload: { opId: 'op5', assetCode: 'TWINGHS', amount: 50, escrowId: 'esc1', to: 'lp:lp1' } });

  // Burn 200 TWINGHS from m1 (settled a payout).
  events.push({ id: nextId(), type: 'twintoken.burned', ts: ts++, frame: 0,
    payload: { opId: 'op6', assetCode: 'TWINGHS', amount: 200, from: 'merchant:m1', txHash: 'h6' } });

  // Wallet credit + debit (user wallet activity).
  events.push({ id: nextId(), type: 'wallet.credited', ts: ts++, frame: 0,
    payload: { walletId: 'w1', amount: 1000, currency: 'GHS', reference: 'ref1' } });
  events.push({ id: nextId(), type: 'wallet.debited', ts: ts++, frame: 0,
    payload: { walletId: 'w1', amount: 250, currency: 'GHS', reference: 'ref2' } });

  // Payout completed (bank method) — m1, sourceAsset TWINGHS, gross 200,
  // net 199, fee 1.
  events.push({ id: nextId(), type: 'payout.completed', ts: ts++, frame: 0,
    payload: { payoutId: 'pay1', merchantId: 'm1', method: 'bank', netAmount: 199, currency: 'GHS', txHash: 'hp' } });

  return events;
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('rebuild ledger from events twice → identical trial balance', () => {
  resetAll();
  const events = buildEventSequence();
  const led1 = rebuildLedgerFromEvents(events);
  const led2 = rebuildLedgerFromEvents(events);
  const tb1 = led1.getTrialBalance();
  const tb2 = led2.getTrialBalance();
  assert.deepEqual(tb1.totalDebits, tb2.totalDebits);
  assert.deepEqual(tb1.totalCredits, tb2.totalCredits);
  assert.deepEqual(tb1.balanced, tb2.balanced);
  assert.deepEqual(led1.getAccountCodes(), led2.getAccountCodes());
  // Per-account balances must match.
  for (const code of led1.getAccountCodes()) {
    const a = led1.getAccountBalance(code);
    const b = led2.getAccountBalance(code);
    assert.deepEqual(a, b, `account ${code} mismatch`);
  }
});

await run('rebuild ledger from events twice → identical balance sheet', () => {
  resetAll();
  const events = buildEventSequence();
  const led1 = rebuildLedgerFromEvents(events);
  const led2 = rebuildLedgerFromEvents(events);
  const bs1 = led1.getBalanceSheet();
  const bs2 = led2.getBalanceSheet();
  assert.equal(bs1.totalAssets, bs2.totalAssets);
  assert.equal(bs1.totalLiabilities, bs2.totalLiabilities);
  assert.equal(bs1.totalEquity, bs2.totalEquity);
  assert.equal(bs1.delta, bs2.delta);
  assert.equal(bs1.balanced, bs2.balanced);
});

await run('rebuild twin-token balances from events twice → identical', () => {
  resetAll();
  const events = buildEventSequence();
  // Rebuild a "twin-token balances" projection by counting mint/burn/transfer
  // events per (holder, assetCode). This mirrors what the twin-token engine
  // would do — we just use the eventReplayEngine here so the test is fully
  // deterministic + cross-module.
  interface TTBal { [holder: string]: { [asset: string]: number }; }
  const rebuildTT = (): TTBal => {
    const led = rebuildLedgerFromEvents(events);
    const out: TTBal = {};
    // Walk the journal for twintoken:* accounts.
    for (const j of led.getJournal()) {
      for (const ln of j.entries) {
        if (ln.accountCode.startsWith('twintoken:circulating:')) {
          // Each mint DR's circulating, each burn CR's circulating.
          // For this test we just sum debit-credit per asset.
          const asset = ln.accountCode.split(':')[2];
          out['_aggregate'] = out['_aggregate'] ?? {};
          out['_aggregate'][asset] = (out['_aggregate'][asset] ?? 0) + (ln.debit - ln.credit);
        }
      }
    }
    return out;
  };
  const r1 = rebuildTT();
  const r2 = rebuildTT();
  assert.deepEqual(r1, r2);
  // Spot-check: TWINGHS circulating aggregate = +500 (mint DR) - 50 (escrow CR circulating) - 200 (burn CR circulating) = 250.
  // Transfer is a wash (DR + CR circulating). Release credits escrowed, not circulating — so it doesn't add back.
  assert.equal(r1._aggregate.TWINGHS, 250);
  assert.equal(r1._aggregate.TWINKES, 300);
});

await run('verifyReplayDeterminism returns true for ledger projection', async () => {
  resetAll();
  const events = buildEventSequence();
  const result = await eventReplayEngine.verifyReplayDeterminism(events);
  assert.equal(result.deterministic, true, `expected deterministic, mismatch=${result.mismatch ?? ''}`);
});

await run('snapshot of rebuilt ledger verifies + restores identically', () => {
  resetAll();
  const events = buildEventSequence();
  const led = rebuildLedgerFromEvents(events);
  const snap = takeSnapshot(led, Date.now());
  snapshotStore.save(snap);
  assert.ok(snapshotStore.verify(snap), 'snapshot must verify');
  // Re-take the snapshot from the same events — must be byte-identical in
  // trial-balance totals.
  const led2 = rebuildLedgerFromEvents(events);
  const snap2 = takeSnapshot(led2, snap.ts);
  assert.deepEqual(snap2.accounts, snap.accounts);
  assert.deepEqual(snap2.trialBalance, snap.trialBalance);
});

await run('replay ordering is stable (sort by ts, frame, id)', () => {
  resetAll();
  // Same events in a SCRAMBLED order — projection must produce the same result.
  const events = buildEventSequence();
  const scrambled = [...events].reverse();
  const led1 = rebuildLedgerFromEvents(events);
  const led2 = rebuildLedgerFromEvents(scrambled);
  const tb1 = led1.getTrialBalance();
  const tb2 = led2.getTrialBalance();
  assert.deepEqual(tb1, tb2);
});

await run('rebuild is idempotent — replaying the same events N times produces the same state', () => {
  resetAll();
  const events = buildEventSequence();
  const tb0 = rebuildLedgerFromEvents(events).getTrialBalance();
  for (let i = 0; i < 5; i++) {
    const tb = rebuildLedgerFromEvents(events).getTrialBalance();
    assert.deepEqual(tb, tb0, `iteration ${i} diverged`);
  }
});

/* ============================================================================
 * Report
 * ========================================================================== */
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); }
  else { fail++; console.error(`  ✗ ${r.name}\n    ${r.err ?? ''}`); }
}
console.log(`\nreplay-determinism.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) process.exit(1);
