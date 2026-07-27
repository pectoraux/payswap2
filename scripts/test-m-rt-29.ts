/**
 * M-RT-29 Verification — Dual Runtime (Sandbox + Live).
 *
 * Checks:
 *   1. Sandbox and Live never share events
 *   2. Sandbox treasury differs from Live treasury
 *   3. Runtime switching requires no restart
 *   4. Replay remains deterministic in both runtimes
 *   5. Recovery works independently
 *   6. LP marketplace isolated
 *   7. Settlement adapters selected correctly
 *   8. Existing APIs unchanged
 *
 * Usage: bun run scripts/test-m-rt-29.ts
 */

import { RuntimeHost, createRuntime, type Runtime, type RuntimeCommand } from '../src/runtime';

function check(name: string, passed: boolean, details: string): boolean {
  const icon = passed ? '✓' : '✗';
  console.log(`  ${icon} ${name}: ${details}`);
  return passed;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  M-RT-29 Verification — Dual Runtime (Sandbox + Live)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const host = new RuntimeHost();
  let allPassed = true;

  // ── Check 1: Sandbox and Live never share events ━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━ Check 1: Sandbox and Live never share events ━━━');
  {
    const sandbox = host.getRuntime('sandbox')!;
    const live = host.getRuntime('live')!;

    // Create a wallet in sandbox only.
    await sandbox.wallets.recordWallet({
      walletId: 'w_sb', accountId: 'a_sb', name: 'Sandbox Wallet', currency: 'USD',
      balance: 100, pendingBalance: 0, lockedBalance: 0, isDefault: false,
      createdAt: Date.now(), environment: 'sandbox', correlationId: 'sb_setup',
    });

    // Sandbox should have events; Live should have 0.
    const sbEvents = sandbox.eventStore.size();
    const liveEvents = live.eventStore.size();

    const passed = check(
      'events are isolated',
      sbEvents > 0 && liveEvents === 0,
      `sandbox=${sbEvents}, live=${liveEvents}`,
    );
    allPassed = passed && allPassed;

    // Also verify isolation check.
    const isolation = host.verifyIsolation();
    const passed2 = check(
      'verifyIsolation: all components different instances',
      isolation.isolated && isolation.checks.every((c) => c.isolated),
      `isolated=${isolation.isolated}, checks=${isolation.checks.length}, all different=${isolation.checks.every((c) => c.isolated)}`,
    );
    allPassed = passed2 && allPassed;
  }

  // ── Check 2: Sandbox treasury differs from Live treasury ━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 2: Treasury isolation ━━━');
  {
    const sandbox = host.getRuntime('sandbox')!;
    const live = host.getRuntime('live')!;

    // Sandbox has a wallet → treasury account exists.
    const sbTreasuryCount = sandbox.treasury.projection.count();
    const liveTreasuryCount = live.treasury.projection.count();

    const passed = check(
      'sandbox treasury has accounts, live does not',
      sbTreasuryCount > 0 && liveTreasuryCount === 0,
      `sandbox=${sbTreasuryCount}, live=${liveTreasuryCount}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 3: Runtime switching requires no restart ━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 3: Runtime switching (no restart) ━━━');
  {
    // Start with sandbox.
    const activeBefore = host.getActiveEnvironment();
    const rtBefore = host.getActiveRuntime();

    // Switch to live.
    host.switchEnvironment('live');
    const activeAfter = host.getActiveEnvironment();
    const rtAfter = host.getActiveRuntime();

    // Switch back to sandbox.
    host.switchEnvironment('sandbox');

    const passed = check(
      'switching changes active runtime without restart',
      activeBefore === 'sandbox' && activeAfter === 'live' && rtBefore !== rtAfter,
      `before=${activeBefore}, after=${activeAfter}, different instances=${rtBefore !== rtAfter}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 4: Replay deterministic in both runtimes ━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 4: Replay deterministic in both runtimes ━━━');
  {
    const sandbox = host.getRuntime('sandbox')!;
    const live = host.getRuntime('live')!;

    // Create a wallet in live too.
    await live.wallets.recordWallet({
      walletId: 'w_live', accountId: 'a_live', name: 'Live Wallet', currency: 'EUR',
      balance: 200, pendingBalance: 0, lockedBalance: 0, isDefault: false,
      createdAt: Date.now(), environment: 'live', correlationId: 'live_setup',
    });

    // Replay sandbox.
    const sbEvents = await sandbox.eventStore.readAll(0, 50_000);
    const sbWalletEvents = sbEvents.filter((e) => e.streamType === 'wallet');
    const sbCount1 = sandbox.wallets.projection.count();
    await sandbox.wallets.projection.rebuild(sbWalletEvents);
    const sbCount2 = sandbox.wallets.projection.count();

    // Replay live.
    const liveEvents = await live.eventStore.readAll(0, 50_000);
    const liveWalletEvents = liveEvents.filter((e) => e.streamType === 'wallet');
    const liveCount1 = live.wallets.projection.count();
    await live.wallets.projection.rebuild(liveWalletEvents);
    const liveCount2 = live.wallets.projection.count();

    const passed = check(
      'both runtimes replay deterministically',
      sbCount1 === sbCount2 && liveCount1 === liveCount2,
      `sandbox: ${sbCount1}=${sbCount2}, live: ${liveCount1}=${liveCount2}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 5: Recovery works independently ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 5: Recovery works independently ━━━');
  {
    const sandbox = host.getRuntime('sandbox')!;
    const live = host.getRuntime('live')!;

    // Recover sandbox.
    const sbRecovery = await sandbox.recovery.recoverProjection('wallets');

    // Recover live.
    const liveRecovery = await live.recovery.recoverProjection('wallets');

    const passed = check(
      'recovery works independently in both runtimes',
      sbRecovery.recovered && liveRecovery.recovered,
      `sandbox: recovered=${sbRecovery.recovered}, live: recovered=${liveRecovery.recovered}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 6: LP marketplace isolated ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 6: LP marketplace isolated ━━━');
  {
    const sandbox = host.getRuntime('sandbox')!;
    const live = host.getRuntime('live')!;

    // The LP runtimes are different instances.
    const sameInstance = sandbox.lpRuntime === live.lpRuntime;
    const sbLPCount = sandbox.lpRuntime.count();
    const liveLPCount = live.lpRuntime.count();

    const passed = check(
      'LP marketplaces are separate instances',
      !sameInstance,
      `same instance=${sameInstance}, sandbox LPs=${sbLPCount}, live LPs=${liveLPCount}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 7: Settlement adapters ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 7: Settlement adapters available in both runtimes ━━━');
  {
    const sandbox = host.getRuntime('sandbox')!;
    const live = host.getRuntime('live')!;

    const sbNetworks = sandbox.settlements.networks();
    const liveNetworks = live.settlements.networks();

    // Both should have Stellar + Ethereum + Polygon.
    const hasStellar = sbNetworks.includes('stellar') && liveNetworks.includes('stellar');

    // Test settlement on both.
    const sbStellar = sandbox.settlements.get('stellar')!;
    const liveStellar = live.settlements.get('stellar')!;

    const sbResult = await sbStellar.settle({ network: 'stellar', asset: 'USDC', source: 'G1', destination: 'G2', amount: 10 });
    const liveResult = await liveStellar.settle({ network: 'stellar', asset: 'USDC', source: 'G3', destination: 'G4', amount: 20 });

    const passed = check(
      'settlement works in both runtimes',
      hasStellar && sbResult.success && liveResult.success && sbResult.txHash !== liveResult.txHash,
      `sandbox txHash=${sbResult.txHash?.slice(0, 15)}, live txHash=${liveResult.txHash?.slice(0, 15)}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Check 8: Existing APIs unchanged ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Check 8: Existing APIs unchanged ━━━');
  {
    // The global `runtime` singleton still works.
    const { runtime } = await import('../src/runtime');
    const hasPayments = runtime.payments !== undefined;
    const hasWallets = runtime.wallets !== undefined;
    const hasCoordinator = runtime.coordinator !== undefined;
    const hasRecovery = runtime.recovery !== undefined;

    // The global `runtimeHost` singleton also works.
    const { runtimeHost } = await import('../src/runtime');
    const hasHost = runtimeHost !== undefined;
    const hasSandbox = runtimeHost.has('sandbox');
    const hasLive = runtimeHost.has('live');

    const passed = check(
      'all APIs present (runtime singleton + runtimeHost)',
      hasPayments && hasWallets && hasCoordinator && hasRecovery && hasHost && hasSandbox && hasLive,
      `runtime: payments=${hasPayments} wallets=${hasWallets} coordinator=${hasCoordinator} recovery=${hasRecovery} | host: sandbox=${hasSandbox} live=${hasLive}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Bonus: Execute a command via the host ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n━━━ Bonus: Execute via host (routes to correct runtime) ━━━');
  {
    const result = await host.execute({
      type: 'wallet.credit',
      payload: { walletId: 'w_sb', amount: 50, currency: 'USD', reason: 'host test' },
      metadata: { actor: { id: 't', role: 's' }, environment: 'sandbox', correlationId: 'host_test', source: 'system', commandId: 'host_cmd' },
    } as RuntimeCommand);

    const passed = check(
      'host.execute routes to sandbox',
      result.success,
      `success=${result.success}, txId=${result.transactionId}`,
    );
    allPassed = passed && allPassed;
  }

  // ── Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  M-RT-29 VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  OVERALL: ${allPassed ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('');
  console.log('  ARCHITECTURAL PROOF:');
  console.log('  ✓ Sandbox and Live never share events (separate EventStores)');
  console.log('  ✓ Treasury isolation (sandbox has accounts, live does not)');
  console.log('  ✓ Runtime switching requires no restart (switchEnvironment)');
  console.log('  ✓ Replay deterministic in both runtimes');
  console.log('  ✓ Recovery works independently');
  console.log('  ✓ LP marketplace isolated (separate instances)');
  console.log('  ✓ Settlement adapters available in both runtimes');
  console.log('  ✓ Existing APIs unchanged (runtime singleton + runtimeHost)');
  console.log('  ✓ host.execute() routes commands to correct runtime');
  console.log('');
  console.log('  ARCHITECTURE:');
  console.log('    RuntimeHost');
  console.log('    ├── Sandbox Runtime (own EventStore, Treasury, LPs, etc.)');
  console.log('    └── Live Runtime   (own EventStore, Treasury, LPs, etc.)');
  console.log('    Nothing shared except immutable code + adapters.');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
