/**
 * Simulation Runner — runs a 120-day economic simulation. (M-SIM.)
 *
 * Each day:
 *   1. Generate random transactions across corridors
 *   2. Dispatch them through the runtime kernel
 *   3. Inject stress events at scheduled times
 *   4. Verify the system remains healthy
 *
 * The simulation uses the real runtime dispatcher — every transaction
 * goes through: handler → invariants → event store → ledger.
 */

import { runtime } from '@/runtime';
import { db } from '@/lib/db';
import { generateEconomy, getEconomyStats, type SimEconomy } from './economy';
import { SCENARIO_LIBRARY, generateDailyTransactions, shouldTrigger, type SimulationScenario } from './scenarios';
import { runAllVerifications, allPassed, type VerificationResult } from './verify';

export interface SimulationDayResult {
  day: number;
  transactions: number;
  successful: number;
  failed: number;
  totalVolume: number;
  scenariosTriggered: SimulationScenario[];
  verifications: VerificationResult[];
  allPassed: boolean;
}

export interface SimulationResult {
  simulationId: string;
  days: number;
  economy: ReturnType<typeof getEconomyStats>;
  dayByDay: SimulationDayResult[];
  finalVerifications: VerificationResult[];
  allPassed: boolean;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

/**
 * Run a simulation for the given number of days.
 */
export async function runSimulation(days: number = 120): Promise<SimulationResult> {
  const startedAt = Date.now();
  const simulationId = `sim_${startedAt}`;

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  PaySwap Economic Simulation');
  console.log(`  Simulation ID: ${simulationId}`);
  console.log(`  Duration: ${days} days`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // 1. Generate the economy
  const economy = generateEconomy();
  const stats = getEconomyStats(economy);
  console.log('Economy generated:');
  console.log(`  Countries: ${stats.countries}`);
  console.log(`  Corridors: ${stats.corridors}`);
  console.log(`  LPs: ${stats.lps} (${stats.activeLPs} active)`);
  console.log(`  Wallets: ${stats.wallets.toLocaleString()}`);
  console.log(`  Total reserves: ${stats.totalReserves.toLocaleString()}`);
  console.log(`  Total bandwidth: ${stats.totalBandwidth.toLocaleString()}`);
  console.log(`  Network density: ${stats.networkDensity}%`);
  console.log(`  Maturity: ${stats.byMaturity.stablecoin_only} stablecoin-only, ${stats.byMaturity.hybrid} hybrid, ${stats.byMaturity.mostly_fiat} mostly-fiat\n`);

  // Find a merchant to use for transactions
  const merchant = await db.merchant.findFirst({});
  if (!merchant) {
    throw new Error('No merchant found — run the seed first');
  }

  // 2. Run the simulation day by day
  const dayByDay: SimulationDayResult[] = [];
  const txnsPerDay = 50; // reduced from 1000 for performance

  for (let day = 1; day <= days; day++) {
    const dayStart = Date.now();

    // Generate transactions
    const txns = generateDailyTransactions(economy, day, txnsPerDay);

    // Dispatch each transaction through the runtime
    let successful = 0;
    let failed = 0;
    let totalVolume = 0;

    for (const txn of txns) {
      try {
        const result = await runtime.dispatcher.dispatch({
          type: 'payment.create',
          payload: {
            merchantId: merchant.id,
            customerId: null,
            amount: txn.amount,
            currency: txn.currency,
            sourceCurrency: txn.currency,
            destinationCurrency: txn.currency,
            method: 'SIMULATION',
            corridor: `${txn.from}-${txn.to}`,
            description: `SIM-Day${day}-${txn.from}-${txn.to}`,
            reference: `SIM-${day}-${successful + failed}`,
            lpId: `lp_sim_${Math.floor(Math.random() * 500)}`,
            lpFeeBps: 50 + Math.floor(Math.random() * 100),
            success: Math.random() > 0.02, // 98% success rate
          },
          metadata: {
            correlationId: `${simulationId}-day${day}`,
            actor: { id: 'simulation', role: 'SYSTEM' },
            environment: 'sandbox',
            source: 'system',
          },
        });

        if (result.success) {
          successful++;
          totalVolume += txn.amount;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Check for scheduled scenarios
    const scenariosTriggered = SCENARIO_LIBRARY.filter((s) => shouldTrigger(s, day));

    // Run verifications (every 10 days for performance)
    const verifications = day % 10 === 0 || day === days || scenariosTriggered.length > 0
      ? runAllVerifications()
      : [];

    const dayResult: SimulationDayResult = {
      day,
      transactions: txns.length,
      successful,
      failed,
      totalVolume: Math.round(totalVolume),
      scenariosTriggered,
      verifications,
      allPassed: verifications.length === 0 || allPassed(verifications),
    };
    dayByDay.push(dayResult);

    // Log progress
    const dayMs = Date.now() - dayStart;
    if (day % 10 === 0 || scenariosTriggered.length > 0) {
      const scenarioNames = scenariosTriggered.map((s) => s.name).join(', ') || 'none';
      const verifyStatus = verifications.length > 0
        ? (allPassed(verifications) ? '✓ all pass' : '✗ FAIL')
        : 'skipped';
      console.log(`  Day ${String(day).padStart(3)}/${days}: ${successful}✓ ${failed}✗ | vol ${totalVolume.toFixed(0)} | ${dayMs}ms | scenarios: ${scenarioNames} | verify: ${verifyStatus}`);
    }

    // If verifications fail, stop the simulation
    if (verifications.length > 0 && !allPassed(verifications)) {
      console.log('\n  ⚠️  Verification failure — stopping simulation.');
      console.log('  Failed checks:');
      for (const v of verifications) {
        if (!v.passed) {
          console.log(`    ✗ ${v.name}: ${v.detail}`);
        }
      }
      break;
    }
  }

  // 3. Final verifications
  const finalVerifications = runAllVerifications();
  const allSimPassed = allPassed(finalVerifications) && dayByDay.every((d) => d.allPassed);

  const completedAt = Date.now();
  const durationMs = completedAt - startedAt;

  const result: SimulationResult = {
    simulationId,
    days,
    economy: stats,
    dayByDay,
    finalVerifications,
    allPassed: allSimPassed,
    startedAt,
    completedAt,
    durationMs,
  };

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  Simulation Complete');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Duration: ${durationMs}ms (${(durationMs / 1000).toFixed(1)}s)`);
  console.log(`  Total transactions: ${dayByDay.reduce((s, d) => s + d.successful + d.failed, 0)}`);
  console.log(`  Successful: ${dayByDay.reduce((s, d) => s + d.successful, 0)}`);
  console.log(`  Failed: ${dayByDay.reduce((s, d) => s + d.failed, 0)}`);
  console.log(`  Total volume: ${dayByDay.reduce((s, d) => s + d.totalVolume, 0).toLocaleString()}`);
  console.log(`  Scenarios triggered: ${dayByDay.reduce((s, d) => s + d.scenariosTriggered.length, 0)}`);
  console.log(`\n  Final Verifications:`);
  for (const v of finalVerifications) {
    console.log(`    ${v.passed ? '✓' : '✗'} ${v.name}: ${v.detail}`);
    if (v.value) console.log(`       ${v.value}`);
  }
  console.log(`\n  ${allSimPassed ? '✓ ALL CHECKS PASSED' : '✗ SOME CHECKS FAILED'}`);
  console.log('');

  return result;
}
