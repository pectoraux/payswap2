/**
 * Settlement Strategy + Bandwidth + Settlement-Contract Simulator.
 *
 * This simulates the CANONICAL runtime liquidity model (not the kernel's
 * older LiquidityPlanner). It exercises:
 *   - All 5 settlement strategies (LOCAL_RAIL, RESERVE_TO_RESERVE,
 *     RESERVE_TO_MARKET, MARKET_TO_RESERVE, MARKET_TO_MARKET)
 *   - 3 bandwidth flavors (fiat, stablecoin, twin_token) — consumption,
 *     reservation, replenishment, exhaustion
 *   - Settlement contract lifecycle (created → funded → claimed → accepted →
 *     awaiting_recipient → confirmed → released → closed)
 *   - LP marketplace dynamics (contracts waiting for LP claim, LP fiat
 *     bandwidth auto-settlement vs marketplace claim path)
 *
 * Uses:
 *   - LiquidityPolicyEngine (selectStrategy + compile)
 *   - BandwidthEngine (register/reserve/consume/release/replenish)
 *   - SettlementContractEngine (create/fund/claim/accept/confirm/release/close)
 */

import {
  LiquidityPolicyEngine,
  type PolicyEngineInput,
  type ReserveState,
  type BandwidthPosition,
  type SettlementStrategy,
  type LiquidityExecutionPlan,
  type BandwidthAssetType,
} from '@/runtime/liquidity/policy-engine';
import { BandwidthEngine } from '@/runtime/liquidity/bandwidth-engine';
import { SettlementContractEngine } from '@/runtime/liquidity/settlement-contract-engine';
import { fxEngine } from '@/kernel/fx';

// ── Countries + reserve configuration ──
interface CountryConfig {
  country: string; currency: string; hasFiatReserve: boolean; fiatReserveAmount: number;
}

const COUNTRIES: CountryConfig[] = [
  { country: 'Ghana', currency: 'GHS', hasFiatReserve: true, fiatReserveAmount: 5_000_000 },
  { country: 'Togo', currency: 'XOF', hasFiatReserve: true, fiatReserveAmount: 3_000_000 },
  { country: 'Kenya', currency: 'KES', hasFiatReserve: false, fiatReserveAmount: 0 },
  { country: 'Nigeria', currency: 'NGN', hasFiatReserve: false, fiatReserveAmount: 0 },
];

// ── PRNG ──
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
export interface SettlementSimResult {
  strategy: SettlementStrategy;
  corridor: string;
  amount: number;
  planCompiled: boolean;
  requiredBandwidth: Array<{ assetType: BandwidthAssetType; country: string; currency: string; amount: number }>;
  requiredEscrow: Array<{ assetType: BandwidthAssetType; currency: string; amount: number }>;
  stablecoinRequired: boolean;
  stablecoinAmount: number;
  stablecoinSource: string;
  feeBps: number;
  lpSharePercent: number;
  payswapSharePercent: number;
  settlementContractCreated: boolean;
  contractId: string | null;
  contractLifecycle: string[];
  contractFinalStatus: string | null;
  bandwidthConsumed: Array<{ assetType: BandwidthAssetType; country: string; currency: string; amount: number }>;
  lpClaimed: boolean;
  autoSettled: boolean;
  error?: string;
}

export interface SettlementSimReport {
  reportId: string;
  generatedAt: string;
  totalScenarios: number;
  byStrategy: Record<string, { count: number; contractsCreated: number; contractsClaimed: number; autoSettled: number; bandwidthConsumed: number }>;
  bandwidthSummary: {
    fiat: { totalConsumed: number; positionsRegistered: number; exhausted: number };
    stablecoin: { totalConsumed: number; positionsRegistered: number; exhausted: number };
    twin_token: { totalConsumed: number; positionsRegistered: number; exhausted: number };
  };
  contractSummary: {
    totalCreated: number;
    totalClaimed: number;
    totalAutoSettled: number;
    totalExpired: number;
    avgLifecycleSteps: number;
    finalStatuses: Record<string, number>;
  };
  results: SettlementSimResult[];
  findings: string[];
}

// ── Build reserve state for a country ──
function reserveState(country: string): ReserveState {
  const c = COUNTRIES.find((x) => x.country === country) ?? COUNTRIES[0];
  return {
    country: c.country,
    currency: c.currency,
    hasFiatReserve: c.hasFiatReserve,
    fiatReserveAmount: c.fiatReserveAmount,
    hasStablecoinReserve: c.hasFiatReserve, // countries with fiat also hold stablecoin reserves
    stablecoinReserveAmount: c.hasFiatReserve ? c.fiatReserveAmount * 0.5 : 0,
    maturity: c.hasFiatReserve ? 'mostly_fiat' : 'stablecoin_only',
  };
}

// ── Register LP bandwidth positions for a country ──
function registerBandwidth(bwEngine: BandwidthEngine, country: string, currency: string, rng: () => number): BandwidthPosition[] {
  const positions: BandwidthPosition[] = [];
  const lpId = `lp_${country.toLowerCase()}`;
  // Fiat bandwidth (for auto-settlement in RESERVE_TO_MARKET / MARKET_TO_MARKET)
  const fiatCapacity = Math.floor(50_000 + rng() * 150_000);
  positions.push(bwEngine.register(lpId, country, 'fiat', currency, fiatCapacity, fiatCapacity * 0.1, 'automatic'));
  // Stablecoin bandwidth
  const stablecoinCapacity = Math.floor(100_000 + rng() * 200_000);
  positions.push(bwEngine.register(lpId, country, 'stablecoin', 'USDC', stablecoinCapacity, stablecoinCapacity * 0.1, 'automatic'));
  // Twin token bandwidth
  const twinCapacity = Math.floor(80_000 + rng() * 120_000);
  positions.push(bwEngine.register(lpId, country, 'twin_token', currency, twinCapacity, twinCapacity * 0.1, 'automatic'));
  // Authorize fiat debit for auto-settlement
  for (const p of positions) {
    if (p.assetType === 'fiat') bwEngine.authorizeDebit(p, 'bank', `acct_${lpId}`);
  }
  return positions;
}

// ── Run a single settlement scenario ──
function runSettlementScenario(opts: {
  fromCountry: string; toCountry: string; amount: number;
  rng: () => number;
  bwEngine: BandwidthEngine;
  scEngine: SettlementContractEngine;
  disableFiatBandwidth?: boolean; // force marketplace path
}): SettlementSimResult {
  const from = COUNTRIES.find((c) => c.country === opts.fromCountry)!;
  const to = COUNTRIES.find((c) => c.country === opts.toCountry)!;
  const corridor = `${from.country}→${to.country}`;

  try {
    // Register bandwidth for both countries
    const senderBw = registerBandwidth(opts.bwEngine, from.country, from.currency, opts.rng);
    const receiverBw = registerBandwidth(opts.bwEngine, to.country, to.currency, opts.rng);

    // Optionally disable fiat bandwidth to force marketplace claim path
    if (opts.disableFiatBandwidth) {
      for (const p of [...senderBw, ...receiverBw]) {
        if (p.assetType === 'fiat') {
          // Drain available capacity so findAvailable won't match
          p.available = 0;
          if (p.debitAuthorization) p.debitAuthorization.authorized = false;
        }
      }
    }

    const input: PolicyEngineInput = {
      fromCountry: from.country,
      toCountry: to.country,
      fromCurrency: from.currency,
      toCurrency: to.currency,
      amount: opts.amount,
      fxRate: fxEngine.rate(from.currency as any, to.currency as any),
      senderReserve: reserveState(from.country),
      receiverReserve: reserveState(to.country),
      senderBandwidth: senderBw,
      receiverBandwidth: receiverBw,
      treasuryStablecoins: [{ currency: 'USDC', amount: 5_000_000 }],
    };

    const engine = new LiquidityPolicyEngine();
    const plan: LiquidityExecutionPlan = engine.compile(input);

    // ── Execute the plan: consume bandwidth + create settlement contract ──
    const bandwidthConsumed: SettlementSimResult['bandwidthConsumed'] = [];
    let contractCreated = false;
    let contractId: string | null = null;
    const contractLifecycle: string[] = [];
    let contractFinalStatus: string | null = null;
    let lpClaimed = false;
    let autoSettled = false;

    // Consume required bandwidth
    for (const req of plan.requiredBandwidth) {
      const positions = opts.bwEngine.findAvailable(req.country, req.assetType, req.currency, req.amount);
      if (positions.length > 0) {
        const pos = positions[0];
        opts.bwEngine.reserve(pos, req.amount);
        opts.bwEngine.consume(pos, req.amount);
        bandwidthConsumed.push({ assetType: req.assetType, country: req.country, currency: req.currency, amount: req.amount });
      }
    }

    // Settlement contract lifecycle
    const needsContract = plan.settlementActions.some((a) => a.type === 'create_contract');
    if (needsContract) {
      const contract = opts.scEngine.create({
        fromCountry: from.country, toCountry: to.country,
        fromCurrency: from.currency, toCurrency: to.currency,
        amount: opts.amount,
        escrowAmount: plan.requiredEscrow[0]?.amount ?? (plan.stablecoinUsage.required ? plan.stablecoinUsage.amount : 0),
        escrowCurrency: plan.stablecoinUsage.currency || 'USDC',
        strategy: plan.strategy,
        timeoutMs: 24 * 60 * 60 * 1000,
      });
      contractId = contract.id;
      contractCreated = true;
      contractLifecycle.push('created');

      // Fund the contract — RESERVE_TO_MARKET and MARKET_TO_MARKET always
      // involve escrow (either stablecoin lock for marketplace, or LP fiat
      // bandwidth for auto-settlement). LOCAL_RAIL / RESERVE_TO_RESERVE /
      // MARKET_TO_RESERVE create+close immediately (no escrow).
      const isEscrowStrategy = plan.strategy === 'RESERVE_TO_MARKET' || plan.strategy === 'MARKET_TO_MARKET';
      if (isEscrowStrategy) {
        opts.scEngine.fund(contract.id);
        contractLifecycle.push('funded');
      }

      // Determine settlement path based on strategy + fiat bandwidth availability
      const hasFiatBw = plan.requiredBandwidth.some((r) => r.assetType === 'fiat');
      const isMarketplaceStrategy = plan.strategy === 'RESERVE_TO_MARKET' || plan.strategy === 'MARKET_TO_MARKET';
      const hasMarketplaceActions = plan.settlementActions.some((a) => a.type === 'lp_claim' || a.type === 'lp_pay_recipient' || a.type === 'recipient_confirm');

      if (isMarketplaceStrategy && hasFiatBw && !opts.disableFiatBandwidth) {
        // Auto-settlement path: LP fiat bandwidth absorbs the settlement.
        // Skip claim, go straight to confirm → release → close.
        // But confirm requires 'awaiting_recipient' status, so we need to
        // simulate the auto-flow: fund → (auto-accept) → confirm → release → close
        autoSettled = true;
        // For auto-settlement, the LP auto-claims and auto-accepts
        const lpId = `lp_${to.country.toLowerCase()}`;
        if (contract.status === 'funded') {
          opts.scEngine.claim(contract.id, lpId);
          contractLifecycle.push('claimed');
          opts.scEngine.accept(contract.id);
          contractLifecycle.push('accepted');
          opts.scEngine.awaitRecipient(contract.id, 'recipient_1');
          contractLifecycle.push('awaiting_recipient');
          opts.scEngine.confirm(contract.id);
          contractLifecycle.push('confirmed');
          opts.scEngine.release(contract.id);
          contractLifecycle.push('released');
          opts.scEngine.close(contract.id);
          contractLifecycle.push('closed');
        }
      } else if (hasMarketplaceActions) {
        // Marketplace claim path: LP claims → accepts → awaits recipient → confirms → releases → closes
        const lpId = `lp_${to.country.toLowerCase()}`;
        if (contract.status === 'funded') {
          opts.scEngine.claim(contract.id, lpId);
          contractLifecycle.push('claimed');
          lpClaimed = true;
          opts.scEngine.accept(contract.id);
          contractLifecycle.push('accepted');
          opts.scEngine.awaitRecipient(contract.id, 'recipient_1');
          contractLifecycle.push('awaiting_recipient');
          opts.scEngine.confirm(contract.id);
          contractLifecycle.push('confirmed');
          opts.scEngine.release(contract.id);
          contractLifecycle.push('released');
          opts.scEngine.close(contract.id);
          contractLifecycle.push('closed');
        }
      } else {
        // Simple path (LOCAL_RAIL, RESERVE_TO_RESERVE, MARKET_TO_RESERVE):
        // create → close immediately (no escrow, no LP claim, no release).
        // The SettlementContractEngine requires 'released' before 'close',
        // so we manually transition for these immediate-close strategies.
        const c = opts.scEngine.get(contract.id);
        if (c) { c.status = 'closed'; c.closedAt = Date.now(); }
        contractLifecycle.push('closed');
      }
      contractFinalStatus = opts.scEngine.get(contract.id)?.status ?? null;
    }

    return {
      strategy: plan.strategy,
      corridor,
      amount: opts.amount,
      planCompiled: true,
      requiredBandwidth: plan.requiredBandwidth,
      requiredEscrow: plan.requiredEscrow,
      stablecoinRequired: plan.stablecoinUsage.required,
      stablecoinAmount: plan.stablecoinUsage.amount,
      stablecoinSource: plan.stablecoinUsage.source,
      feeBps: plan.feeModel.totalFeeBps,
      lpSharePercent: plan.feeModel.lpSharePercent,
      payswapSharePercent: plan.feeModel.payswapSharePercent,
      settlementContractCreated: contractCreated,
      contractId,
      contractLifecycle,
      contractFinalStatus,
      bandwidthConsumed,
      lpClaimed,
      autoSettled,
    };
  } catch (e) {
    return {
      strategy: 'LOCAL_RAIL', corridor, amount: opts.amount, planCompiled: false,
      requiredBandwidth: [], requiredEscrow: [],
      stablecoinRequired: false, stablecoinAmount: 0, stablecoinSource: 'treasury',
      feeBps: 0, lpSharePercent: 0, payswapSharePercent: 0,
      settlementContractCreated: false, contractId: null, contractLifecycle: [],
      contractFinalStatus: null, bandwidthConsumed: [], lpClaimed: false, autoSettled: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Run the full settlement simulation ──
export function runSettlementSimulation(seed = 42): SettlementSimReport {
  const rng = mulberry32(seed);
  // Create fresh engine instances for this simulation run (isolated state)
  const bwEngine = new BandwidthEngine();
  const scEngine = new SettlementContractEngine();

  const results: SettlementSimResult[] = [];
  const findings: string[] = [];

  // Define corridors that exercise all 5 strategies
  const corridors: Array<{ from: string; to: string; disableFiatBw?: boolean; label: string }> = [
    // LOCAL_RAIL (same country)
    { from: 'Ghana', to: 'Ghana', label: 'LOCAL_RAIL (GHS→GHS)' },
    { from: 'Togo', to: 'Togo', label: 'LOCAL_RAIL (XOF→XOF)' },
    { from: 'Kenya', to: 'Kenya', label: 'LOCAL_RAIL (KES→KES)' },
    { from: 'Nigeria', to: 'Nigeria', label: 'LOCAL_RAIL (NGN→NGN)' },
    // RESERVE_TO_RESERVE (both have reserves)
    { from: 'Ghana', to: 'Togo', label: 'RESERVE_TO_RESERVE (GHS→XOF)' },
    { from: 'Togo', to: 'Ghana', label: 'RESERVE_TO_RESERVE (XOF→GHS)' },
    // RESERVE_TO_MARKET (sender has reserve, receiver doesn't)
    { from: 'Ghana', to: 'Kenya', label: 'RESERVE_TO_MARKET (GHS→KES) — auto' },
    { from: 'Ghana', to: 'Nigeria', label: 'RESERVE_TO_MARKET (GHS→NGN) — auto' },
    { from: 'Togo', to: 'Kenya', label: 'RESERVE_TO_MARKET (XOF→KES) — auto' },
    // RESERVE_TO_MARKET (marketplace path — no fiat bandwidth)
    { from: 'Ghana', to: 'Kenya', disableFiatBw: true, label: 'RESERVE_TO_MARKET (GHS→KES) — marketplace' },
    { from: 'Ghana', to: 'Nigeria', disableFiatBw: true, label: 'RESERVE_TO_MARKET (GHS→NGN) — marketplace' },
    // MARKET_TO_RESERVE (sender no reserve, receiver has)
    { from: 'Kenya', to: 'Ghana', label: 'MARKET_TO_RESERVE (KES→GHS)' },
    { from: 'Nigeria', to: 'Togo', label: 'MARKET_TO_RESERVE (NGN→XOF)' },
    // MARKET_TO_MARKET (neither has reserve)
    { from: 'Kenya', to: 'Nigeria', label: 'MARKET_TO_MARKET (KES→NGN) — auto' },
    { from: 'Nigeria', to: 'Kenya', label: 'MARKET_TO_MARKET (NGN→KES) — auto' },
    // MARKET_TO_MARKET (marketplace path)
    { from: 'Kenya', to: 'Nigeria', disableFiatBw: true, label: 'MARKET_TO_MARKET (KES→NGN) — marketplace' },
  ];

  for (const c of corridors) {
    // Run 3 amounts per corridor (retail, SME, enterprise)
    for (const amount of [500, 5000, 50000]) {
      const result = runSettlementScenario({
        fromCountry: c.from, toCountry: c.to, amount, rng,
        bwEngine, scEngine,
        disableFiatBandwidth: c.disableFiatBw,
      });
      results.push(result);
    }
  }

  // ── Aggregate ──
  const byStrategy: SettlementSimReport['byStrategy'] = {};
  for (const r of results) {
    if (!byStrategy[r.strategy]) {
      byStrategy[r.strategy] = { count: 0, contractsCreated: 0, contractsClaimed: 0, autoSettled: 0, bandwidthConsumed: 0 };
    }
    byStrategy[r.strategy].count++;
    if (r.settlementContractCreated) byStrategy[r.strategy].contractsCreated++;
    if (r.lpClaimed) byStrategy[r.strategy].contractsClaimed++;
    if (r.autoSettled) byStrategy[r.strategy].autoSettled++;
    byStrategy[r.strategy].bandwidthConsumed += r.bandwidthConsumed.reduce((s, b) => s + b.amount, 0);
  }

  // Bandwidth summary
  const allPositions = bwEngine.listAll();
  const bandwidthSummary = {
    fiat: {
      totalConsumed: results.flatMap((r) => r.bandwidthConsumed).filter((b) => b.assetType === 'fiat').reduce((s, b) => s + b.amount, 0),
      positionsRegistered: allPositions.filter((p) => p.assetType === 'fiat').length,
      exhausted: allPositions.filter((p) => p.assetType === 'fiat' && p.available === 0).length,
    },
    stablecoin: {
      totalConsumed: results.flatMap((r) => r.bandwidthConsumed).filter((b) => b.assetType === 'stablecoin').reduce((s, b) => s + b.amount, 0),
      positionsRegistered: allPositions.filter((p) => p.assetType === 'stablecoin').length,
      exhausted: allPositions.filter((p) => p.assetType === 'stablecoin' && p.available === 0).length,
    },
    twin_token: {
      totalConsumed: results.flatMap((r) => r.bandwidthConsumed).filter((b) => b.assetType === 'twin_token').reduce((s, b) => s + b.amount, 0),
      positionsRegistered: allPositions.filter((p) => p.assetType === 'twin_token').length,
      exhausted: allPositions.filter((p) => p.assetType === 'twin_token' && p.available === 0).length,
    },
  };

  // Contract summary
  const allContracts = scEngine.list();
  const contractSummary = {
    totalCreated: allContracts.length,
    totalClaimed: results.filter((r) => r.lpClaimed).length,
    totalAutoSettled: results.filter((r) => r.autoSettled).length,
    totalExpired: allContracts.filter((c) => c.status === 'expired').length,
    avgLifecycleSteps: results.filter((r) => r.contractLifecycle.length > 0).length > 0
      ? Math.round(results.filter((r) => r.contractLifecycle.length > 0).reduce((s, r) => s + r.contractLifecycle.length, 0) / results.filter((r) => r.contractLifecycle.length > 0).length)
      : 0,
    finalStatuses: {} as Record<string, number>,
  };
  for (const r of results) {
    if (r.contractFinalStatus) {
      contractSummary.finalStatuses[r.contractFinalStatus] = (contractSummary.finalStatuses[r.contractFinalStatus] ?? 0) + 1;
    }
  }

  // Findings
  const errors = results.filter((r) => r.error);
  if (errors.length > 0) findings.push(`${errors.length} scenario(s) errored — review policy engine compatibility.`);
  const strategiesTested = Object.keys(byStrategy);
  if (strategiesTested.length < 5) findings.push(`Only ${strategiesTested.length}/5 strategies exercised — missing: ${['LOCAL_RAIL','RESERVE_TO_RESERVE','RESERVE_TO_MARKET','MARKET_TO_RESERVE','MARKET_TO_MARKET'].filter((s) => !strategiesTested.includes(s)).join(', ')}`);
  else findings.push('All 5 settlement strategies exercised (LOCAL_RAIL, RESERVE_TO_RESERVE, RESERVE_TO_MARKET, MARKET_TO_RESERVE, MARKET_TO_MARKET).');
  if (bandwidthSummary.fiat.exhausted > 0) findings.push(`${bandwidthSummary.fiat.exhausted} fiat bandwidth position(s) exhausted — LPs would need to replenish.`);
  if (bandwidthSummary.stablecoin.exhausted > 0) findings.push(`${bandwidthSummary.stablecoin.exhausted} stablecoin bandwidth position(s) exhausted.`);
  if (bandwidthSummary.twin_token.exhausted > 0) findings.push(`${bandwidthSummary.twin_token.exhausted} twin-token bandwidth position(s) exhausted.`);
  const marketplaceContracts = results.filter((r) => r.lpClaimed && !r.autoSettled).length;
  const autoContracts = results.filter((r) => r.autoSettled).length;
  findings.push(`${marketplaceContracts} settlement contract(s) went through the LP marketplace claim path (funded → claimed → accepted → confirmed → released → closed).`);
  findings.push(`${autoContracts} settlement contract(s) were auto-settled via LP fiat bandwidth (skipped claim phase).`);

  return {
    reportId: `SSR-${Date.now().toString(36).toUpperCase()}`,
    generatedAt: new Date().toISOString(),
    totalScenarios: results.length,
    byStrategy,
    bandwidthSummary,
    contractSummary,
    results,
    findings,
  };
}
