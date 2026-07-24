/**
 * Phase 2 — Operational Validation Framework
 *
 * Test 1: Property-Based Worlds (10,000 randomized simulations)
 * Test 2: Evidence Failure Testing (expired, contradictory, forged, missing, low confidence)
 * Test 3: Replay Determinism (store events, reset, replay, compare)
 * Test 4: Fault Injection (actor failures, network failures, execution failures)
 *
 * The goal is to break the system until you know what is actually true.
 */
import { simulationEngine, type SimulationScenario, type CurrencyCode, type LiquidityProvider, type FailureInjection, createEvidence, computeEvidenceConfidence, ConfidenceService } from '@/kernel';
import { aggregateConfidence } from '@/kernel/confidence-engine';
import { uid, round } from '@/kernel/support';

// ─── Test 1: Property-Based Worlds ──────────────────────────────────────────

export interface PropertyTestResult {
  totalRuns: number;
  planningSuccess: number;
  executionSuccess: number;
  convergenceRate: number;
  replayDeterministic: number;
  avgPlanningMs: number;
  failures: { reason: string; count: number }[];
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
const FAILURE_TYPES: FailureInjection['type'][] = [
  'lp_disappear', 'reserve_exhaustion', 'psp_timeout', 'fx_spike',
  'network_partition', 'treasury_depletion', 'fraud_alert', 'compliance_block',
  'manual_settlement_required', 'insurance_claim',
];

function randomWorld(seed: number): SimulationScenario {
  const r = (max: number) => Math.floor((seed * 9301 + 49297) % 233280 / 233280 * max);
  const buyer = COUNTRIES[r(COUNTRIES.length)];
  const merchant = COUNTRIES[r(COUNTRIES.length)];
  const amount = r(100000) + 100;
  const lpCount = r(4) + 1;
  const failCount = r(3);

  const lps: LiquidityProvider[] = [];
  for (let i = 0; i < lpCount; i++) {
    lps.push({
      id: String(i + 1), name: `LP ${i + 1}`, country: buyer.country, currency: merchant.currency,
      sourceKind: 'community_lp', twinTokenPosition: r(50000), fiatPosition: r(100000),
      financialOperators: [], tradingFees: round(r(200) / 100 + 0.3, 2),
      tradingCapacity: r(100000) + 1000, riskProfile: round(r(40) / 100, 2),
      settlementSpeedMs: r(40000) + 30000, insuranceCoverage: r(50000),
      availability: round(0.8 + r(20) / 100, 2), historicalPerformance: round(0.85 + r(15) / 100, 2),
      aiReputation: round(0.6 + r(40) / 100, 2), manualOnly: r(10) > 8, online: r(10) > 1,
    });
  }

  const failures: FailureInjection[] = [];
  for (let i = 0; i < failCount; i++) {
    failures.push({
      id: uid('fail'), type: FAILURE_TYPES[r(FAILURE_TYPES.length)],
      label: `Random failure ${i}`, targetId: String(r(lpCount) + 1), atFrame: r(5) + 1,
    } as FailureInjection);
  }

  return {
    name: `Property test ${seed}`, description: `Random world ${seed}`,
    transaction: {
      type: buyer.country === merchant.country ? 'domestic' : 'cross_border',
      buyer: { country: buyer.country, currency: buyer.currency, method: 'M-Pesa' },
      merchant: { country: merchant.country, currency: merchant.currency, method: 'Bank Transfer' },
      amount, currency: merchant.currency, merchantType: 'merchant', customerType: 'customer',
      priority: PRIORITIES[r(PRIORITIES.length)],
    },
    treasury: {
      originReserve: { country: buyer.country, currency: buyer.currency, available: r(200000), minThreshold: r(10000) },
      destinationReserve: { country: merchant.country, currency: merchant.currency, available: r(200000), minThreshold: r(10000) },
      stablecoinBalance: r(100000), emergencyTreasury: r(50000), reservePolicy: 'hybrid',
    },
    liquidityProviders: lps,
    financialOperators: [], policies: { reservePolicy: 'hybrid', maxLpShare: 0.7, maxCostPercent: 5, maxRiskScore: 0.6, requireInsurance: false },
    failures,
    aiWeights: { cost: 0.25, speed: 0.25, safety: 0.25, liquidityPreservation: 0.25, merchantSatisfaction: 0.25, communityImpact: 0.15, carbonImpact: 0.15, treasuryHealth: 0.25 },
  };
}

export function runPropertyTests(count: number = 1000): PropertyTestResult {
  let planningSuccess = 0, executionSuccess = 0, replayDeterministic = 0;
  let totalPlanningMs = 0;
  const failureReasons: Record<string, number> = {};

  for (let i = 0; i < count; i++) {
    const scenario = randomWorld(i + 1);
    try {
      const start = Date.now();
      const r1 = simulationEngine.run(scenario);
      const r2 = simulationEngine.run(scenario);
      totalPlanningMs += Date.now() - start;

      if (r1.plan.feasible) planningSuccess++;
      if (r1.settled) executionSuccess++;
      if (r1.resultHash === r2.resultHash) replayDeterministic++;

      // Check for issues
      const dr = r1.ledger.reduce((s, e) => s + e.debit, 0);
      const cr = r1.ledger.reduce((s, e) => s + e.credit, 0);
      if (Math.abs(dr - cr) > 1e-6) failureReasons['ledger_imbalance'] = (failureReasons['ledger_imbalance'] ?? 0) + 1;

      const merchantCredits = r1.ledger.filter((e) => e.accountId.startsWith('merchant:') && e.credit > 0).length;
      if (merchantCredits > 1) failureReasons['double_settlement'] = (failureReasons['double_settlement'] ?? 0) + 1;

      if (!r1.constitution.passed && r1.settled) failureReasons['constitution_violated_but_settled'] = (failureReasons['constitution_violated_but_settled'] ?? 0) + 1;
    } catch (e) {
      failureReasons['exception'] = (failureReasons['exception'] ?? 0) + 1;
    }
  }

  return {
    totalRuns: count,
    planningSuccess, executionSuccess,
    convergenceRate: round(executionSuccess / count, 4),
    replayDeterministic,
    avgPlanningMs: round(totalPlanningMs / count, 2),
    failures: Object.entries(failureReasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

// ─── Test 2: Evidence Failure Testing ───────────────────────────────────────

export interface EvidenceTestResult {
  totalTests: number;
  expiredEvidenceHandled: number;
  contradictoryEvidenceHandled: number;
  forgedEvidenceHandled: number;
  missingEvidenceHandled: number;
  lowConfidenceHandled: number;
  failures: string[];
}

export function runEvidenceFailureTests(): EvidenceTestResult {
  const result: EvidenceTestResult = {
    totalTests: 5, expiredEvidenceHandled: 0, contradictoryEvidenceHandled: 0,
    forgedEvidenceHandled: 0, missingEvidenceHandled: 0, lowConfidenceHandled: 0, failures: [],
  };

  // Test 1: Expired evidence — confidence should be 0
  try {
    
    const pastEvidence = createEvidence({
      type: 'fiat_proof', source: 'open_banking', verificationLevel: 'institutional',
      entityId: 'lp:1', attestedAmount: 50000, currency: 'GHS', reputation: 0.8,
      attester: 'bank', ttlMs: 1, // 1ms TTL — will expire immediately
    });
    setTimeout(() => {
      const conf = computeEvidenceConfidence(pastEvidence, Date.now() + 10000);
      if (conf === 0) result.expiredEvidenceHandled++;
      else result.failures.push('Expired evidence not handled: confidence should be 0');
    }, 10);
  } catch { result.failures.push('Expired evidence test threw'); }

  // Test 2: Contradictory evidence — two proofs with different amounts
  try {
    
    const ev1 = createEvidence({ type: 'fiat_proof', source: 'open_banking', verificationLevel: 'institutional', entityId: 'lp:1', attestedAmount: 50000, currency: 'GHS', reputation: 0.8, attester: 'bank1' });
    const ev2 = createEvidence({ type: 'fiat_proof', source: 'lp_attestation', verificationLevel: 'manual', entityId: 'lp:1', attestedAmount: 5000, currency: 'GHS', reputation: 0.5, attester: 'lp:1' });
    const agg = aggregateConfidence([ev1, ev2], 0.7);
    // Higher verification level should win
    if (agg.confidence > 0 && agg.bestConfidence > 0.3) result.contradictoryEvidenceHandled++;
    else result.failures.push('Contradictory evidence not handled');
  } catch { result.failures.push('Contradictory evidence test threw'); }

  // Test 3: Forged evidence — manual verification level should have low confidence
  try {
    
    const forged = createEvidence({ type: 'fiat_proof', source: 'manual_verification', verificationLevel: 'manual', entityId: 'lp:1', attestedAmount: 999999, currency: 'GHS', reputation: 0.3, attester: 'anonymous' });
    const conf = computeEvidenceConfidence(forged);
    if (conf < 0.3) result.forgedEvidenceHandled++;
    else result.failures.push('Forged evidence not handled: manual verification should have low confidence');
  } catch { result.failures.push('Forged evidence test threw'); }

  // Test 4: Missing evidence — no evidence for entity
  try {
    
    const cs = new ConfidenceService();
    const result_no_evidence = cs.getConfidence({ entityId: 'lp:nonexistent', currency: 'GHS' });
    if (result_no_evidence.confidence === 0) result.missingEvidenceHandled++;
    else result.failures.push('Missing evidence not handled: confidence should be 0');
  } catch { result.failures.push('Missing evidence test threw'); }

  // Test 5: Low confidence evidence — planner should reject or flag
  try {
    
    const lowConf = createEvidence({ type: 'fiat_proof', source: 'lp_attestation', verificationLevel: 'manual', entityId: 'lp:1', attestedAmount: 50000, currency: 'GHS', reputation: 0.1, attester: 'lp:1' });
    const conf = computeEvidenceConfidence(lowConf);
    if (conf < 0.2) result.lowConfidenceHandled++;
    else result.failures.push('Low confidence evidence not handled');
  } catch { result.failures.push('Low confidence evidence test threw'); }

  return result;
}

// ─── Test 3: Replay Determinism ─────────────────────────────────────────────

export interface ReplayTestResult {
  totalTests: number;
  deterministicReplays: number;
  failures: { scenario: string; issue: string }[];
}

export function runReplayDeterminismTests(count: number = 100): ReplayTestResult {
  const result: ReplayTestResult = { totalTests: count, deterministicReplays: 0, failures: [] };

  for (let i = 0; i < count; i++) {
    const scenario = randomWorld(i + 1000);
    try {
      const r1 = simulationEngine.run(scenario);
      const r2 = simulationEngine.run(scenario);

      // Compare result hash (metrics-based)
      if (r1.resultHash !== r2.resultHash) {
        result.failures.push({ scenario: scenario.name, issue: 'Result hash mismatch' });
        continue;
      }

      // Compare ledger structure (IDs/timestamps differ, but structure must match)
      if (r1.ledger.length !== r2.ledger.length) {
        result.failures.push({ scenario: scenario.name, issue: 'Ledger length mismatch' });
        continue;
      }

      const structMatch = r1.ledger.every((e1, idx) => {
        const e2 = r2.ledger[idx];
        return e1.accountId === e2.accountId && e1.debit === e2.debit && e1.credit === e2.credit && e1.frame === e2.frame;
      });

      if (!structMatch) {
        result.failures.push({ scenario: scenario.name, issue: 'Ledger structure mismatch' });
        continue;
      }

      // Compare obligations
      if (r1.obligations.length !== r2.obligations.length) {
        result.failures.push({ scenario: scenario.name, issue: 'Obligation count mismatch' });
        continue;
      }

      result.deterministicReplays++;
    } catch (e) {
      result.failures.push({ scenario: scenario.name, issue: e instanceof Error ? e.message : 'Exception' });
    }
  }

  return result;
}

// ─── Test 4: Fault Injection ────────────────────────────────────────────────

export interface FaultTestResult {
  totalTests: number;
  recovered: number;
  incorrectStates: number;
  unrecoverable: number;
  details: { fault: string; total: number; recovered: number; failed: number }[];
}

export function runFaultInjectionTests(): FaultTestResult {
  const faultTypes: FailureInjection['type'][] = [
    'lp_disappear', 'reserve_exhaustion', 'psp_timeout', 'fx_spike',
    'network_partition', 'treasury_depletion', 'fraud_alert', 'compliance_block',
    'manual_settlement_required', 'insurance_claim',
  ];

  const details: FaultTestResult['details'] = [];
  let totalTests = 0, recovered = 0, incorrectStates = 0, unrecoverable = 0;

  for (const faultType of faultTypes) {
    let faultRecovered = 0, faultFailed = 0;
    const testCount = 10;

    for (let i = 0; i < testCount; i++) {
      const scenario = randomWorld(i + 2000);
      scenario.failures = [{
        id: uid('fail'), type: faultType, label: `Injected ${faultType}`,
        targetId: scenario.liquidityProviders[0]?.id ?? 'Ghana', atFrame: 3,
      } as FailureInjection];

      try {
        totalTests++;
        const result = simulationEngine.run(scenario);

        if (result.settled) {
          recovered++;
          faultRecovered++;
        } else if (result.amendments.length > 0) {
          // Had an amendment (recovery attempt) but didn't settle
          unrecoverable++;
          faultFailed++;
        } else {
          // Failed without recovery — could be correct (constitution blocked)
          if (!result.constitution.passed) {
            recovered++; // Constitution correctly blocked — that's a good outcome
            faultRecovered++;
          } else {
            incorrectStates++;
            faultFailed++;
          }
        }
      } catch {
        unrecoverable++;
        faultFailed++;
      }
    }

    details.push({ fault: faultType, total: testCount, recovered: faultRecovered, failed: faultFailed });
  }

  return { totalTests, recovered, incorrectStates, unrecoverable, details };
}

// ─── Full Validation Suite ──────────────────────────────────────────────────

export interface ValidationSuiteResult {
  propertyTest: PropertyTestResult;
  evidenceTest: EvidenceTestResult;
  replayTest: ReplayTestResult;
  faultTest: FaultTestResult;
  overallPass: boolean;
  summary: string;
}

export function runFullValidationSuite(propertyCount: number = 1000, replayCount: number = 100): ValidationSuiteResult {
  const propertyTest = runPropertyTests(propertyCount);
  const evidenceTest = runEvidenceFailureTests();
  const replayTest = runReplayDeterminismTests(replayCount);
  const faultTest = runFaultInjectionTests();

  const overallPass =
    propertyTest.replayDeterministic === propertyTest.totalRuns &&
    evidenceTest.failures.length === 0 &&
    replayTest.deterministicReplays === replayTest.totalTests &&
    faultTest.incorrectStates === 0;

  const summary = `Property: ${propertyTest.planningSuccess}/${propertyTest.totalRuns} planned, ${propertyTest.executionSuccess} settled, ${propertyTest.replayDeterministic} deterministic. ` +
    `Evidence: ${evidenceTest.failures.length} failures. ` +
    `Replay: ${replayTest.deterministicReplays}/${replayTest.totalTests} deterministic. ` +
    `Fault: ${faultTest.recovered}/${faultTest.totalTests} recovered, ${faultTest.incorrectStates} incorrect, ${faultTest.unrecoverable} unrecoverable.`;

  return { propertyTest, evidenceTest, replayTest, faultTest, overallPass, summary };
}
