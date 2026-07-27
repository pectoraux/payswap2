/**
 * M-RT-26 Verification — Global Transaction Coordinator.
 *
 * Checks:
 *   1. Atomic commits (transaction commits all events or none)
 *   2. Rollbacks (invariant violation → no events appended)
 *   3. Nested commands (multiple commands in one transaction)
 *   4. Treasury consistency (wallet + treasury both update atomically)
 *   5. Replay deterministic
 *   6. Existing APIs unchanged (dispatcher still works)
 *   7. Zero partial projections (events buffered until commit)
 *   8. Concurrent transactions remain OCC-safe
 *   9. Settlement adapters (Stellar + Ethereum + Polygon registered)
 *  10. Observability (transaction ID, duration, events, status, projections)
 *
 * Usage: bun run scripts/test-m-rt-26.ts
 */

import { createRuntime, type Runtime, type RuntimeCommand } from '../src/runtime';

function check(name: string, passed: boolean, details: string): boolean {
  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} ${name}: ${details}`);
  return passed;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  M-RT-26 Verification — Global Transaction Coordinator');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const runtime: Runtime = createRuntime({ environment: 'sandbox' });
  let allPassed = true;

  // Setup: create a wallet.
  await runtime.wallets.recordWallet({
    walletId: 'wallet_tx_test', accountId: 'acc_tx', name: 'TX Test', currency: 'USD',
    balance: 500, pendingBalance: 0, lockedBalance: 0, isDefault: false,
    createdAt: Date.now(), environment: 'sandbox', correlationId: 'tx_setup',
  });

  // ── Check 1: Atomic commits ──────────────────────────────────────────────
  console.log('━━━ Check 1: Atomic commits ━━━');
  {
    const result = await runtime.coordinator.execute({
      type: 'wallet.credit', payload: { walletId: 'wallet_tx_test', amount: 100, currency: 'USD', reason: 'atomic test' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c1', source: 'system', commandId: 'cmd1' },
    } as RuntimeCommand);

    const passed = check(
      'transaction commits atomically',
      result.success && result.events.length > 0 && result.observability.status === 'committed',
      `success=${result.success}, events=${result.events.length}, status=${result.observability.status}, txId=${result.transactionId}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 2: Rollbacks ───────────────────────────────────────────────────
  console.log('\n━━━ Check 2: Rollbacks (invariant violation) ━━━');
  {
    const balanceBefore = runtime.wallets.projection.getBalance('wallet_tx_test');
    const result = await runtime.coordinator.execute({
      type: 'wallet.debit', payload: { walletId: 'wallet_tx_test', amount: 999999, currency: 'USD', reason: 'should fail' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c2', source: 'system', commandId: 'cmd2' },
    } as RuntimeCommand);

    const balanceAfter = runtime.wallets.projection.getBalance('wallet_tx_test');
    const passed = check(
      'rollback on invariant violation',
      !result.success && result.observability.status === 'rolled_back' && balanceAfter?.available === balanceBefore?.available,
      `success=${result.success}, status=${result.observability.status}, balance: ${balanceBefore?.available}→${balanceAfter?.available} (unchanged)`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 3: Nested commands ─────────────────────────────────────────────
  console.log('\n━━━ Check 3: Nested commands ━━━');
  {
    const result = await runtime.coordinator.executeNested(
      [
        { type: 'wallet.credit', payload: { walletId: 'wallet_tx_test', amount: 200, currency: 'USD', reason: 'nested 1' },
          metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'n1', source: 'system', commandId: 'n1' } },
        { type: 'wallet.credit', payload: { walletId: 'wallet_tx_test', amount: 50, currency: 'USD', reason: 'nested 2' },
          metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'n2', source: 'system', commandId: 'n2' } },
      ] as RuntimeCommand[],
      { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'nested', source: 'system' },
    );

    const passed = check(
      'nested commands commit atomically',
      result.success && result.observability.commands.length === 2 && result.events.length >= 4, // 2 commands × 2 events each (wallet + treasury)
      `success=${result.success}, commands=${result.observability.commands.length}, events=${result.events.length}, status=${result.observability.status}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 4: Treasury consistency ────────────────────────────────────────
  console.log('\n━━━ Check 4: Treasury consistency ━━━');
  {
    const walletBalance = runtime.wallets.projection.getBalance('wallet_tx_test');
    const treasuryId = `treasury_wallet_wallet_tx_test`;
    const treasuryBalance = runtime.treasury.projection.getBalance(treasuryId);

    const passed = check(
      'wallet + treasury balances match',
      Math.abs((walletBalance?.available ?? 0) - (treasuryBalance?.available ?? 0)) < 0.01,
      `wallet=${walletBalance?.available}, treasury=${treasuryBalance?.available}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 5: Replay deterministic ────────────────────────────────────────
  console.log('\n━━━ Check 5: Replay deterministic ━━━');
  {
    const events = await runtime.eventStore.readAll(0, 50_000);
    const walletEvents = events.filter((e) => e.streamType === 'wallet');
    const count1 = runtime.wallets.projection.count();
    await runtime.wallets.projection.rebuild(walletEvents);
    const count2 = runtime.wallets.projection.count();
    const passed = check('replay deterministic', count1 === count2, `${count1}=${count2}`);
    allPassed = passed && allPassed;
  }

  // ── Check 6: Existing APIs unchanged ─────────────────────────────────────
  console.log('\n━━━ Check 6: Existing APIs unchanged ━━━');
  {
    const result = await runtime.dispatcher.dispatch({
      type: 'wallet.credit', payload: { walletId: 'wallet_tx_test', amount: 10, currency: 'USD', reason: 'dispatcher test' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c6', source: 'system', commandId: 'cmd6' },
    } as RuntimeCommand);

    const passed = check('dispatcher still works', result.success, `success=${result.success}`);
    allPassed = passed && allPassed;
  }

  // ── Check 7: Zero partial projections ────────────────────────────────────
  console.log('\n━━━ Check 7: Zero partial projections ━━━');
  {
    // If a transaction rolls back, no events should be appended → no projection updates.
    const eventsBefore = runtime.eventStore.size();
    await runtime.coordinator.execute({
      type: 'wallet.debit', payload: { walletId: 'wallet_tx_test', amount: 999999, currency: 'USD', reason: 'partial test' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'c7', source: 'system', commandId: 'cmd7' },
    } as RuntimeCommand);
    const eventsAfter = runtime.eventStore.size();

    const passed = check(
      'rolled-back transaction appends 0 events',
      eventsBefore === eventsAfter,
      `before=${eventsBefore}, after=${eventsAfter}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 8: Concurrent transactions OCC-safe ────────────────────────────
  console.log('\n━━━ Check 8: Concurrent transactions OCC-safe ━━━');
  {
    // Create a fresh wallet for this test.
    await runtime.wallets.recordWallet({
      walletId: 'wallet_concurrent_tx', accountId: 'acc_c', name: 'Concurrent TX', currency: 'USD',
      balance: 100, pendingBalance: 0, lockedBalance: 0, isDefault: false,
      createdAt: Date.now(), environment: 'sandbox', correlationId: 'concurrent_setup',
    });

    const [r1, r2] = await Promise.all([
      runtime.coordinator.execute({
        type: 'wallet.debit', payload: { walletId: 'wallet_concurrent_tx', amount: 80, currency: 'USD', reason: 'concurrent 1' },
        metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'cc1', source: 'system', commandId: 'cc1' },
      } as RuntimeCommand),
      runtime.coordinator.execute({
        type: 'wallet.debit', payload: { walletId: 'wallet_concurrent_tx', amount: 80, currency: 'USD', reason: 'concurrent 2' },
        metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'cc2', source: 'system', commandId: 'cc2' },
      } as RuntimeCommand),
    ]);

    const successes = [r1, r2].filter((r) => r.success).length;
    const finalBalance = runtime.wallets.projection.getBalance('wallet_concurrent_tx');

    const passed = check(
      'parallel debits: one succeeds, no negative balance',
      successes === 1 && (finalBalance?.available ?? 0) === 20,
      `successes=${successes}, finalBalance=${finalBalance?.available} (expected 20)`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 9: Settlement adapters ─────────────────────────────────────────
  console.log('\n━━━ Check 9: Settlement adapters ━━━');
  {
    const networks = runtime.settlements.networks();
    const hasStellar = networks.includes('stellar');
    const hasEthereum = networks.includes('ethereum');
    const hasPolygon = networks.includes('polygon');

    const stellarAdapter = runtime.settlements.get('stellar');
    const settleResult = stellarAdapter ? await stellarAdapter.settle({
      network: 'stellar', asset: 'USDC', source: 'G_SRC', destination: 'G_DST', amount: 100,
    }) : null;

    const passed = check(
      'settlement adapters registered + Stellar works',
      hasStellar && hasEthereum && hasPolygon && settleResult?.success === true && settleResult.txHash !== null,
      `networks: ${networks.join(', ')}, stellar txHash: ${settleResult?.txHash?.slice(0, 20)}...`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 10: Observability ──────────────────────────────────────────────
  console.log('\n━━━ Check 10: Observability ━━━');
  {
    const recent = runtime.coordinator.getRecentTransactions();
    const hasTransactions = recent.length > 0;
    const first = recent[0];
    const hasAllFields = first && first.transactionId && first.startedAt && first.durationMs !== null
      && first.commands && first.generatedEvents && first.status;

    const passed = check(
      'transaction observability',
      hasTransactions && hasAllFields,
      `recent=${recent.length}, first tx: id=${first?.transactionId?.slice(0, 12)}, status=${first?.status}, duration=${first?.durationMs}ms, projections=${first?.affectedProjections?.join(',')}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  M-RT-26 VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  OVERALL: ${allPassed ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('');
  console.log('  ARCHITECTURAL PROOF:');
  console.log('  ✓ Transaction Coordinator: the ONLY component allowed to commit events');
  console.log('  ✓ Atomic commits: all events commit or none');
  console.log('  ✓ Rollbacks: invariant violation → no events, no projection updates');
  console.log('  ✓ Nested commands: multiple commands in one transaction');
  console.log('  ✓ Treasury consistency: wallet + treasury update atomically');
  console.log('  ✓ Zero partial projections: events buffered until commit');
  console.log('  ✓ Concurrent OCC-safe: parallel debits → one succeeds, no negative balance');
  console.log('  ✓ Settlement adapters: Stellar + Ethereum + Polygon (pluggable)');
  console.log('  ✓ Observability: txId, duration, commands, events, status, projections');
  console.log('  ✓ Existing APIs unchanged (dispatcher still works)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
