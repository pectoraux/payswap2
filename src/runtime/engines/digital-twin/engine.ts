/**
 * DigitalTwinEngine — pure simulation layer. (M-RT-11.)
 *
 * A PURE FUNCTION: (snapshot, recommendation, config) → SimulationResult.
 * No persistent state, no event emission, no projection mutation.
 * Deterministic: identical inputs → identical outputs.
 *
 * Five responsibilities:
 *   1. Counterfactual — apply the recommendation's graph diff to the snapshot
 *   2. Prediction — estimate the simulated network metrics
 *   3. Comparison — current vs simulated (explicit deltas + rationale)
 *   4. Confidence — score with explicit assumptions
 *   5. Explanation — why the prediction changed
 *
 * The Recommendation Lifecycle owns state transitions. The Twin only simulates.
 */

import type { Environment } from '../../types';
import type { RuntimeClock } from '../../clock';
import type { CapabilityGraph } from '../../graphs/capability/types';
import type { ReserveLedgerService } from '../reserve-ledger/service';
import type { ReserveMarketEngine } from '../reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../liquidity-marketplace/service';
import type { RouteCompiler } from '../routing/compiler';
import type {
  NetworkSnapshot,
  NetworkComparison,
  PredictedMetric,
  SimulationResult,
  SimulationAssumption,
  SimulatableRecommendation,
  TwinConfig,
} from './types';
import { DEFAULT_TWIN_CONFIG } from './types';

/** Inputs to the Digital Twin (all read-only lower-layer services). */
export interface DigitalTwinInputs {
  capabilityGraph: CapabilityGraph;
  reserveLedger: ReserveLedgerService;
  reserveMarket: ReserveMarketEngine;
  liquidityMarketplace: LiquidityMarketplaceService;
  routeCompiler: RouteCompiler;
  clock: RuntimeClock;
}

export class DigitalTwinEngine {
  constructor(
    private inputs: DigitalTwinInputs,
    private config: TwinConfig = DEFAULT_TWIN_CONFIG,
  ) {}

  /**
   * Simulate a recommendation. Pure, deterministic, no side effects.
   * "What would happen if Recommendation X were implemented?"
   */
  async simulate(
    recommendation: SimulatableRecommendation,
    environment: Environment,
  ): Promise<SimulationResult> {
    const now = this.inputs.clock.now();

    // 1. Capture the current network snapshot (read-only).
    const baseline = await this.captureSnapshot(environment);

    // 2. Predict the simulated network (apply the recommendation's effect).
    const simulated = this.predictSimulated(baseline, recommendation);

    // 3. Compare current vs simulated.
    const comparison = this.compare(baseline, simulated, recommendation);

    // 4. Estimate confidence with assumptions.
    const { confidence, assumptions } = this.estimateConfidence(recommendation, baseline, simulated);

    // 5. Explain.
    const explanation = this.explain(recommendation, comparison, confidence);

    return {
      recommendationId: recommendation.id,
      recommendationKind: recommendation.kind,
      recommendationTitle: recommendation.title,
      baseline,
      simulated,
      comparison,
      confidence,
      assumptions,
      explanation,
      generatedAt: now,
      success: true,
    };
  }

  // ── private: snapshot capture (read-only) ────────────────────────────

  private async captureSnapshot(environment: Environment): Promise<NetworkSnapshot> {
    const { capabilityGraph, reserveLedger, reserveMarket, liquidityMarketplace, routeCompiler } = this.inputs;

    const capabilities = capabilityGraph.all();
    const routeGraph = routeCompiler.rebuild(capabilityGraph, this.inputs.clock.now());
    const reserves = await reserveLedger.listReserves(environment);
    const marketSnapshots = (await reserveMarket.getMarketSnapshotAll(environment)).reserves;
    const book = await liquidityMarketplace.getOrderBook(environment);
    const offers = book.offers;

    const uniqueAssets = new Set<string>();
    capabilities.forEach((c) => { uniqueAssets.add(c.from); uniqueAssets.add(c.to); });

    const fees = offers.map((o) => o.pricingCurve[0]?.feeBps ?? 0).sort((a, b) => a - b);
    const medianFeeBps = fees.length > 0 ? fees[Math.floor(fees.length / 2)] : 0;
    const totalOfferCapacity = offers.reduce((sum, o) => sum + o.maxAmount, 0);

    const totalAvailable = marketSnapshots.reduce((sum, r) => sum + r.available, 0);
    const totalLocked = marketSnapshots.reduce((sum, r) => sum + r.locked, 0);
    const averageUtilization = marketSnapshots.length > 0
      ? marketSnapshots.reduce((sum, r) => sum + r.utilization, 0) / marketSnapshots.length
      : 0;

    // Single-provider routes.
    const routeProviders = new Map<string, Set<string>>();
    for (const cap of capabilities) {
      const key = `${cap.from}→${cap.to}`;
      if (!routeProviders.has(key)) routeProviders.set(key, new Set());
      routeProviders.get(key)!.add(cap.ownerId);
    }
    const singleProviderRoutes = [...routeProviders.values()].filter((s) => s.size === 1).length;

    const criticalReserves = marketSnapshots.filter((r) => r.scarcity === 'CRITICAL').length;

    return {
      capabilityCount: capabilities.length,
      routeCount: routeGraph.routes.length,
      uniqueAssets: uniqueAssets.size,
      offerCount: offers.length,
      totalOfferCapacity,
      medianFeeBps,
      reserveCount: reserves.length,
      totalReserveAvailable: totalAvailable,
      totalReserveLocked: totalLocked,
      averageUtilization,
      singleProviderRoutes,
      criticalReserves,
      estimatedThroughputPerHour: offers.length * this.config.assumedVolumePerRoute,
    };
  }

  // ── private: prediction (apply the recommendation's effect) ──────────

  private predictSimulated(
    baseline: NetworkSnapshot,
    rec: SimulatableRecommendation,
  ): NetworkSnapshot {
    const sim = { ...baseline };

    switch (rec.kind) {
      case 'missing_bridge': {
        // A new direct route is added → +1 capability, +1 route, fewer hops for some payments.
        sim.capabilityCount += 1;
        sim.routeCount += 1;
        sim.estimatedThroughputPerHour += this.config.assumedVolumePerRoute;
        break;
      }
      case 'expensive_corridor': {
        // Repricing → median fee drops.
        sim.medianFeeBps = Math.round(baseline.medianFeeBps * (1 - this.config.competitionFeeReductionPercent / 100));
        break;
      }
      case 'underutilized_reserve': {
        // Capital redeployed → average utilization improves.
        sim.averageUtilization = Math.min(1, baseline.averageUtilization + this.config.replenishmentUtilizationImprovement);
        break;
      }
      case 'overutilized_reserve': {
        // Reserve replenished → utilization drops, critical reserves decrease.
        sim.averageUtilization = Math.max(0, baseline.averageUtilization - this.config.replenishmentUtilizationImprovement);
        sim.criticalReserves = Math.max(0, baseline.criticalReserves - 1);
        sim.totalReserveAvailable += Math.round(baseline.totalReserveAvailable * 0.3); // +30% replenishment
        break;
      }
      case 'idle_liquidity': {
        // LP publishes offers → +offers, +capacity.
        sim.offerCount += 1;
        sim.totalOfferCapacity += this.config.assumedVolumePerRoute * 10;
        sim.estimatedThroughputPerHour += this.config.assumedVolumePerRoute;
        break;
      }
      case 'single_provider_dependency': {
        // Second provider → -1 single-provider route, fees drop from competition.
        sim.singleProviderRoutes = Math.max(0, baseline.singleProviderRoutes - 1);
        sim.medianFeeBps = Math.round(baseline.medianFeeBps * (1 - this.config.competitionFeeReductionPercent / 100));
        break;
      }
      case 'excessive_fee_path': {
        // Fee capped → median drops.
        sim.medianFeeBps = Math.min(baseline.medianFeeBps, 200);
        break;
      }
      case 'high_latency_path': {
        // Faster connector → no metric change in M-RT-11 (latency not in snapshot).
        break;
      }
      default: {
        // Unknown kind — no change.
        break;
      }
    }

    return sim;
  }

  // ── private: comparison ──────────────────────────────────────────────

  private compare(
    baseline: NetworkSnapshot,
    simulated: NetworkSnapshot,
    rec: SimulatableRecommendation,
  ): NetworkComparison {
    const metrics: PredictedMetric[] = [];
    const improvements: string[] = [];
    const regressions: string[] = [];

    const fields: (keyof NetworkSnapshot)[] = [
      'capabilityCount', 'routeCount', 'uniqueAssets', 'offerCount', 'totalOfferCapacity',
      'medianFeeBps', 'reserveCount', 'totalReserveAvailable', 'totalReserveLocked',
      'averageUtilization', 'singleProviderRoutes', 'criticalReserves', 'estimatedThroughputPerHour',
    ];

    for (const field of fields) {
      const current = baseline[field] as number;
      const predicted = simulated[field] as number;
      if (current === predicted) continue;

      const delta = predicted - current;
      const deltaPercent = current !== 0 ? (delta / current) * 100 : 0;

      // Determine if this is an improvement or regression.
      // For fees/utilization/critical/single-provider: lower is better.
      // For capacity/throughput/routes/offers: higher is better.
      const lowerIsBetter = ['medianFeeBps', 'averageUtilization', 'singleProviderRoutes', 'criticalReserves', 'totalReserveLocked'].includes(field);
      const isImprovement = lowerIsBetter ? delta < 0 : delta > 0;

      const rationale = this.metricRationale(field, delta, rec);
      metrics.push({ metric: field, currentValue: current, predictedValue: predicted, delta, deltaPercent, rationale });

      if (isImprovement) {
        improvements.push(`${field}: ${current} → ${predicted} (${deltaPercent.toFixed(1)}%)`);
      } else {
        regressions.push(`${field}: ${current} → ${predicted} (${deltaPercent.toFixed(1)}%)`);
      }
    }

    const netAssessment = improvements.length > regressions.length
      ? 'positive'
      : regressions.length > improvements.length
        ? 'negative'
        : 'neutral';

    return { metrics, improvements, regressions, netAssessment };
  }

  private metricRationale(field: string, delta: number, rec: SimulatableRecommendation): string {
    if (delta === 0) return 'No change';
    const direction = delta > 0 ? 'increased' : 'decreased';
    return `${field} ${direction} by ${Math.abs(delta)} due to: ${rec.title}`;
  }

  // ── private: confidence estimation ───────────────────────────────────

  private estimateConfidence(
    rec: SimulatableRecommendation,
    baseline: NetworkSnapshot,
    simulated: NetworkSnapshot,
  ): { confidence: number; assumptions: SimulationAssumption[] } {
    let confidence = this.config.baseConfidence;
    const assumptions: SimulationAssumption[] = [];

    // Adjust based on the recommendation's own confidence.
    if (rec.confidence > 0.8) {
      confidence += 0.1;
      assumptions.push({ assumption: 'High recommendation confidence', impact: '+0.10 confidence' });
    } else if (rec.confidence < 0.5) {
      confidence -= 0.1;
      assumptions.push({ assumption: 'Low recommendation confidence', impact: '-0.10 confidence' });
    }

    // Adjust based on data availability.
    if (baseline.offerCount === 0) {
      confidence -= 0.2;
      assumptions.push({ assumption: 'No marketplace offers — prediction is speculative', impact: '-0.20 confidence' });
    }
    if (baseline.reserveCount === 0) {
      confidence -= 0.1;
      assumptions.push({ assumption: 'No reserves — reserve metrics are speculative', impact: '-0.10 confidence' });
    }

    // Adjust based on magnitude of change.
    const metricChanges = Object.keys(baseline).filter((k) => baseline[k as keyof NetworkSnapshot] !== simulated[k as keyof NetworkSnapshot]);
    if (metricChanges.length > 5) {
      confidence -= 0.05;
      assumptions.push({ assumption: `${metricChanges.length} metrics change — high uncertainty`, impact: '-0.05 confidence' });
    }

    // Clamp.
    confidence = Math.max(0.1, Math.min(0.95, confidence));

    assumptions.push({ assumption: 'Base confidence from configuration', impact: `${this.config.baseConfidence} baseline` });

    return { confidence, assumptions };
  }

  // ── private: explanation ─────────────────────────────────────────────

  private explain(rec: SimulatableRecommendation, comparison: NetworkComparison, confidence: number): string {
    const parts: string[] = [];
    parts.push(`Simulating recommendation "${rec.title}" (${rec.kind}):`);
    if (comparison.improvements.length > 0) {
      parts.push(`Improvements: ${comparison.improvements.join('; ')}.`);
    }
    if (comparison.regressions.length > 0) {
      parts.push(`Regressions: ${comparison.regressions.join('; ')}.`);
    }
    parts.push(`Net assessment: ${comparison.netAssessment}.`);
    parts.push(`Confidence: ${confidence.toFixed(2)}.`);
    return parts.join(' ');
  }
}
