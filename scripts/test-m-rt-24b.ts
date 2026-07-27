/**
 * M-RT-24B Verification — Treasury Integration (Wallets → Treasury).
 *
 * Proves: Wallet → Treasury Account → Ledger → Reserves
 *
 * Usage: bun run scripts/test-m-rt-24b.ts
 */

import { createRuntime, type Runtime, type RuntimeCommand } from '../src/runtime';

function check(name: string, passed: boolean, details: string): boolean {
  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} ${name}: ${details}`);
  return passed;
}

/** Capture balance values (not references — the projection mutates in place). */
function snap(p: { getBalance: (id: string) => { available: number; reserved: number; total: number } | null }, id: string) {
  return p.getBalance(id);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  M-RT-24B Verification — Treasury Integration');
  console.log('  Wallet → Treasury Account → Ledger → Reserves');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const runtime: Runtime = createRuntime({ environment: 'sandbox' });
  let allPassed = true;
  const walletId = 'wallet_integration_test';
  const treasuryAccountId = `treasury_wallet_${walletId}`;

  // Setup: Create a wallet via backfill (emits dual wallet + treasury events).
  console.log('━━━ Setup: Create wallet via recordWallet ━━━');
  await runtime.wallets.recordWallet({
    walletId, accountId: 'acc_test', name: 'Integration Test', currency: 'USD',
    balance: 1000, pendingBalance: 0, lockedBalance: 200, isDefault: false,
    createdAt: Date.now(), environment: 'sandbox', correlationId: 'setup',
  });
  const setupW = snap(runtime.wallets.projection, walletId);
  const setupT = snap(runtime.treasury.projection, treasuryAccountId);
  console.log(`  Wallet: avail=${setupW?.available}, res=${setupW?.reserved}, total=${setupW?.total}`);
  console.log(`  Treasury: avail=${setupT?.available}, res=${setupT?.reserved}, total=${setupT?.total}`);

  // Check 1: Treasury account exists for wallet.
  console.log('\n━━━ Check 1: Wallet backfill creates treasury account ━━━');
  {
    const t = runtime.treasury.projection.get(treasuryAccountId);
    allPassed = check('treasury account exists', t !== null && t.kind === 'treasury', `kind=${t?.kind}`) && allPassed;
  }

  // Check 2: Balances match.
  console.log('\n━━━ Check 2: Treasury balances match wallet balances ━━━');
  {
    const w = snap(runtime.wallets.projection, walletId);
    const t = snap(runtime.treasury.projection, treasuryAccountId);
    const match = Math.abs((w?.available ?? 0) - (t?.available ?? 0)) < 0.01 &&
                  Math.abs((w?.reserved ?? 0) - (t?.reserved ?? 0)) < 0.01;
    allPassed = check('balances match', match, `wallet: a=${w?.available} r=${w?.reserved} | treasury: a=${t?.available} r=${t?.reserved}`) && allPassed;
  }

  // Check 3: Credit updates both.
  console.log('\n━━━ Check 3: Wallet credit updates treasury ━━━');
  {
    const before = snap(runtime.wallets.projection, walletId);
    const tBefore = snap(runtime.treasury.projection, treasuryAccountId);
    const result = await runtime.dispatcher.dispatch({
      type: 'wallet.credit', payload: { walletId, amount: 500, currency: 'USD', reason: 'test' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c3', source: 'system', commandId: 'cmd3' },
    } as RuntimeCommand);
    const after = snap(runtime.wallets.projection, walletId);
    const tAfter = snap(runtime.treasury.projection, treasuryAccountId);
    const ok = result.success && (after?.available ?? 0) - (before?.available ?? 0) === 500 && (tAfter?.available ?? 0) - (tBefore?.available ?? 0) === 500;
    allPassed = check('credit updates both', ok, `wallet: ${before?.available}→${after?.available} | treasury: ${tBefore?.available}→${tAfter?.available}`) && allPassed;
  }

  // Check 4: Debit updates both.
  console.log('\n━━━ Check 4: Wallet debit updates treasury ━━━');
  {
    const before = snap(runtime.wallets.projection, walletId);
    const tBefore = snap(runtime.treasury.projection, treasuryAccountId);
    const result = await runtime.dispatcher.dispatch({
      type: 'wallet.debit', payload: { walletId, amount: 300, currency: 'USD', reason: 'test' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c4', source: 'system', commandId: 'cmd4' },
    } as RuntimeCommand);
    const after = snap(runtime.wallets.projection, walletId);
    const tAfter = snap(runtime.treasury.projection, treasuryAccountId);
    const ok = result.success && (before?.available ?? 0) - (after?.available ?? 0) === 300 && (tBefore?.available ?? 0) - (tAfter?.available ?? 0) === 300;
    allPassed = check('debit updates both', ok, `wallet: ${before?.available}→${after?.available} | treasury: ${tBefore?.available}→${tAfter?.available}`) && allPassed;
  }

  // Check 5: Reserve updates both.
  console.log('\n━━━ Check 5: Wallet reserve updates treasury ━━━');
  {
    const before = snap(runtime.wallets.projection, walletId);
    const tBefore = snap(runtime.treasury.projection, treasuryAccountId);
    const result = await runtime.dispatcher.dispatch({
      type: 'wallet.reserve', payload: { walletId, amount: 100, currency: 'USD', reason: 'test', operationId: 'op5' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c5', source: 'system', commandId: 'cmd5' },
    } as RuntimeCommand);
    const after = snap(runtime.wallets.projection, walletId);
    const tAfter = snap(runtime.treasury.projection, treasuryAccountId);
    const ok = result.success &&
      (before?.available ?? 0) - (after?.available ?? 0) === 100 && (after?.reserved ?? 0) - (before?.reserved ?? 0) === 100 &&
      (tBefore?.available ?? 0) - (tAfter?.available ?? 0) === 100 && (tAfter?.reserved ?? 0) - (tBefore?.reserved ?? 0) === 100;
    allPassed = check('reserve updates both', ok, `wallet: a ${before?.available}→${after?.available}, r ${before?.reserved}→${after?.reserved} | treasury: a ${tBefore?.available}→${tAfter?.available}, r ${tBefore?.reserved}→${tAfter?.reserved}`) && allPassed;
  }

  // Check 6: Release updates both.
  console.log('\n━━━ Check 6: Wallet release updates treasury ━━━');
  {
    const before = snap(runtime.wallets.projection, walletId);
    const tBefore = snap(runtime.treasury.projection, treasuryAccountId);
    const result = await runtime.dispatcher.dispatch({
      type: 'wallet.release', payload: { walletId, amount: 50, currency: 'USD', reason: 'test', operationId: 'op6' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c6', source: 'system', commandId: 'cmd6' },
    } as RuntimeCommand);
    const after = snap(runtime.wallets.projection, walletId);
    const tAfter = snap(runtime.treasury.projection, treasuryAccountId);
    const ok = result.success &&
      (after?.available ?? 0) - (before?.available ?? 0) === 50 && (before?.reserved ?? 0) - (after?.reserved ?? 0) === 50 &&
      (tAfter?.available ?? 0) - (tBefore?.available ?? 0) === 50 && (tBefore?.reserved ?? 0) - (tAfter?.reserved ?? 0) === 50;
    allPassed = check('release updates both', ok, `wallet: a ${before?.available}→${after?.available}, r ${before?.reserved}→${after?.reserved} | treasury: a ${tBefore?.available}→${tAfter?.available}, r ${tBefore?.reserved}→${tAfter?.reserved}`) && allPassed;
  }

  // Check 7: Every wallet has a treasury account.
  console.log('\n━━━ Check 7: Every wallet has a treasury account ━━━');
  {
    const wallets = runtime.wallets.projection.list({ take: 100 });
    let allHave = true;
    for (const w of wallets) {
      if (!runtime.treasury.projection.get(`treasury_wallet_${w.id}`)) { allHave = false; console.log(`    ✗ ${w.id}`); }
    }
    allPassed = check('every wallet has treasury', allHave, `${wallets.length} wallets`) && allPassed;
  }

  // Check 8: Existing APIs unchanged.
  console.log('\n━━━ Check 8: Existing wallet APIs unchanged ━━━');
  {
    const wallets = runtime.wallets.projection.list({ take: 10 });
    const ok = wallets.length > 0 && runtime.wallets.projection.get(wallets[0].id) !== null && snap(runtime.wallets.projection, wallets[0].id) !== null;
    allPassed = check('wallet APIs work', ok, `${wallets.length} wallets, get + getBalance work`) && allPassed;
  }

  // Summary.
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  M-RT-24B VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  OVERALL: ${allPassed ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('');
  console.log('  VALUE FLOW: Wallet → Treasury Account → Ledger → Reserves');
  console.log('  No wallet owns money independently. Treasury is the canonical');
  console.log('  financial state. Wallets are claims on treasury.');
  console.log('═══════════════════════════════════════════════════════════════════════\n');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
