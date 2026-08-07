/**
 * PaySwap PRODUCTION-3 — Tests for the Chain Abstraction Layer + Stellar adapter.
 *
 * Task 3-J — Tests + Documentation agent.
 *
 * Coverage:
 *   - createAccount → fundAccount → getBalance returns funded amount
 *   - registerAsset → issueAsset (requires trustline) → transfer → verifyTransaction
 *   - createClaimableBalance → claimBalance
 *   - createEscrowAccount → releaseEscrow
 *   - addSigner → setThresholds
 *   - All operations produce Evidence with source='on_chain_state'
 *   - Registry: register, get, default is stellar
 *   - Stub adapters (ethereum/base/polygon) return { success: false, error } without throwing
 *
 * Run with:  bun run tests/production3/chains.test.ts
 */

import assert from 'node:assert/strict';
import {
  chainRegistry,
  stellarChainAdapter,
  stellarNetwork,
  ethereumChainAdapter,
  baseChainAdapter,
  polygonChainAdapter,
  makeAsset,
  type ChainAdapter,
  type CreateAccountParams,
  type CreateEscrowAccountParams,
} from '@/protocol/chains';

interface TestResult {
  name: string;
  ok: boolean;
  err?: string;
}

const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({
      name,
      ok: false,
      err: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    });
  }
}

/* ============================================================================
 * Fixtures — reset the simulated Stellar network + the chain registry before
 * each top-level suite so tests are isolated.
 * ========================================================================== */

function resetAll(): void {
  stellarNetwork.reset();
  chainRegistry.reset();
  // The chains barrel auto-registers Stellar on import — re-register it so
  // `chainRegistry.default()` returns the same singleton we're testing.
  if (!chainRegistry.isRegistered('stellar')) {
    chainRegistry.register(stellarChainAdapter);
  }
}

/* ============================================================================
 * Tests
 * ========================================================================== */

await run('registry: default chain is stellar after reset', async () => {
  resetAll();
  const def = chainRegistry.default();
  assert.ok(def, 'expected a default adapter');
  assert.equal(def!.chain, 'stellar');
  assert.ok(chainRegistry.isRegistered('stellar'));
  assert.deepEqual(chainRegistry.chains(), ['stellar']);
});

await run('registry: register + get + all', async () => {
  resetAll();
  // Re-register the ethereum stub by hand to verify register/get.
  chainRegistry.register(ethereumChainAdapter);
  assert.ok(chainRegistry.isRegistered('ethereum'));
  assert.equal(chainRegistry.get('ethereum'), ethereumChainAdapter);
  assert.ok(chainRegistry.all().length >= 2);
});

await run('createAccount → fundAccount → getBalance returns funded amount', async () => {
  resetAll();
  const create = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  assert.equal(create.success, true);
  assert.ok(create.account, 'account must be returned');
  assert.ok(create.evidence, 'evidence must be present');
  assert.equal(create.evidence!.source, 'on_chain_state');
  assert.equal(create.evidence!.verificationLevel, 'cryptographic');
  const address = create.account!.address;

  const fund = await stellarChainAdapter.fundAccount({ address, nativeAmount: 50 });
  assert.equal(fund.success, true);
  assert.ok(fund.evidence);
  assert.equal(fund.evidence!.source, 'on_chain_state');

  const bal = await stellarChainAdapter.getBalance({ address, assetCode: 'XLM' });
  assert.equal(bal.success, true);
  assert.equal(bal.balance, 150);
});

await run('registerAsset → issueAsset (trustline required) → transfer → verifyTransaction', async () => {
  resetAll();
  const issuer = await stellarChainAdapter.createAccount({ nativeAmount: 1000 });
  const holder = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  const holderAddr = holder.account!.address;
  const issuerAddr = issuer.account!.address;

  const asset = makeAsset('TESTTKN', issuerAddr);
  const reg = await stellarChainAdapter.registerAsset({ assetCode: 'TESTTKN', issuer: issuerAddr });
  assert.equal(reg.success, true);

  // Without a trustline, issueAsset to holder must fail.
  const fail = await stellarChainAdapter.issueAsset({
    assetCode: 'TESTTKN', issuer: issuerAddr, amount: 100, to: holderAddr,
  });
  assert.equal(fail.success, false);
  assert.ok(fail.error!.includes('trustline'));

  // Create trustline.
  const tl = await stellarChainAdapter.createTrustline({
    holder: holderAddr, assetCode: 'TESTTKN', issuer: issuerAddr,
  });
  assert.equal(tl.success, true);

  // Now issue to holder.
  const issue = await stellarChainAdapter.issueAsset({
    assetCode: 'TESTTKN', issuer: issuerAddr, amount: 100, to: holderAddr,
  });
  assert.equal(issue.success, true);
  assert.ok(issue.txHash);
  assert.ok(issue.evidence);
  assert.equal(issue.evidence!.source, 'on_chain_state');

  // Transfer to a second holder.
  const other = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  const otherAddr = other.account!.address;
  await stellarChainAdapter.createTrustline({ holder: otherAddr, assetCode: 'TESTTKN', issuer: issuerAddr });
  const transfer = await stellarChainAdapter.transfer({
    assetCode: 'TESTTKN', issuer: issuerAddr, amount: 40, from: holderAddr, to: otherAddr,
  });
  assert.equal(transfer.success, true);
  assert.ok(transfer.txHash);

  // Verify transaction exists + is confirmed.
  const verify = await stellarChainAdapter.verifyTransaction({ txHash: transfer.txHash! });
  assert.equal(verify.success, true);
  assert.equal(verify.confirmed, true);

  const bal = await stellarChainAdapter.getBalance({ address: otherAddr, assetCode: 'TESTTKN', issuer: issuerAddr });
  assert.equal(bal.balance, 40);
});

await run('createClaimableBalance → claimBalance', async () => {
  resetAll();
  const sender = await stellarChainAdapter.createAccount({ nativeAmount: 1000 });
  const claimant = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  const senderAddr = sender.account!.address;
  const claimantAddr = claimant.account!.address;

  const cb = await stellarChainAdapter.createClaimableBalance({
    asset: makeAsset('XLM'),
    amount: 25,
    from: senderAddr,
    claimant: claimantAddr,
    predicate: { kind: 'unconditional' },
  });
  assert.equal(cb.success, true);
  assert.ok(cb.balanceId);
  assert.ok(cb.evidence);
  assert.equal(cb.evidence!.source, 'on_chain_state');

  // Wrong claimant must fail.
  const wrong = await stellarChainAdapter.claimBalance({ balanceId: cb.balanceId!, claimant: senderAddr });
  assert.equal(wrong.success, false);

  // Right claimant succeeds.
  const claim = await stellarChainAdapter.claimBalance({ balanceId: cb.balanceId!, claimant: claimantAddr });
  assert.equal(claim.success, true);
  assert.ok(claim.evidence);

  const bal = await stellarChainAdapter.getBalance({ address: claimantAddr, assetCode: 'XLM' });
  assert.equal(bal.balance, 125); // 100 + 25
});

await run('createEscrowAccount → releaseEscrow', async () => {
  resetAll();
  const sender = await stellarChainAdapter.createAccount({ nativeAmount: 1000 });
  const recipient = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  const senderAddr = sender.account!.address;
  const recipAddr = recipient.account!.address;

  // Escrow native XLM with unlock time = now (immediately releasable).
  const unlockTime = Date.now();
  const esc = await stellarChainAdapter.createEscrowAccount({
    asset: makeAsset('XLM'),
    amount: 50,
    from: senderAddr,
    signer1: senderAddr,
    signer2: recipAddr,
    unlockTime,
  });
  assert.equal(esc.success, true);
  assert.ok(esc.escrowAddress);
  assert.ok(esc.evidence);
  assert.equal(esc.evidence!.source, 'on_chain_state');

  // Release before unlock time fails when unlockTime is in the future.
  // Here we set unlock = now, so release should succeed immediately.
  const release = await stellarChainAdapter.releaseEscrow({
    escrowAddress: esc.escrowAddress!, to: recipAddr,
  });
  assert.equal(release.success, true);
  assert.ok(release.evidence);
});

await run('addSigner → setThresholds', async () => {
  resetAll();
  const acct = await stellarChainAdapter.createAccount({ nativeAmount: 1000 });
  const addr = acct.account!.address;
  const signerKey = 'GA_ADDITIONAL_SIGNER_TEST';

  const add = await stellarChainAdapter.addSigner({
    account: addr, signerKey, weight: 1,
  });
  assert.equal(add.success, true);
  assert.ok(add.evidence);
  assert.equal(add.evidence!.source, 'on_chain_state');

  const setT = await stellarChainAdapter.setThresholds({
    account: addr, low: 1, medium: 2, high: 3,
  });
  assert.equal(setT.success, true);
  assert.ok(setT.evidence);
  assert.equal(setT.evidence!.source, 'on_chain_state');

  // Verify the thresholds landed.
  const entry = await stellarChainAdapter.getLedgerEntry({ key: `account:${addr}` });
  assert.equal(entry.success, true);
  const acctData = entry.entry as { thresholds?: { low: number; medium: number; high: number } };
  assert.deepEqual(acctData.thresholds, { low: 1, medium: 2, high: 3 });
});

await run('all operations produce Evidence with source=on_chain_state', async () => {
  resetAll();
  const a1 = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  const a2 = await stellarChainAdapter.createAccount({ nativeAmount: 100 });
  const issuer = a1.account!.address;
  const holder = a2.account!.address;
  await stellarChainAdapter.registerAsset({ assetCode: 'TKN2', issuer });
  await stellarChainAdapter.createTrustline({ holder, assetCode: 'TKN2', issuer });
  const issue = await stellarChainAdapter.issueAsset({ assetCode: 'TKN2', issuer, amount: 5, to: holder });
  const burn = await stellarChainAdapter.burnAsset({ assetCode: 'TKN2', amount: 2, from: holder });
  const latestLedger = await stellarChainAdapter.getLatestLedger();
  const health = await stellarChainAdapter.healthCheck();

  for (const op of [issue, burn]) {
    assert.ok(op.evidence, 'must produce evidence');
    assert.equal(op.evidence!.source, 'on_chain_state');
    assert.equal(op.evidence!.verificationLevel, 'cryptographic');
  }
  assert.equal(latestLedger.success, true);
  assert.equal(health.healthy, true);
});

await run('stub adapters (ethereum/base/polygon) return structured errors without throwing', async () => {
  resetAll();
  for (const adapter of [ethereumChainAdapter, baseChainAdapter, polygonChainAdapter] as ChainAdapter[]) {
    const r = await adapter.createAccount({ nativeAmount: 10 });
    assert.equal(r.success, false, `${adapter.chain}.createAccount must fail`);
    assert.ok((r as { error?: string }).error, `${adapter.chain} must return an error string`);
    // Make sure no JS throw happened — we got here.
    assert.ok(typeof (r as { error?: string }).error === 'string');
  }
});

await run('streamLedgers returns unsubscribe fn + emits ledgers', async () => {
  resetAll();
  let events = 0;
  const unsub = stellarChainAdapter.streamLedgers(() => { events++; });
  assert.equal(typeof unsub, 'function');
  // Trigger a ledger close by creating an account (submitTransaction auto-closes).
  await stellarChainAdapter.createAccount({ nativeAmount: 5 });
  assert.ok(events >= 1, `expected at least 1 ledger event, got ${events}`);
  unsub();
});

/* ============================================================================
 * Report
 * ========================================================================== */

let pass = 0;
let fail = 0;
for (const r of results) {
  if (r.ok) {
    pass++;
    console.log(`  ✓ ${r.name}`);
  } else {
    fail++;
    console.error(`  ✗ ${r.name}`);
    console.error(`    ${r.err ?? '(no error message)'}`);
  }
}
console.log(`\nchains.test.ts — PASS=${pass} FAIL=${fail}`);
if (fail > 0) console.error(`FAILED: ${fail} tests`);
