/**
 * Global Economic Directorate — the strategic planning layer. (M-ECO-36.)
 *
 *   Global Economic Directorate
 *   ├── Treasury Director (capital allocation, reserves, stablecoin replacement)
 *   ├── Corridor Director (new corridors, pricing, health, profitability)
 *   ├── LP Director (recruitment, retention, incentives, network density)
 *   ├── FX Director (inventory, exposure, rebalancing, currency risk)
 *   ├── Settlement Director (rail selection, performance, latency)
 *   ├── Country Directors (per-country optimization)
 *   ├── Global Planner (cross-country optimization)
 *   ├── Strategic Simulator (multi-year projections)
 *   └── Economic Memory (institutional learning)
 *
 * Every Director PROPOSES. None execute directly.
 * Everything goes through: Constitution → Digital Twin → Ledger → Coordinator → Runtime.
 */

import type {
  StrategicRecommendation, DirectorReport, DirectorType,
  GlobalPlan, CapitalReallocation, ExpansionPlan,
  StrategicSimulation, YearProjection,
  EconomicMemoryEntry,
  DirectorateReport,
  StrategicAction, TimeHorizon, AffectedEntities,
} from './types';
import type { LiquidityDigitalTwin, CountryDigitalTwin } from '../control-plane/types';
import { uid } from '../types';

/** Inputs from the runtime. */
export interface DirectorateInputs {
  getDigitalTwin: () => LiquidityDigitalTwin;
  getControlPlaneReport: () => {
    capitalAllocations: Array<{ action: string; country: string; amount: number; reason: string; expectedROI: number; expectedRisk: number; confidence: number }>;
    reserveEvolution: Array<{ country: string; currentMaturity: string; targetMaturity: string; fiatRatio: number; stablecoinRatio: number; recommendedActions: string[] }>;
    networkOptimization: { totalLPs: number; totalBandwidth: number; networkDensity: number; capitalEfficiency: number; recommendations: string[] };
  };
  getBalanceSheet: () => { assets: { totalAssets: number; fiatReserves: number; stablecoinReserves: number }; liabilities: { twinTokensOutstanding: number }; equity: { totalEquity: number } };
}

/**
 * GlobalEconomicDirectorate — coordinates all directors + global planning
 * + strategic simulation + economic memory.
 *
 * Pure: same inputs → same recommendations. No side effects.
 * Never executes — only PROPOSES within constitutional limits.
 */
export class GlobalEconomicDirectorate {
  private readonly memory: EconomicMemoryEntry[] = [];

  constructor(private inputs: DirectorateInputs) {}

  // ── 1. Treasury Director ────────────────────────────────────────────────

  treasuryDirector(): DirectorReport {
    const twin = this.inputs.getDigitalTwin();
    const recs: StrategicRecommendation[] = [];

    for (const country of twin.countries) {
      // Reserve growth recommendations.
      if (country.reserveCoverage < 0.3) {
        recs.push(this.recommend(
          'treasury', 'increase_reserve',
          `Increase ${country.country} fiat reserves — coverage at ${(country.reserveCoverage * 100).toFixed(0)}%`,
          [country.country], [], country.fiatReserves * 0.5, country.currency,
          'immediate', 0.15, 0.3, 0.85,
          `Low coverage threatens twin token backing in ${country.country}`,
          ['Wait for organic growth', 'Purchase stablecoins as bridge'],
        ));
      }

      // Stablecoin replacement recommendations.
      if (country.stablecoinDependency > 0.5 && country.maturity !== 'fully_fiat') {
        recs.push(this.recommend(
          'treasury', 'replace_stablecoins',
          `Replace stablecoins with fiat in ${country.country} — dependency at ${(country.stablecoinDependency * 100).toFixed(0)}%`,
          [country.country], [], country.stablecoinReserves * 0.3, country.currency,
          'medium_term', 0.12, 0.2, 0.8,
          `High stablecoin dependency creates depeg risk`,
          ['Gradual replacement over 6 months', 'Keep current levels'],
        ));
      }

      // Reserve expansion for emerging countries.
      if (country.maturity === 'stablecoin_only' && country.fiatReserves < 50_000) {
        recs.push(this.recommend(
          'treasury', 'open_reserve',
          `Open fiat reserve in ${country.country} — currently stablecoin-only`,
          [country.country], [], 100_000, country.currency,
          'long_term', 0.2, 0.25, 0.7,
          `Country is stablecoin-only — opening fiat reserve enables twin token backing`,
          ['Continue with stablecoins', 'Partner with local bank first'],
        ));
      }
    }

    return { director: 'treasury', recommendations: recs, healthScore: this.treasuryHealth(), activeStrategies: recs.length, lastUpdated: Date.now() };
  }

  // ── 2. Corridor Director ────────────────────────────────────────────────

  corridorDirector(): DirectorReport {
    const twin = this.inputs.getDigitalTwin();
    const recs: StrategicRecommendation[] = [];

    for (const corridor of twin.corridors) {
      if (corridor.health === 'critical') {
        recs.push(this.recommend(
          'corridor', 'adjust_corridor_pricing',
          `Increase pricing on ${corridor.from}→${corridor.to} — corridor is critical`,
          [], [{ from: corridor.from, to: corridor.to }], undefined, 'USD',
          'immediate', 0.1, 0.15, 0.85,
          `Critical corridor needs pricing adjustment to attract LPs`,
          ['Close corridor temporarily', 'Subsidize from other corridors'],
        ));
      }

      if (corridor.health === 'emerging') {
        recs.push(this.recommend(
          'corridor', 'open_corridor',
          `Develop corridor ${corridor.from}→${corridor.to} — emerging with growth potential`,
          [corridor.from, corridor.to], [{ from: corridor.from, to: corridor.to }],
          undefined, 'USD',
          'medium_term', 0.25, 0.3, 0.65,
          `Emerging corridor with potential — invest in LP recruitment`,
          ['Wait for organic demand', 'Focus on other corridors first'],
        ));
      }
    }

    // Check for missing corridors (countries without direct connections).
    const countries = twin.countries.map((c) => c.country);
    for (const from of countries) {
      for (const to of countries) {
        if (from === to) continue;
        const exists = twin.corridors.some((c) => c.from === from && c.to === to);
        if (!exists) {
          recs.push(this.recommend(
            'corridor', 'open_corridor',
            `Open new corridor ${from}→${to} — no direct connection exists`,
            [from, to], [{ from, to }], undefined, 'USD',
            'long_term', 0.15, 0.35, 0.5,
            `Missing corridor between active countries — potential demand`,
            ['Wait for demand signal', 'Route through intermediate country'],
          ));
          break; // only suggest one new corridor per source country
        }
      }
      if (recs.length > 5) break; // cap recommendations
    }

    return { director: 'corridor', recommendations: recs, healthScore: 0.7, activeStrategies: recs.length, lastUpdated: Date.now() };
  }

  // ── 3. LP Director ──────────────────────────────────────────────────────

  lpDirector(): DirectorReport {
    const report = this.inputs.getControlPlaneReport();
    const opt = report.networkOptimization;
    const recs: StrategicRecommendation[] = [];

    if (opt.networkDensity < 2) {
      recs.push(this.recommend(
        'lp', 'recruit_lps',
        `Recruit more LPs — network density at ${opt.networkDensity.toFixed(1)} LPs/corridor (target: ≥3)`,
        [], [], undefined, undefined,
        'short_term', 0.2, 0.15, 0.8,
        `Low density creates concentration risk`,
        ['Increase incentives first', 'Target specific corridors'],
      ));
    }

    if (opt.capitalEfficiency < 0.3) {
      recs.push(this.recommend(
        'lp', 'adjust_bandwidth_pricing',
        `Adjust bandwidth pricing — capital efficiency at ${(opt.capitalEfficiency * 100).toFixed(0)}%`,
        [], [], undefined, undefined,
        'short_term', 0.1, 0.2, 0.75,
        `Low efficiency suggests idle bandwidth — adjust pricing to incentivize usage`,
        ['Reduce bandwidth capacity', 'Wait for demand growth'],
      ));
    }

    for (const rec of opt.recommendations) {
      recs.push(this.recommend(
        'lp', 'rebalance_network',
        rec, [], [], undefined, undefined,
        'short_term', 0.08, 0.1, 0.7,
        `Network optimization recommendation`,
        ['Monitor only'],
      ));
    }

    return { director: 'lp', recommendations: recs, healthScore: opt.capitalEfficiency, activeStrategies: recs.length, lastUpdated: Date.now() };
  }

  // ── 4. FX Director ──────────────────────────────────────────────────────

  fxDirector(): DirectorReport {
    const twin = this.inputs.getDigitalTwin();
    const recs: StrategicRecommendation[] = [];

    // Check for countries with high stablecoin dependency (FX risk).
    for (const country of twin.countries) {
      if (country.stablecoinDependency > 0.6) {
        recs.push(this.recommend(
          'fx', 'hedge_fx_exposure',
          `Hedge FX exposure for ${country.country} — high stablecoin dependency creates FX risk`,
          [country.country], [], country.stablecoinReserves * 0.2, country.currency,
          'medium_term', 0.08, 0.15, 0.75,
          `High stablecoin dependency means FX volatility directly impacts backing`,
          ['Accept FX risk', 'Reduce stablecoin inventory'],
        ));
      }
    }

    return { director: 'fx', recommendations: recs, healthScore: 0.75, activeStrategies: recs.length, lastUpdated: Date.now() };
  }

  // ── 5. Settlement Director ──────────────────────────────────────────────

  settlementDirector(): DirectorReport {
    const twin = this.inputs.getDigitalTwin();
    const recs: StrategicRecommendation[] = [];

    // Check for high-latency countries.
    for (const country of twin.countries) {
      if (country.settlementLatency > 10000) {
        recs.push(this.recommend(
          'settlement', 'optimize_settlement_latency',
          `Optimize settlement latency for ${country.country} — currently ${(country.settlementLatency / 1000).toFixed(1)}s`,
          [country.country], [], undefined, country.currency,
          'short_term', 0.05, 0.1, 0.8,
          `High latency impacts user experience and LP confidence`,
          ['Switch blockchain', 'Add local settlement node'],
        ));
      }
    }

    return { director: 'settlement', recommendations: recs, healthScore: 0.8, activeStrategies: recs.length, lastUpdated: Date.now() };
  }

  // ── 6. Country Directors ────────────────────────────────────────────────

  countryDirectors(): DirectorReport[] {
    const twin = this.inputs.getDigitalTwin();
    const reports: DirectorReport[] = [];

    for (const country of twin.countries) {
      const recs: StrategicRecommendation[] = [];

      // Should we increase reserves?
      if (country.reserveCoverage < 0.5) {
        recs.push(this.recommend(
          'country', 'increase_reserve',
          `${country.country}: increase reserves — coverage at ${(country.reserveCoverage * 100).toFixed(0)}%`,
          [country.country], [], country.fiatReserves * 0.3, country.currency,
          'immediate', 0.15, 0.25, 0.85,
          `Reserve coverage below 50%`,
          ['Wait', 'Use stablecoins as bridge'],
        ));
      }

      // Should we recruit LPs?
      if (country.activeLPs < 3) {
        recs.push(this.recommend(
          'country', 'recruit_lps',
          `${country.country}: recruit LPs — only ${country.activeLPs} active`,
          [country.country], [], undefined, country.currency,
          'short_term', 0.2, 0.15, 0.75,
          `Low LP count creates concentration risk`,
          ['Increase incentives', 'Import bandwidth from neighbors'],
        ));
      }

      // Should we reduce stablecoins?
      if (country.stablecoinDependency > 0.5 && country.maturity !== 'fully_fiat') {
        recs.push(this.recommend(
          'country', 'reduce_stablecoins',
          `${country.country}: reduce stablecoin dependency — at ${(country.stablecoinDependency * 100).toFixed(0)}%`,
          [country.country], [], country.stablecoinReserves * 0.2, country.currency,
          'medium_term', 0.1, 0.2, 0.8,
          `High dependency risks depeg impact`,
          ['Gradual reduction', 'Keep current levels'],
        ));
      }

      const healthScore = (country.reserveCoverage + (1 - country.stablecoinDependency) + Math.min(1, country.activeLPs / 5)) / 3;

      reports.push({
        director: 'country',
        recommendations: recs,
        healthScore,
        activeStrategies: recs.length,
        lastUpdated: Date.now(),
      });
    }

    return reports;
  }

  // ── 7. Global Planner ───────────────────────────────────────────────────

  /**
   * Generate a global plan — cross-country optimization.
   *
   * Decides:
   *   - Where to move capital (from over-reserved to under-reserved countries)
   *   - Where to recruit LPs
   *   - Where to reduce stablecoins
   *   - Which countries to expand to
   */
  globalPlan(): GlobalPlan {
    const twin = this.inputs.getDigitalTwin();
    const allRecs: StrategicRecommendation[] = [];

    // Collect all director recommendations.
    const directorReports = [
      this.treasuryDirector(),
      this.corridorDirector(),
      this.lpDirector(),
      this.fxDirector(),
      this.settlementDirector(),
      ...this.countryDirectors(),
    ];
    for (const report of directorReports) {
      allRecs.push(...report.recommendations);
    }

    // Capital reallocation: move from high-coverage to low-coverage.
    const capitalReallocation: CapitalReallocation[] = [];
    const sorted = [...twin.countries].sort((a, b) => b.reserveCoverage - a.reserveCoverage);
    if (sorted.length >= 2) {
      const donor = sorted[0]; // highest coverage
      const recipient = sorted[sorted.length - 1]; // lowest coverage
      if (donor.reserveCoverage > 0.7 && recipient.reserveCoverage < 0.3) {
        const amount = donor.fiatReserves * 0.1;
        capitalReallocation.push({
          fromCountry: donor.country,
          toCountry: recipient.country,
          amount, currency: donor.currency,
          reason: `Reallocate from ${donor.country} (${(donor.reserveCoverage * 100).toFixed(0)}% coverage) to ${recipient.country} (${(recipient.reserveCoverage * 100).toFixed(0)}%)`,
        });
      }
    }

    // Expansion plans.
    const expansionPlans: ExpansionPlan[] = [];
    for (const country of twin.countries) {
      if (country.maturity === 'stablecoin_only' && country.activeLPs === 0) {
        expansionPlans.push({
          country: country.country,
          expectedDemand: country.demand || 50_000,
          expectedReserve: 100_000,
          expectedLPCount: 3,
          expectedProfitability: 0.15,
          recommendedLaunchDate: Date.now() + 90 * 86400000, // 90 days
          readiness: 'preparing',
        });
      }
    }

    const globalHealth = twin.countries.length > 0
      ? twin.countries.reduce((s, c) => s + c.reserveCoverage, 0) / twin.countries.length : 0.5;

    return {
      planId: uid('gp'),
      generatedAt: Date.now(),
      timeHorizon: 'medium_term',
      recommendations: allRecs,
      globalHealthScore: globalHealth,
      expectedNetworkROI: allRecs.length > 0
        ? allRecs.reduce((s, r) => s + r.expectedROI, 0) / allRecs.length : 0,
      expectedNetworkRisk: allRecs.length > 0
        ? allRecs.reduce((s, r) => s + r.expectedRisk, 0) / allRecs.length : 0,
      capitalReallocation,
      expansionPlans,
    };
  }

  // ── 8. Strategic Simulator ──────────────────────────────────────────────

  /**
   * Simulate a multi-year strategy on the digital twin.
   *
   *   "What happens if we open a reserve in Ethiopia, recruit 20 LPs,
   *    and reduce stablecoins over 5 years?"
   */
  simulate(strategy: {
    description: string;
    openReserves?: string[];
    recruitLPs?: number;
    reduceStablecoins?: number;
    yearsProjected: number;
  }): StrategicSimulation {
    const twin = this.inputs.getDigitalTwin();
    const years: YearProjection[] = [];

    // Start from current state.
    let reserves = twin.totalReserves;
    let twinTokens = twin.totalTwinTokens;
    let stablecoins = twin.totalStablecoins;
    let bandwidth = twin.totalBandwidth;
    let lps = twin.countries.reduce((s, c) => s + c.activeLPs, 0);
    let profit = 0;

    const baseGrowthRate = 0.15; // 15% annual growth
    const stablecoinReductionRate = strategy.reduceStablecoins ? 0.1 : 0.03;
    const lpGrowth = strategy.recruitLPs ? strategy.recruitLPs / strategy.yearsProjected : 1;

    for (let year = 1; year <= strategy.yearsProjected; year++) {
      reserves *= (1 + baseGrowthRate);
      twinTokens *= (1 + baseGrowthRate * 0.9);
      stablecoins *= (1 - stablecoinReductionRate);
      bandwidth *= (1 + baseGrowthRate * 0.5);
      lps += lpGrowth;
      profit += reserves * 0.02; // 2% of reserves as annual profit

      years.push({
        year, projectedReserves: reserves, projectedTwinTokens: twinTokens,
        projectedStablecoins: stablecoins, projectedBandwidth: bandwidth,
        projectedLPs: Math.round(lps), projectedProfit: profit,
      });
    }

    const projectedROI = profit / (twin.totalReserves || 1);
    const projectedRisk = stablecoins / (reserves + stablecoins || 1);
    const projectedTwinTokenGrowth = twinTokens / (twin.totalTwinTokens || 1) - 1;
    const projectedStablecoinReduction = 1 - stablecoins / (twin.totalStablecoins || 1);
    const projectedReserveGrowth = reserves / (twin.totalReserves || 1) - 1;

    return {
      simulationId: uid('sim'),
      scenario: strategy.description,
      yearsProjected: strategy.yearsProjected,
      startingState: twin,
      projectedState: { ...twin, totalReserves: reserves, totalTwinTokens: twinTokens, totalStablecoins: stablecoins, totalBandwidth: bandwidth, generatedAt: Date.now() },
      projectedROI, projectedRisk,
      projectedTwinTokenGrowth, projectedStablecoinReduction, projectedReserveGrowth,
      yearByYear: years,
      recommendation: projectedROI > 0.3 && projectedRisk < 0.3
        ? 'STRONG RECOMMEND: Strategy projected to yield significant ROI with manageable risk'
        : projectedROI > 0.1
        ? 'RECOMMEND WITH CAUTION: Positive ROI but monitor risk factors'
        : 'DO NOT RECOMMEND: Insufficient ROI or excessive risk',
      confidence: Math.max(0.3, 0.9 - strategy.yearsProjected * 0.1), // confidence decreases with time horizon
      simulatedAt: Date.now(),
    };
  }

  // ── 9. Economic Memory ──────────────────────────────────────────────────

  /**
   * Record an outcome in economic memory.
   * The Directorate learns from past actions to improve future recommendations.
   */
  remember(entry: Omit<EconomicMemoryEntry, 'memoryId'>): void {
    this.memory.push({ ...entry, memoryId: uid('mem') });
  }

  /**
   * Recall memories applicable to a specific country or action.
   */
  recall(country?: string, action?: StrategicAction): EconomicMemoryEntry[] {
    return this.memory.filter((m) => {
      if (country && !m.applicableTo.includes(country) && m.country !== country) return false;
      if (action && m.action !== action) return false;
      return true;
    });
  }

  /** Get all memories. */
  getAllMemories(): EconomicMemoryEntry[] {
    return [...this.memory];
  }

  // ── 10. Full Directorate Report ─────────────────────────────────────────

  getReport(): DirectorateReport {
    const directorReports = [
      this.treasuryDirector(),
      this.corridorDirector(),
      this.lpDirector(),
      this.fxDirector(),
      this.settlementDirector(),
      ...this.countryDirectors(),
    ];

    const plan = this.globalPlan();

    const networkStatus: DirectorateReport['networkStatus'] =
      plan.globalHealthScore > 0.8 ? 'optimal' :
      plan.globalHealthScore > 0.6 ? 'healthy' :
      plan.globalHealthScore > 0.4 ? 'constrained' :
      plan.globalHealthScore > 0.2 ? 'critical' : 'expanding';

    return {
      directors: directorReports,
      globalPlan: plan,
      strategicSimulations: [], // simulations are on-demand
      economicMemory: this.getAllMemories(),
      globalHealthScore: plan.globalHealthScore,
      networkStatus,
      generatedAt: Date.now(),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private recommend(
    director: DirectorType, action: StrategicAction, description: string,
    targetCountries: string[], targetCorridors: Array<{ from: string; to: string }>,
    amount: number | undefined, currency: string | undefined,
    timeHorizon: TimeHorizon, expectedROI: number, expectedRisk: number, confidence: number,
    rationale: string, alternatives: string[],
  ): StrategicRecommendation {
    return {
      recommendationId: uid('rec'),
      director, action, description,
      targetCountries, targetCorridors,
      amount, currency, timeHorizon,
      expectedROI, expectedRisk, confidence,
      rationale, alternatives,
      affectedEntities: { countries: targetCountries, reserves: targetCountries, lpIds: [], corridors: targetCorridors },
      approvalClass: this.classifyApproval(action, expectedRisk, amount ?? 0),
    };
  }

  private classifyApproval(action: StrategicAction, risk: number, amount: number): StrategicRecommendation['approvalClass'] {
    if (risk > 0.8) return 'governance';
    if (amount > 1_000_000) return 'governance';
    if (risk < 0.2 && amount < 100_000) return 'automatic';
    if (risk < 0.4 && amount < 500_000) return 'operator';
    if (risk < 0.7) return 'treasury';
    return 'governance';
  }

  private treasuryHealth(): number {
    const bs = this.inputs.getBalanceSheet();
    const coverage = bs.liabilities.twinTokensOutstanding > 0
      ? bs.assets.totalAssets / bs.liabilities.twinTokensOutstanding : 1;
    return Math.min(1, coverage);
  }
}
