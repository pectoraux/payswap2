/**
 * PaySwap Protocol — Continuous Fuzzing Harness.
 *
 * Instead of 20 fixed scenarios, run 1,000,000 randomized worlds with random
 * intents, random outages, random fraud, random reserve depletion, random FX
 * changes, random connector failures. Then replay and verify:
 *
 *   - deterministic (same input → same output)
 *   - obligations converge (or fail for the right reason)
 *   - ledger balances
 *   - replay identical
 *   - no double settlement
 *   - no asset creation
 *   - no exposure overflow
 *
 * If the runtime survives that, the architecture is validated much more
 * convincingly than by adding any new abstraction.
 */
import { simulationEngine, defaultScenario, type SimulationScenario, type CurrencyCode, type FailureInjection, type LiquidityProvider } from '@/kernel';
import { uid, round } from '@/kernel/support';

export interface FuzzResult {
  iteration: number;
  scenarioName: string;
  settled: boolean;
  constitutionPassed: boolean;
  deterministic: boolean;
  obligationsConverged: boolean;
  ledgerBalanced: boolean;
  noDoubleSettlement: boolean;
  noAssetCreation: boolean;
  noExposureOverflow: boolean;
  replayIdentical: boolean;
  errors: string[];
  durationMs: number;
}

export interface FuzzSummary {
  totalRuns: number;
  passed: number;
  failed: number;
  deterministicFailures: number;
  convergenceRate: number;
  avgDurationMs: number;
  errorBreakdown: Record<string, number>;
}

const COUNTRIES: { country: string; currency: CurrencyCode }[] = [
  { country: 'Kenya', currency: 'KES' },
  { country: 'Ghana', currency: 'GHS' },
  { country: 'Nigeria', currency: 'NGN' },
  { country: 'South Africa', currency: 'ZAR' },
  { country: 'Uganda', currency: 'UGX' },
  { country: 'Tanzania', currency: 'TZS' },
];

const PRIORITIES = ['cheapest', 'fastest', 'safest', 'balanced', 'impact'] as const;
const FAILURE_TYPES = ['lp_disappear', 'reserve_exhaustion', 'psp_timeout', 'fx_spike', 'network_partition', 'treasury_depletion', 'fraud_alert', 'compliance_block', 'manual_settlement_required', 'insurance_claim'] as const;

/** Generate a random scenario. */
function randomScenario(iteration: number): SimulationScenario {
  const buyer = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  const merchant = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  const amount = Math.floor(Math.random() * 100000) + 1000;
  const priority = PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)];
  const lpCount = Math.floor(Math.random() * 4) + 1;
  const failureCount = Math.floor(Math.random() * 3);

  const liquidityProviders: LiquidityProvider[] = [];
  for (let i = 0; i < lpCount; i++) {
    liquidityProviders.push({
      id: String(i + 1),
      name: `LP ${i + 1}`,
      country: buyer.country,
      currency: merchant.currency,
      sourceKind: 'community_lp',
      twinTokenPosition: Math.floor(Math.random() * 50000),
      fiatPosition: Math.floor(Math.random() * 100000),
      financialOperators: [],
      tradingFees: round(Math.random() * 2 + 0.3, 2),
      tradingCapacity: Math.floor(Math.random() * 100000) + 5000,
      riskProfile: round(Math.random() * 0.4, 2),
      settlementSpeedMs: Math.floor(Math.random() * 40000) + 30000,
      insuranceCoverage: Math.floor(Math.random() * 50000),
      availability: round(0.8 + Math.random() * 0.2, 2),
      historicalPerformance: round(0.85 + Math.random() * 0.15, 2),
      aiReputation: round(0.6 + Math.random() * 0.4, 2),
      manualOnly: Math.random() > 0.8,
      online: Math.random() > 0.15,
    });
  }

  const failures: FailureInjection[] = [];
  for (let i = 0; i < failureCount; i++) {
    const type = FAILURE_TYPES[Math.floor(Math.random() * FAILURE_TYPES.length)];
    failures.push({
      id: uid('fail'),
      type: type as FailureInjection['type'],
      label: `Fuzz failure ${type}`,
      targetId: type === 'lp_disappear' ? String(Math.floor(Math.random() * lpCount) + 1) : buyer.country,
      atFrame: Math.floor(Math.random() * 5) + 1,
    } as FailureInjection);
  }

  return {
    name: `Fuzz #${iteration}: ${buyer.country}→${merchant.country} ${amount} ${merchant.currency}`,
    description: `Randomized scenario ${iteration}`,
    transaction: {
      type: buyer.country === merchant.country ? 'domestic' : 'cross_border',
      buyer: { country: buyer.country, currency: buyer.currency, method: 'M-Pesa' },
      merchant: { country: merchant.country, currency: merchant.currency, method: 'Bank Transfer' },
      amount,
      currency: merchant.currency,
      merchantType: 'merchant',
      customerType: 'customer',
      priority: priority as SimulationScenario['transaction']['priority'],
    },
    treasury: {
      originReserve: { country: buyer.country, currency: buyer.currency, available: Math.floor(Math.random() * 200000), minThreshold: Math.floor(Math.random() * 10000) },
      destinationReserve: { country: merchant.country, currency: merchant.currency, available: Math.floor(Math.random() * 200000), minThreshold: Math.floor(Math.random() * 10000) },
      stablecoinBalance: Math.floor(Math.random() * 100000),
      emergencyTreasury: Math.floor(Math.random() * 50000),
      reservePolicy: 'hybrid',
    },
    liquidityProviders,
    financialOperators: defaultScenario().financialOperators,
    policies: {
      reservePolicy: 'hybrid',
      maxLpShare: 0.7,
      maxCostPercent: 5,
      maxRiskScore: 0.6,
      requireInsurance: false,
    },
    failures,
    aiWeights: { cost: 0.25, speed: 0.25, safety: 0.25, liquidityPreservation: 0.25, merchantSatisfaction: 0.25, communityImpact: 0.15, carbonImpact: 0.15, treasuryHealth: 0.25 },
  };
}

/** Run a single fuzz iteration. */
function runFuzzIteration(iteration: number): FuzzResult {
  const start = Date.now();
  const scenario = randomScenario(iteration);
  const errors: string[] = [];

  let result1, result2;
  try {
    result1 = simulationEngine.run(scenario);
    // Run again to verify determinism
    result2 = simulationEngine.run(scenario);
  } catch (e) {
    return {
      iteration, scenarioName: scenario.name, settled: false, constitutionPassed: false,
      deterministic: false, obligationsConverged: false, ledgerBalanced: false,
      noDoubleSettlement: false, noAssetCreation: false, noExposureOverflow: false,
      replayIdentical: false, errors: [e instanceof Error ? e.message : 'Unknown error'], durationMs: Date.now() - start,
    };
  }

  // Verify determinism (same metrics → same hash = deterministic convergence)
  const deterministic = result1.resultHash === result2.resultHash;

  // Verify obligations converge (or fail for the right reason)
  const obligationsConverged = result1.obligations.every((o) => o.state === 'fulfilled' || o.state === 'breached' || o.state === 'cancelled');
  if (!obligationsConverged) errors.push('Obligations not converged');

  // Verify ledger balanced
  const dr = result1.ledger.reduce((s, e) => s + e.debit, 0);
  const cr = result1.ledger.reduce((s, e) => s + e.credit, 0);
  const ledgerBalanced = Math.abs(dr - cr) < 1e-6;
  if (!ledgerBalanced) errors.push('Ledger not balanced');

  // Verify no double settlement
  const merchantCredits = result1.ledger.filter((e) => e.accountId.startsWith('merchant:') && e.credit > 0).length;
  const noDoubleSettlement = merchantCredits <= 1;
  if (!noDoubleSettlement) errors.push('Double settlement detected');

  // Verify no asset creation (twin tokens backed)
  const minted = result1.twinTokens.reduce((s, t) => s + t.amount, 0);
  const backing = result1.plan.sourceDraws.reduce((s, d) => s + d.drawn, 0);
  const noAssetCreation = backing >= minted - 1e-6;
  if (!noAssetCreation) errors.push('Unbacked asset created');

  // Verify no exposure overflow (via resource reservations)
  const noExposureOverflow = result1.reservations.every((r) => r.amount >= 0);
  if (!noExposureOverflow) errors.push('Exposure overflow');

  // Verify replay identical (structural — IDs/timestamps differ but structure must match)
  const replayIdentical = result1.ledger.length === result2.ledger.length &&
    result1.ledger.every((e1, i) => {
      const e2 = result2.ledger[i];
      return e1.accountId === e2.accountId && e1.debit === e2.debit && e1.credit === e2.credit && e1.frame === e2.frame;
    });

  return {
    iteration, scenarioName: scenario.name,
    settled: result1.settled,
    constitutionPassed: result1.constitution.passed,
    deterministic, obligationsConverged, ledgerBalanced,
    noDoubleSettlement, noAssetCreation, noExposureOverflow, replayIdentical,
    errors, durationMs: Date.now() - start,
  };
}

/** Run N fuzz iterations and return summary. */
export function fuzz(count: number = 100): { results: FuzzResult[]; summary: FuzzSummary } {
  const results: FuzzResult[] = [];
  const errorBreakdown: Record<string, number> = {};

  for (let i = 0; i < count; i++) {
    const result = runFuzzIteration(i + 1);
    results.push(result);
    for (const err of result.errors) {
      errorBreakdown[err] = (errorBreakdown[err] ?? 0) + 1;
    }
  }

  const passed = results.filter((r) => r.errors.length === 0).length;
  const deterministicFailures = results.filter((r) => !r.deterministic || !r.replayIdentical).length;
  const convergenceRate = results.filter((r) => r.obligationsConverged).length / results.length;
  const avgDurationMs = results.reduce((s, r) => s + r.durationMs, 0) / results.length;

  return {
    results,
    summary: {
      totalRuns: count,
      passed,
      failed: count - passed,
      deterministicFailures,
      convergenceRate: round(convergenceRate, 4),
      avgDurationMs: round(avgDurationMs, 2),
      errorBreakdown,
    },
  };
}
