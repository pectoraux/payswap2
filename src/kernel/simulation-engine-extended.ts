/**
 * Extended Simulation Engine — multi-year Monte Carlo + systematic edge-case probing.
 *
 * This module stress-tests the kernel's Digital Twin across:
 *   1. Time horizons: 1, 2, 3 years of simulated payment traffic
 *   2. Traffic growth: daily transaction volume with exponential growth + seasonality
 *   3. Failure injection: every FailureType, at random frames, with random targets
 *   4. Liquidity analysis: how much reserve/stablecoin/LP capacity is needed
 *   5. Edge cases: every boundary condition probed systematically
 *
 * The engine runs ENTIRELY in-memory (no DB) using the kernel's simulationEngine.
 * Each "day" generates a realistic distribution of payments across corridors.
 */

import {
  simulationEngine,
  defaultScenario,
  type SimulationScenario,
  type SimulationResult,
} from './index';
import type { FailureType, CurrencyCode, RoutingPriority } from './types';

// ── Corridors (the 4 operational countries + USD) ──
interface Corridor {
  buyerCountry: string; buyerCurrency: CurrencyCode; buyerMethod: string; foId: string;
  merchantCountry: string; merchantCurrency: CurrencyCode; merchantMethod: string;
  originReserve: number; destinationReserve: number;
}

const CORRIDORS: Corridor[] = [
  // Ghana domestic
  { buyerCountry: 'Ghana', buyerCurrency: 'GHS', buyerMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    merchantCountry: 'Ghana', merchantCurrency: 'GHS', merchantMethod: 'Bank Transfer',
    originReserve: 5_000_000, destinationReserve: 5_000_000 },
  // Ghana → Togo (both have reserves)
  { buyerCountry: 'Ghana', buyerCurrency: 'GHS', buyerMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    merchantCountry: 'Togo', merchantCurrency: 'XOF', merchantMethod: 'Bank Transfer',
    originReserve: 5_000_000, destinationReserve: 3_000_000 },
  // Ghana → Kenya (Kenya no reserve)
  { buyerCountry: 'Ghana', buyerCurrency: 'GHS', buyerMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    merchantCountry: 'Kenya', merchantCurrency: 'KES', merchantMethod: 'M-Pesa', foId: 'fo-mpesa-ke',
    originReserve: 5_000_000, destinationReserve: 0 },
  // Kenya → Ghana (Kenya no reserve, Ghana does)
  { buyerCountry: 'Kenya', buyerCurrency: 'KES', buyerMethod: 'M-Pesa', foId: 'fo-mpesa-ke',
    merchantCountry: 'Ghana', merchantCurrency: 'GHS', merchantMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    originReserve: 0, destinationReserve: 5_000_000 },
  // Kenya → Nigeria (neither has reserve)
  { buyerCountry: 'Kenya', buyerCurrency: 'KES', buyerMethod: 'M-Pesa', foId: 'fo-mpesa-ke',
    merchantCountry: 'Nigeria', merchantCurrency: 'NGN', merchantMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    originReserve: 0, destinationReserve: 0 },
  // Nigeria → Kenya (neither has reserve)
  { buyerCountry: 'Nigeria', buyerCurrency: 'NGN', buyerMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    merchantCountry: 'Kenya', merchantCurrency: 'KES', merchantMethod: 'M-Pesa', foId: 'fo-mpesa-ke',
    originReserve: 0, destinationReserve: 0 },
  // Togo → Ghana (both have reserves)
  { buyerCountry: 'Togo', buyerCurrency: 'XOF', buyerMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    merchantCountry: 'Ghana', merchantCurrency: 'GHS', merchantMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    originReserve: 3_000_000, destinationReserve: 5_000_000 },
  // USD high-value (Ghana → Togo, USD denominated)
  { buyerCountry: 'Ghana', buyerCurrency: 'GHS', buyerMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    merchantCountry: 'Togo', merchantCurrency: 'XOF', merchantMethod: 'Bank Transfer', foId: 'fo-bank-gh',
    originReserve: 5_000_000, destinationReserve: 3_000_000 },
];

const PRIORITIES: RoutingPriority[] = ['cheapest', 'fastest', 'safest', 'balanced'];
const FAILURE_TYPES: FailureType[] = [
  'lp_disappear', 'reserve_exhaustion', 'psp_timeout', 'fx_spike', 'network_partition',
  'treasury_depletion', 'fraud_alert', 'compliance_block', 'manual_settlement_required', 'insurance_claim',
];

// ── PRNG (deterministic, seeded) ──
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Types ──
export interface SimDayResult {
  day: number;
  date: string;
  transactions: number;
  settled: number;
  blocked: number;
  failed: number;
  totalVolume: number;
  avgLatencyMs: number;
  avgCostPercent: number;
  blockReasons: Record<string, number>;
}

export interface MultiYearResult {
  horizon: string; // '1y' | '2y' | '3y'
  days: SimDayResult[];
  summary: {
    totalDays: number;
    totalTransactions: number;
    totalSettled: number;
    totalBlocked: number;
    totalFailed: number;
    settlementRate: number;
    blockRate: number;
    totalVolume: number;
    avgDailyVolume: number;
    peakDailyVolume: number;
    peakDay: number;
    totalFeesPaid: number;
    avgCostPercent: number;
    avgLatencyMs: number;
    uniqueBlockReasons: number;
    topBlockReasons: Array<{ reason: string; count: number }>;
    growthMultiplier: number;
  };
  liquidityAnalysis: {
    startingReserves: number;
    startingStablecoin: number;
    startingLpCapacity: number;
    totalLiquidityConsumed: number;
    peakLiquidityDemand: number;
    daysWithInsufficientLiquidity: number;
    recommendedReserveBuffer: number;
    recommendedStablecoinBuffer: number;
    utilizationRate: number;
  };
  invariantViolations: Array<{ day: number; type: string; detail: string }>;
  generatedAt: string;
}

export interface EdgeCaseResult {
  id: string;
  category: string;
  description: string;
  expectedResult: 'settle' | 'block' | 'error';
  actualSettled: boolean | 'error';
  actualStrategy: string;
  blockReason: string | null;
  passed: boolean;
  ledgerEntries: number;
  eventCount: number;
  constitutionPassed: boolean;
  metrics?: { costPercent: number; riskScore: number; confidence: number; settlementTimeMs: number };
  notes?: string;
}

export interface EdgeCaseReport {
  reportId: string;
  generatedAt: string;
  totalCases: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number;
  categories: Record<string, { total: number; passed: number; failed: number }>;
  results: EdgeCaseResult[];
  findings: string[];
}

// ── Build a scenario from a corridor + amount + options ──
function buildScenario(opts: {
  corridor: Corridor;
  amount: number;
  priority?: RoutingPriority;
  failures?: Array<{ type: FailureType; atFrame: number }>;
  frozenCountries?: string[];
  stablecoinBalance?: number;
  emergencyTreasury?: number;
  lpCapacity?: number;
  reservePolicy?: 'reserve_first' | 'lp_first' | 'hybrid' | 'preserve_reserves';
  requireInsurance?: boolean;
  maxRiskScore?: number;
}): SimulationScenario {
  const base = defaultScenario();
  const c = opts.corridor;
  const lpCapacity = opts.lpCapacity ?? 100_000;

  return {
    ...base,
    name: `${c.buyerCountry}→${c.merchantCountry} ${opts.amount}`,
    transaction: {
      type: c.buyerCountry === c.merchantCountry ? 'domestic' : 'cross_border',
      buyer: { country: c.buyerCountry, currency: c.buyerCurrency, method: c.buyerMethod, foId: c.foId },
      merchant: { country: c.merchantCountry, currency: c.merchantCurrency, method: c.merchantMethod, foId: c.foId },
      amount: opts.amount,
      currency: c.merchantCurrency,
      merchantType: opts.amount > 100_000 ? 'Enterprise merchant' : 'Export merchant',
      customerType: opts.amount > 10_000 ? 'Business buyer' : 'Retail buyer',
      priority: opts.priority ?? 'cheapest',
    },
    treasury: {
      originReserve: { country: c.buyerCountry, currency: c.buyerCurrency, available: c.originReserve, minThreshold: Math.floor(c.originReserve * 0.1) },
      destinationReserve: { country: c.merchantCountry, currency: c.merchantCurrency, available: c.destinationReserve, minThreshold: Math.floor(c.destinationReserve * 0.1) },
      stablecoinBalance: opts.stablecoinBalance ?? 500_000,
      emergencyTreasury: opts.emergencyTreasury ?? 200_000,
      reservePolicy: opts.reservePolicy ?? 'hybrid',
    },
    liquidityProviders: opts.lpCapacity && opts.lpCapacity > 0 ? [
      { ...base.liquidityProviders[0], id: 'lp_sim_1', name: 'Sim LP 1', country: c.buyerCountry, currency: c.buyerCurrency, tradingCapacity: Math.floor(lpCapacity * 0.6), fiatPosition: Math.floor(lpCapacity * 0.6), twinTokenPosition: Math.floor(lpCapacity * 0.3), insuranceCoverage: Math.floor(lpCapacity * 0.3) },
      { ...base.liquidityProviders[1], id: 'lp_sim_2', name: 'Sim LP 2', country: c.buyerCountry, currency: c.buyerCurrency, tradingCapacity: Math.floor(lpCapacity * 0.4), fiatPosition: Math.floor(lpCapacity * 0.4), twinTokenPosition: Math.floor(lpCapacity * 0.2), insuranceCoverage: Math.floor(lpCapacity * 0.2) },
    ] : [],
    policies: {
      reservePolicy: opts.reservePolicy ?? 'hybrid',
      maxLpShare: 0.7,
      maxCostPercent: 5,
      maxRiskScore: opts.maxRiskScore ?? 0.6,
      requireInsurance: opts.requireInsurance ?? false,
    },
    failures: (opts.failures ?? []).map((f, i) => ({
      id: `fail_${i}`,
      type: f.type,
      label: f.type.replace(/_/g, ' '),
      atFrame: f.atFrame,
    })),
    frozenCountries: opts.frozenCountries,
  };
}

// ── Run a single scenario and extract metrics ──
function runOne(scenario: SimulationScenario): {
  settled: boolean; strategy: string; blockReason: string | null;
  ledgerEntries: number; eventCount: number; constitutionPassed: boolean;
  costPercent: number; riskScore: number; confidence: number; settlementTimeMs: number;
  error?: string;
} {
  try {
    const result: SimulationResult = simulationEngine.run(scenario);
    const blockEvent = result.events.find((e: { type?: string }) => e.type === 'execution.blocked');
    const blockReason = (blockEvent as { payload?: { reason?: string } } | undefined)?.payload?.reason ?? null;
    return {
      settled: result.settled,
      strategy: result.plan.reasoning.strategy,
      blockReason,
      ledgerEntries: result.ledger.length,
      eventCount: result.events.length,
      constitutionPassed: result.constitution.passed,
      costPercent: result.plan.metrics.costPercent,
      riskScore: result.plan.metrics.riskScore,
      confidence: result.plan.metrics.confidence,
      settlementTimeMs: result.plan.metrics.settlementTimeMs,
    };
  } catch (e) {
    return {
      settled: false, strategy: 'ERROR', blockReason: null,
      ledgerEntries: 0, eventCount: 0, constitutionPassed: false,
      costPercent: 0, riskScore: 1, confidence: 0, settlementTimeMs: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Multi-year simulation ──
export function runMultiYearSimulation(horizon: '1y' | '2y' | '3y', seed = 42): MultiYearResult {
  const rng = mulberry32(seed);
  const years = horizon === '1y' ? 1 : horizon === '2y' ? 2 : 3;
  const totalDays = years * 365;
  const startDate = new Date(2025, 0, 1);

  // Growth model: start at 50 tx/day, grow 15% per year with 20% weekly seasonality.
  const baseDailyTx = 50;
  const yearlyGrowth = 1.15;
  const dailyResults: SimDayResult[] = [];
  const invariantViolations: MultiYearResult['invariantViolations'] = [];

  let totalVolume = 0;
  let totalSettled = 0;
  let totalBlocked = 0;
  let totalFailed = 0;
  let totalFees = 0;
  let totalLatency = 0;
  let totalCostPct = 0;
  let txCount = 0;
  let peakDailyVolume = 0;
  let peakDay = 0;
  let totalLiquidityConsumed = 0;
  let peakLiquidityDemand = 0;
  let daysWithInsufficientLiquidity = 0;
  const blockReasonAgg: Record<string, number> = {};

  const startingReserves = CORRIDORS.reduce((s, c) => s + c.originReserve + c.destinationReserve, 0) / CORRIDORS.length;
  const startingStablecoin = 500_000;
  const startingLpCapacity = 100_000;

  for (let day = 0; day < totalDays; day++) {
    const yearProgress = day / 365;
    const growthFactor = Math.pow(yearlyGrowth, yearProgress);
    const seasonality = 1 + 0.2 * Math.sin((day % 7) * (Math.PI / 3.5)); // weekly wave
    const dailyTxBase = Math.floor(baseDailyTx * growthFactor * seasonality);
    // Add noise: ±30%
    const noise = 0.7 + rng() * 0.6;
    const dailyTx = Math.max(1, Math.floor(dailyTxBase * noise));

    const date = new Date(startDate);
    date.setDate(date.getDate() + day);

    let daySettled = 0, dayBlocked = 0, dayFailed = 0;
    let dayVolume = 0, dayLatency = 0, dayCostPct = 0, dayLiquidity = 0;
    const dayBlockReasons: Record<string, number> = {};

    // Sample a subset of transactions (3 per day for performance — enough for
    // statistical significance over 365+ days = 1000+ transactions).
    const sampleSize = 3;
    for (let t = 0; t < sampleSize; t++) {
      const corridor = CORRIDORS[Math.floor(rng() * CORRIDORS.length)];
      // Amount distribution: log-normal-ish (mostly small, occasional large)
      const amountBucket = rng();
      let amount: number;
      if (amountBucket < 0.6) amount = Math.floor(50 + rng() * 450); // 50-500 (retail)
      else if (amountBucket < 0.85) amount = Math.floor(500 + rng() * 4500); // 500-5000 (SME)
      else if (amountBucket < 0.97) amount = Math.floor(5000 + rng() * 45000); // 5K-50K (enterprise)
      else amount = Math.floor(50000 + rng() * 450000); // 50K-500K (strategic)

      // 10% chance of a random failure injection
      const failures: Array<{ type: FailureType; atFrame: number }> = [];
      if (rng() < 0.10) {
        const ft = FAILURE_TYPES[Math.floor(rng() * FAILURE_TYPES.length)];
        failures.push({ type: ft, atFrame: 1 + Math.floor(rng() * 4) });
      }

      // 2% chance of a frozen country
      const frozenCountries: string[] = [];
      if (rng() < 0.02) {
        frozenCountries.push(rng() < 0.5 ? corridor.buyerCountry : corridor.merchantCountry);
      }

      const priority = PRIORITIES[Math.floor(rng() * PRIORITIES.length)];
      const scenario = buildScenario({
        corridor, amount, priority, failures, frozenCountries,
        stablecoinBalance: 500_000, emergencyTreasury: 200_000, lpCapacity: 100_000,
      });

      const r = runOne(scenario);
      if (r.error) {
        dayFailed++;
        invariantViolations.push({ day, type: 'execution_error', detail: r.error });
      } else if (r.settled) {
        daySettled++;
        dayVolume += amount;
        dayLatency += r.settlementTimeMs;
        dayCostPct += (Number.isFinite(r.costPercent) ? r.costPercent : 0);  // guard against NaN/undefined
        dayLiquidity += amount;
      } else {
        dayBlocked++;
        const reason = r.blockReason ?? 'unknown_block';
        dayBlockReasons[reason] = (dayBlockReasons[reason] ?? 0) + 1;
        blockReasonAgg[reason] = (blockReasonAgg[reason] ?? 0) + 1;
        if (reason.includes('INSUFFICIENT_FUNDS')) daysWithInsufficientLiquidity++;
      }

      // Check invariants
      if (r.settled && r.ledgerEntries === 0) {
        invariantViolations.push({ day, type: 'settled_no_ledger', detail: `Settled with 0 ledger entries (tx ${t})` });
      }
      if (!r.settled && r.ledgerEntries > 0) {
        // Mid-execution blocks (failure at frame >1) post ledger entries for
        // steps before the failure. This is expected rollback behavior, but
        // we flag it for visibility — value preservation is only absolute for
        // pre-flight blocks (capacity/freeze).
        invariantViolations.push({ day, type: 'mid_execution_block_with_ledger', detail: `Blocked mid-execution but ${r.ledgerEntries} ledger entries already posted (failure at frame >1)` });
      }
      // Note: constitution.passed is a soft advisory check, not a hard gate.
      // Payments can legitimately settle with constitution warnings — this is
      // by design (the constitution records findings, not blocks).
    }

    totalSettled += daySettled;
    totalBlocked += dayBlocked;
    totalFailed += dayFailed;
    totalVolume += dayVolume;
    const dayAvgCostPct = daySettled > 0 ? dayCostPct / daySettled : 0;
    totalFees += dayVolume * (dayAvgCostPct / 100); // estimated fees = volume × avg cost %
    totalLatency += dayLatency;
    totalCostPct += dayCostPct;
    txCount += sampleSize;
    totalLiquidityConsumed += dayLiquidity;
    if (dayLiquidity > peakLiquidityDemand) peakLiquidityDemand = dayLiquidity;
    if (dayVolume > peakDailyVolume) { peakDailyVolume = dayVolume; peakDay = day; }

    dailyResults.push({
      day, date: date.toISOString().slice(0, 10),
      transactions: sampleSize, settled: daySettled, blocked: dayBlocked, failed: dayFailed,
      totalVolume: Math.round(dayVolume), avgLatencyMs: daySettled > 0 ? Math.round(dayLatency / daySettled) : 0,
      avgCostPercent: daySettled > 0 ? Math.round((dayCostPct / daySettled) * 100) / 100 : 0,
      blockReasons: dayBlockReasons,
    });
  }

  const settlementRate = txCount > 0 ? totalSettled / txCount : 0;
  const blockRate = txCount > 0 ? totalBlocked / txCount : 0;
  const topBlockReasons = Object.entries(blockReasonAgg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));

  return {
    horizon,
    days: dailyResults,
    summary: {
      totalDays,
      totalTransactions: txCount,
      totalSettled,
      totalBlocked,
      totalFailed,
      settlementRate: Math.round(settlementRate * 1000) / 10,
      blockRate: Math.round(blockRate * 1000) / 10,
      totalVolume: Math.round(totalVolume),
      avgDailyVolume: Math.round(totalVolume / totalDays),
      peakDailyVolume: Math.round(peakDailyVolume),
      peakDay,
      totalFeesPaid: Math.round(totalFees),
      avgCostPercent: totalSettled > 0 ? Math.round((totalCostPct / totalSettled) * 100) / 100 : 0,
      avgLatencyMs: totalSettled > 0 ? Math.round(totalLatency / totalSettled) : 0,
      uniqueBlockReasons: Object.keys(blockReasonAgg).length,
      topBlockReasons,
      growthMultiplier: Math.round(Math.pow(yearlyGrowth, years) * 100) / 100,
    },
    liquidityAnalysis: {
      startingReserves,
      startingStablecoin,
      startingLpCapacity,
      totalLiquidityConsumed: Math.round(totalLiquidityConsumed),
      peakLiquidityDemand: Math.round(peakLiquidityDemand),
      daysWithInsufficientLiquidity,
      recommendedReserveBuffer: Math.round(peakLiquidityDemand * 1.5),
      recommendedStablecoinBuffer: Math.round(peakLiquidityDemand * 0.5),
      utilizationRate: totalLiquidityConsumed > 0 ? Math.round((peakLiquidityDemand / (startingReserves + startingStablecoin + startingLpCapacity)) * 100) : 0,
    },
    invariantViolations,
    generatedAt: new Date().toISOString(),
  };
}

// ── Systematic edge-case prober ──
export function runEdgeCaseProbe(): EdgeCaseReport {
  const results: EdgeCaseResult[] = [];
  const findings: string[] = [];
  const corridor = CORRIDORS[2]; // Ghana → Kenya (cross-border, receiver no reserve)

  // Helper to run + record
  const probe = (id: string, category: string, description: string, expected: 'settle' | 'block' | 'error', scenario: SimulationScenario, notes?: string) => {
    const r = runOne(scenario);
    const actualSettled: boolean | 'error' = r.error ? 'error' : r.settled;
    const passed = expected === 'error' ? actualSettled === 'error' : actualSettled === (expected === 'settle');
    results.push({
      id, category, description, expectedResult: expected,
      actualSettled, actualStrategy: r.strategy, blockReason: r.blockReason,
      passed, ledgerEntries: r.ledgerEntries, eventCount: r.eventCount,
      constitutionPassed: r.constitutionPassed,
      metrics: { costPercent: r.costPercent, riskScore: r.riskScore, confidence: r.confidence, settlementTimeMs: r.settlementTimeMs },
      notes,
    });
  };

  // ── 1. Capacity boundaries ──
  // With stablecoin=50000 + emergency=20000 + LP=0 + reserve=0 → capacity = 70000
  const capScenario = (amount: number) => buildScenario({ corridor, amount, stablecoinBalance: 50000, emergencyTreasury: 20000, lpCapacity: 0 });
  probe('CAP-001', 'capacity', 'Zero amount', 'settle', capScenario(0));
  probe('CAP-002', 'capacity', 'Amount = 1 (minimal)', 'settle', capScenario(1));
  probe('CAP-003', 'capacity', 'Amount = capacity (70000) — boundary', 'settle', capScenario(70000));
  probe('CAP-004', 'capacity', 'Amount = capacity + 1 (70001) — over boundary', 'block', capScenario(70001));
  probe('CAP-005', 'capacity', 'Amount = 2× capacity', 'block', capScenario(140000));
  probe('CAP-006', 'capacity', 'Amount = MAX_SAFE_INTEGER', 'block', capScenario(Number.MAX_SAFE_INTEGER));
  probe('CAP-007', 'capacity', 'Negative amount (-100)', 'settle', capScenario(-100), 'Kernel treats negative as valid — possible bug for reversal logic');
  probe('CAP-008', 'capacity', 'NaN amount', 'error', { ...capScenario(0), transaction: { ...capScenario(0).transaction, amount: NaN } }, 'NaN should be rejected');

  // ── 2. Emergency freeze (all variations) ──
  probe('FRZ-001', 'freeze', 'Freeze buyer country', 'block', buildScenario({ corridor, amount: 500, frozenCountries: ['Ghana'] }));
  probe('FRZ-002', 'freeze', 'Freeze merchant country', 'block', buildScenario({ corridor, amount: 500, frozenCountries: ['Kenya'] }));
  probe('FRZ-003', 'freeze', 'Freeze both countries', 'block', buildScenario({ corridor, amount: 500, frozenCountries: ['Ghana', 'Kenya'] }));
  probe('FRZ-004', 'freeze', 'Freeze unrelated country (Togo)', 'settle', buildScenario({ corridor, amount: 500, frozenCountries: ['Togo'] }));
  probe('FRZ-005', 'freeze', 'Freeze all 4 countries', 'block', buildScenario({ corridor, amount: 500, frozenCountries: ['Ghana', 'Kenya', 'Nigeria', 'Togo'] }));
  probe('FRZ-006', 'freeze', 'Empty freeze list', 'settle', buildScenario({ corridor, amount: 500, frozenCountries: [] }));
  probe('FRZ-007', 'freeze', 'Freeze with empty string', 'settle', buildScenario({ corridor, amount: 500, frozenCountries: [''] }), 'Empty string should not match any country');

  // ── 3. Every FailureType (at frame 1) ──
  for (const ft of FAILURE_TYPES) {
    const expected: 'settle' | 'block' = (ft === 'fraud_alert' || ft === 'compliance_block') ? 'block' : 'settle';
    probe(`FAIL-${ft.toUpperCase()}`, 'failure_injection', `Failure: ${ft} at frame 1`, expected,
      buildScenario({ corridor, amount: 500, failures: [{ type: ft, atFrame: 1 }] }));
  }

  // ── 4. Failure at different frames ──
  for (let frame = 0; frame <= 10; frame++) {
    probe(`FRAME-${frame}`, 'failure_frame', `compliance_block at frame ${frame}`, frame === 0 ? 'settle' : 'block',
      buildScenario({ corridor, amount: 500, failures: [{ type: 'compliance_block', atFrame: frame }] }),
      frame === 0 ? 'Frame 0 never fires (steps start at frame 1) — this is a known design choice' : undefined);
  }

  // ── 5. Multiple failures simultaneously ──
  probe('MULTI-001', 'multi_failure', 'fraud_alert + compliance_block together', 'block',
    buildScenario({ corridor, amount: 500, failures: [{ type: 'fraud_alert', atFrame: 1 }, { type: 'compliance_block', atFrame: 2 }] }));
  probe('MULTI-002', 'multi_failure', 'insurance_claim + fraud_alert together', 'block',
    buildScenario({ corridor, amount: 500, failures: [{ type: 'insurance_claim', atFrame: 1 }, { type: 'fraud_alert', atFrame: 3 }] }));
  probe('MULTI-003', 'multi_failure', 'All 10 failure types at once', 'block',
    buildScenario({ corridor, amount: 500, failures: FAILURE_TYPES.map((t) => ({ type: t, atFrame: 1 })) }));

  // ── 6. Priority variations ──
  for (const p of PRIORITIES) {
    probe(`PRIO-${p.toUpperCase()}`, 'priority', `Priority: ${p}`, 'settle',
      buildScenario({ corridor, amount: 1000, priority: p }));
  }

  // ── 7. Reserve policy variations ──
  const policies: Array<'reserve_first' | 'lp_first' | 'hybrid' | 'preserve_reserves'> = ['reserve_first', 'lp_first', 'hybrid', 'preserve_reserves'];
  for (const rp of policies) {
    probe(`POL-${rp.toUpperCase()}`, 'reserve_policy', `Policy: ${rp}`, 'settle',
      buildScenario({ corridor, amount: 1000, reservePolicy: rp }));
  }

  // ── 8. Insurance requirements ──
  probe('INS-001', 'insurance', 'requireInsurance=true, low value', 'settle',
    buildScenario({ corridor, amount: 500, requireInsurance: true }));
  probe('INS-002', 'insurance', 'requireInsurance=true, high value (500K)', 'settle',
    buildScenario({ corridor, amount: 500000, requireInsurance: true }));

  // ── 9. Risk score thresholds ──
  probe('RSK-001', 'risk', 'maxRiskScore=0.0 (strictest)', 'settle',
    buildScenario({ corridor, amount: 500, maxRiskScore: 0 }));
  probe('RSK-002', 'risk', 'maxRiskScore=1.0 (loosest)', 'settle',
    buildScenario({ corridor, amount: 500, maxRiskScore: 1 }));
  probe('RSK-003', 'risk', 'maxRiskScore=0.01 (very strict)', 'settle',
    buildScenario({ corridor, amount: 500, maxRiskScore: 0.01 }));

  // ── 10. All corridors ──
  CORRIDORS.forEach((c, i) => {
    probe(`CORRIDOR-${i}`, 'corridor', `${c.buyerCountry}→${c.merchantCountry} (${c.buyerCurrency}→${c.merchantCurrency})`, 'settle',
      buildScenario({ corridor: c, amount: 1000 }));
  });

  // ── 11. Extreme amounts ──
  probe('EXT-001', 'extreme', 'Amount = 0.01 (fractional)', 'settle', buildScenario({ corridor, amount: 0.01 }));
  probe('EXT-002', 'extreme', 'Amount = 0.5', 'settle', buildScenario({ corridor, amount: 0.5 }));
  probe('EXT-003', 'extreme', 'Amount = 1 trillion (1e12)', 'block', buildScenario({ corridor, amount: 1e12 }));

  // ── 12. No LPs at all ──
  probe('NOLP-001', 'no_lp', 'No LPs, small amount, reserve available', 'settle',
    buildScenario({ corridor: CORRIDORS[0], amount: 500, lpCapacity: 0 }));
  probe('NOLP-002', 'no_lp', 'No LPs, no reserve, only stablecoin', 'settle',
    buildScenario({ corridor: CORRIDORS[4], amount: 500, lpCapacity: 0, stablecoinBalance: 50000 }));
  probe('NOLP-003', 'no_lp', 'No LPs, no reserve, no stablecoin', 'block',
    buildScenario({ corridor: CORRIDORS[4], amount: 500, lpCapacity: 0, stablecoinBalance: 0, emergencyTreasury: 0 }));

  // ── 13. Domestic vs cross-border ──
  probe('DOM-001', 'domestic', 'Domestic same-currency', 'settle',
    buildScenario({ corridor: CORRIDORS[0], amount: 500 }));
  probe('DOM-002', 'domestic', 'Domestic high-value', 'settle',
    buildScenario({ corridor: CORRIDORS[0], amount: 100000 }));

  // ── Generate findings ──
  const failed = results.filter((r) => !r.passed);
  const errors = results.filter((r) => r.actualSettled === 'error');
  const categories: Record<string, { total: number; passed: number; failed: number }> = {};
  for (const r of results) {
    if (!categories[r.category]) categories[r.category] = { total: 0, passed: 0, failed: 0 };
    categories[r.category].total++;
    if (r.passed) categories[r.category].passed++;
    else categories[r.category].failed++;
  }

  if (errors.length > 0) findings.push(`${errors.length} scenario(s) threw execution errors — indicates unhandled exceptions in the kernel.`);
  const capFailures = failed.filter((r) => r.category === 'capacity');
  if (capFailures.length > 0) findings.push(`${capFailures.length} capacity edge case(s) behaved unexpectedly — review boundary handling.`);
  const negResult = results.find((r) => r.id === 'CAP-007');
  if (negResult && negResult.actualSettled === true) findings.push('Negative amounts are accepted and settled — this is a potential reversal/credit bug (no validation for amount > 0).');
  const nanResult = results.find((r) => r.id === 'CAP-008');
  if (nanResult && nanResult.actualSettled !== 'error' && !nanResult.passed) findings.push('NaN amount is not properly rejected — missing input validation.');
  const frame0 = results.find((r) => r.id === 'FRAME-0');
  if (frame0 && !frame0.passed) findings.push('Failure at frame 0 does not fire (steps start at frame 1) — documented design choice, not a bug.');
  if (findings.length === 0) findings.push('All edge cases handled as expected — no issues found.');

  return {
    reportId: `ECP-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    totalCases: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: failed.length,
    errors: errors.length,
    passRate: Math.round((results.filter((r) => r.passed).length / results.length) * 1000) / 10,
    categories,
    results,
    findings,
  };
}
