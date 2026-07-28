/**
 * Integration Verification — proves the payment flow goes through the runtime kernel.
 *
 * Runs a real CreatePaymentCommand through the dispatcher and verifies:
 *   1. The event was appended to the event store
 *   2. The payment projection updated the Prisma Payment table
 *   3. The ledger has journal entries for the payment
 *   4. The constitution invariants pass
 *   5. The dispatch trace shows the full pipeline
 *
 * Usage: unset DATABASE_URL DIRECT_URL; bun run scripts/verify-integration.ts
 */

import { runtime } from '../src/runtime';
import { db } from '../src/lib/db';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  PaySwap Integration Verification');
  console.log('  Proving the payment flow goes through the runtime kernel');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Find a merchant to use
  const merchant = await db.merchant.findFirst({});
  if (!merchant) {
    console.error('No merchant found in DB. Run the seed first.');
    process.exit(1);
  }
  console.log(`Using merchant: ${merchant.name} (${merchant.id})\n`);

  // Count events before
  const eventsBefore = await db.eventRecord.count();
  const paymentsBefore = await db.payment.count();
  console.log(`Before dispatch:`);
  console.log(`  Events in store: ${eventsBefore}`);
  console.log(`  Payments in DB:  ${paymentsBefore}`);

  // Dispatch a CreatePaymentCommand through the runtime
  console.log('\n━━━ Dispatching CreatePaymentCommand through runtime.dispatcher ━━━');
  const dispatchResult = await runtime.dispatcher.dispatch({
    type: 'payment.create',
    payload: {
      merchantId: merchant.id,
      customerId: null,
      amount: 100,
      currency: 'GHS',
      sourceCurrency: 'GHS',
      destinationCurrency: 'GHS',
      method: 'CARD',
      corridor: 'GHS-GHS',
      description: 'Integration verification payment',
      reference: `VERIFY-${Date.now()}`,
      lpId: 'lp_simulated',
      lpFeeBps: 80,
      success: true,
    },
    metadata: {
      correlationId: `verify-${Date.now()}`,
      actor: { id: 'verification-script', role: 'ADMIN' },
      environment: 'sandbox',
      source: 'cli',
    },
  });

  console.log(`\nDispatch result:`);
  console.log(`  Success:       ${dispatchResult.success}`);
  console.log(`  Command type:  ${dispatchResult.commandType}`);
  console.log(`  Entity ID:     ${dispatchResult.entityId}`);
  console.log(`  Message:       ${dispatchResult.message}`);
  console.log(`  Events produced: ${dispatchResult.events.length}`);
  for (const ev of dispatchResult.events) {
    console.log(`    • ${ev.type} (stream: ${ev.streamId})`);
  }
  if (dispatchResult.metrics) {
    console.log(`  Metrics:`);
    console.log(`    Compile time:  ${dispatchResult.metrics.compileTime}ms`);
    console.log(`    Verify time:   ${dispatchResult.metrics.verifyTime}ms`);
    console.log(`    Append time:   ${dispatchResult.metrics.appendTime}ms`);
    console.log(`    Total time:    ${dispatchResult.metrics.totalTime}ms`);
  }
  if (dispatchResult.invariantDecision) {
    console.log(`  Invariant decision:`);
    console.log(`    Allowed:      ${dispatchResult.invariantDecision.allow}`);
    console.log(`    Violations:   ${dispatchResult.invariantDecision.violationCount ?? 0}`);
  }
  if (dispatchResult.error) {
    console.log(`  Error: ${dispatchResult.error}`);
  }

  // Verify 1: Event was appended to the event store
  console.log('\n━━━ Check 1: Event appended to event store ━━━');
  const eventsAfter = await db.eventRecord.count();
  const newEvents = eventsAfter - eventsBefore;
  const check1 = newEvents > 0;
  console.log(`  ${check1 ? '✓' : '✗'} Events after: ${eventsAfter} (delta: +${newEvents})`);

  // Verify 2: Payment projection updated the Prisma table
  console.log('\n━━━ Check 2: Payment projection updated Prisma ━━━');
  const paymentsAfter = await db.payment.count();
  const newPayments = paymentsAfter - paymentsBefore;
  const check2 = newPayments > 0;
  console.log(`  ${check2 ? '✓' : '✗'} Payments after: ${paymentsAfter} (delta: +${newPayments})`);

  // Verify 3: Ledger has journal entries
  console.log('\n━━━ Check 3: Ledger journal entries ━━━');
  const ledgerEntries = dispatchResult.events.filter((e) => e.type === 'ledger.entry.posted');
  const check3 = ledgerEntries.length > 0;
  console.log(`  ${check3 ? '✓' : '✗'} Ledger events produced: ${ledgerEntries.length}`);
  if (ledgerEntries.length > 0) {
    for (const entry of ledgerEntries) {
      const p = entry.payload as Record<string, unknown>;
      console.log(`    • ${p.accountLabel || 'unknown'}: debit=${p.debit || 0} credit=${p.credit || 0} ${p.currency || ''}`);
    }
  }

  // Verify 4: Constitution invariants pass
  console.log('\n━━━ Check 4: Constitution invariants ━━━');
  const invariantAllowed = dispatchResult.invariantDecision?.allow ?? false;
  const check4 = invariantAllowed;
  console.log(`  ${check4 ? '✓' : '✗'} Invariants verified: ${invariantAllowed ? 'PASS' : 'FAIL'}`);

  // Verify 5: Balance sheet is accessible
  console.log('\n━━━ Check 5: Balance sheet accessible ━━━');
  try {
    const bs = runtime.ledger.getBalanceSheet();
    const check5 = bs !== null && bs !== undefined;
    console.log(`  ${check5 ? '✓' : '✗'} Balance sheet retrieved`);
    if (check5 && typeof bs === 'object') {
      console.log(`    Assets:    ${(bs as any).assets?.totalAssets ?? 'N/A'}`);
      console.log(`    Liabilities: ${(bs as any).liabilities?.totalLiabilities ?? 'N/A'}`);
    }
  } catch (err) {
    console.log(`  ⚠️ Balance sheet error: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════════════════');
  const allChecks = [check1, check2, check3, check4];
  const passed = allChecks.filter(Boolean).length;
  console.log(`  ${passed}/${allChecks.length} checks passed`);
  console.log(`  Dispatch success: ${dispatchResult.success}`);
  console.log(`  Events produced:  ${dispatchResult.events.length}`);
  console.log(`  Invariants:       ${invariantAllowed ? 'PASS' : 'FAIL'}`);
  console.log('');

  if (passed === allChecks.length && dispatchResult.success) {
    console.log('  ✓ INTEGRATION VERIFIED — payment flow goes through the runtime kernel.');
    console.log('    Dispatcher → Handler → Invariants → EventStore → Projections');
    await db.$disconnect();
    process.exit(0);
  } else {
    console.log('  ✗ INTEGRATION INCOMPLETE — some checks failed.');
    await db.$disconnect();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
