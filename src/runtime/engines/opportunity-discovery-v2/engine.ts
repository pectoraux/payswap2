/**
 * Opportunity Discovery Engine v2 — pure, deterministic network analysis.
 * (M-RT-9.)
 *
 * Reads ONLY compiled projections (Capability Graph, Reserve Ledger, Reserve
 * Market, Liquidity Marketplace, Route Graph). Produces immutable Recommendation
 * protocol objects with evidence + expectedValue + graphDiff. No mutations.
 *
 * DETERMINISM: same graphs + same config + same clock = same recommendations.
 * No randomness.
 *
 * Each opportunity kind is a separate analyzer — a pure function from projections
 * to Recommendations. The engine runs all analyzers and aggregates the results.
 */

import type { Environment } from '../../types';
import type { LPCapability, CapabilityGraph } from '../../graphs/capability/types';
import type { ReserveState } from '../reserve-ledger/types';
import type { ReserveMarketSnapshot } from '../reserve-market-v2/types';
import type { LiquidityOffer } from '../liquidity-marketplace/types';
import type { Route } from '../routing/types';
import type { RouteGraph } from '../routing/types';
import type { ReserveLedgerService } from '../reserve-ledger/service';
import type { ReserveMarketEngine } from '../reserve-market-v2/engine';
import type { LiquidityMarketplaceService } from '../liquidity-marketplace/service';
import type { RouteCompiler } from '../routing/compiler';
import type { CapabilityGraph as ICapabilityGraph } from '../../graphs/capability/types';
import type { RuntimeClock } from '../../clock';

// ─── The Recommendation (immutable protocol object) ─────────────────────────

/** Severity of an opportunity. */
export type OpportunitySeverity = 'info' | 'warn' | 'critical';

/** The 12 opportunity kinds. */
export type OpportunityKind =
  | 'missing_bridge'
  | 'missing_lp_capability'
  | 'expensive_corridor'
  | 'underutilized_reserve'
  | 'overutilized_reserve'
  | 'idle_liquidity'
  | 'fragmented_liquidity'
  | 'reserve_fragmentation'
  | 'missing_connector'
  | 'high_latency_path'
  | 'excessive_fee_path'
  | 'single_provider_dependency';

/** A proposed graph transformation. */
export interface OpportunityGraphDiff {
  addNodes: { id: string; type: string; label: string }[];
  addEdges: { from: string; to: string; relationship: string }[];
  description: string;
}

/** An implementation step. */
export interface OpportunityStep {
  action: string;
  estimatedEffort: 'low' | 'medium' | 'high';
}

/** Evidence supporting the recommendation. */
export interface OpportunityEvidence {
  source: string;
  observation: string;
  confidence: number;
}

/** An immutable Recommendation (a protocol object, not an action). */
export interface OpportunityRecommendation {
  id: string;
  kind: OpportunityKind;
  severity: OpportunitySeverity;
  title: string;
  description: string;
  confidence: number;            // 0..1
  expectedValue: { dimension: string; delta: string }[];
  evidence: OpportunityEvidence[];
  graphDiff: OpportunityGraphDiff;
  implementationSteps: OpportunityStep[];
  assumptions: string[];
  generatedAt: number;           // Runtime Clock
}

/** The result of running all analyzers. */
export interface DiscoveryResult {
  recommendations: OpportunityRecommendation[];
  count: number;
  byKind: Record<string, number>;
  generatedAt: number;
}

// ─── The inputs (all read-only compiled projections) ────────────────────────

export interface DiscoveryInputs {
  capabilities: LPCapability[];
  reserves: ReserveState[];
  marketSnapshots: ReserveMarketSnapshot[];
  offers: LiquidityOffer[];
  routes: Route[];
}

// ─── Individual analyzers (each is a pure function) ──────────────────────────

type Analyzer = (inputs: DiscoveryInputs, now: number) => OpportunityRecommendation[];

/** Analyzer: missing_bridge — capabilities that chain but a direct link is missing. */
function missingBridgeAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  // If LP A can do KES→TwinGHS and LP B can do TwinGHS→GHS but no one does KES→GHS directly.
  const assets = new Set<string>();
  inputs.capabilities.forEach((c) => { assets.add(c.from); assets.add(c.to); });

  for (const from of assets) {
    for (const to of assets) {
      if (from === to) continue;
      // Check if there's a 2-hop path A→B→C but no direct A→C.
      const direct = inputs.capabilities.some((c) => c.from === from && c.to === to);
      if (direct) continue;
      // Check for 2-hop path.
      const intermediates = inputs.capabilities
        .filter((c) => c.from === from)
        .map((c) => c.to);
      const hasTwoHop = intermediates.some((mid) =>
        inputs.capabilities.some((c) => c.from === mid && c.to === to),
      );
      if (hasTwoHop) {
        recs.push(makeRec({
          kind: 'missing_bridge',
          severity: 'info',
          title: `Missing direct bridge ${from}→${to}`,
          description: `A 2-hop path exists (${from}→${intermediates.find((mid) => inputs.capabilities.some((c) => c.from === mid && c.to === to))}→${to}) but no direct ${from}→${to} capability. Adding it would eliminate one settlement hop.`,
          confidence: 0.7,
          expectedValue: [
            { dimension: 'cost', delta: '-35% (one fewer hop)' },
            { dimension: 'latency', delta: '-48% (one fewer settlement)' },
          ],
          evidence: [{ source: 'capability_graph', observation: `2-hop path ${from}→...→${to} exists; no direct path`, confidence: 0.9 }],
          graphDiff: {
            addNodes: [],
            addEdges: [{ from, to, relationship: 'direct_bridge' }],
            description: `Add a direct ${from}→${to} capability`,
          },
          steps: [{ action: `Publish a ${from}→${to} capability`, estimatedEffort: 'medium' }],
          assumptions: ['LPs have capital to support the new route'],
          now,
        }));
      }
    }
  }
  return recs;
}

/** Analyzer: expensive_corridor — routes with above-median execution cost. */
function expensiveCorridorAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  if (inputs.offers.length === 0) return recs;
  const fees = inputs.offers.map((o) => o.pricingCurve[0]?.feeBps ?? 0);
  const median = fees.sort((a, b) => a - b)[Math.floor(fees.length / 2)] ?? 0;

  for (const offer of inputs.offers) {
    const fee = offer.pricingCurve[0]?.feeBps ?? 0;
    if (fee > median * 1.5 && median > 0) {
      recs.push(makeRec({
        kind: 'expensive_corridor',
        severity: 'warn',
        title: `Expensive corridor ${offer.from}→${offer.to} via ${offer.lpId}`,
        description: `Fee ${fee}bps is ${Math.round((fee / median - 1) * 100)}% above median (${median}bps). Competition or re-pricing needed.`,
        confidence: 0.8,
        expectedValue: [
          { dimension: 'cost', delta: `-${Math.round((fee - median) / 2)}bps if repriced` },
        ],
        evidence: [{ source: 'liquidity_marketplace', observation: `Fee ${fee}bps vs median ${median}bps`, confidence: 0.9 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — pricing optimization' },
        steps: [{ action: 'Attract competing LPs or negotiate repricing', estimatedEffort: 'medium' }],
        assumptions: ['Median fee is a fair market price'],
        now,
      }));
    }
  }
  return recs;
}

/** Analyzer: underutilized_reserve — reserves with low utilization. */
function underutilizedReserveAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  for (const snap of inputs.marketSnapshots) {
    if (snap.utilization < 0.2 && snap.total > 0) {
      recs.push(makeRec({
        kind: 'underutilized_reserve',
        severity: 'info',
        title: `Underutilized reserve ${snap.reserveId} (${snap.asset})`,
        description: `Utilization ${(snap.utilization * 100).toFixed(1)}% is below 20%. ${snap.available.toLocaleString()} ${snap.asset} idle. Consider reducing or redeploying.`,
        confidence: 0.85,
        expectedValue: [
          { dimension: 'capital_efficiency', delta: `+${Math.round((0.5 - snap.utilization) * 100)}% if redeployed` },
        ],
        evidence: [{ source: 'reserve_market', observation: `utilization=${snap.utilization.toFixed(2)}, available=${snap.available}`, confidence: 0.95 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — capital reallocation' },
        steps: [{ action: `Reduce ${snap.asset} reserve or redeploy to a higher-demand corridor`, estimatedEffort: 'low' }],
        assumptions: ['Idle capital has an alternative yield'],
        now,
      }));
    }
  }
  return recs;
}

/** Analyzer: overutilized_reserve — reserves with critical utilization. */
function overutilizedReserveAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  for (const snap of inputs.marketSnapshots) {
    if (snap.utilization >= 0.9) {
      recs.push(makeRec({
        kind: 'overutilized_reserve',
        severity: 'critical',
        title: `Overutilized reserve ${snap.reserveId} (${snap.asset})`,
        description: `Utilization ${(snap.utilization * 100).toFixed(1)}% is critical. Shadow price ${snap.shadowPriceBps}bps. Settlement failures likely if not replenished.`,
        confidence: 0.95,
        expectedValue: [
          { dimension: 'throughput', delta: `+${Math.round((1 - snap.utilization) * 50)}% if replenished` },
          { dimension: 'cost', delta: `-${Math.round(snap.shadowPriceBps * 0.5)}bps shadow price if replenished` },
        ],
        evidence: [{ source: 'reserve_market', observation: `utilization=${snap.utilization.toFixed(2)}, scarcity=${snap.scarcity}, shadowPrice=${snap.shadowPriceBps}bps`, confidence: 0.98 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — capital injection' },
        steps: [{ action: `Replenish ${snap.asset} reserve by at least ${Math.round(snap.total * 0.3).toLocaleString()}`, estimatedEffort: 'medium' }],
        assumptions: ['Treasury has capital available for replenishment'],
        now,
      }));
    }
  }
  return recs;
}

/** Analyzer: idle_liquidity — LPs with no offers in the marketplace. */
function idleLiquidityAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  const lpIdsWithOffers = new Set(inputs.offers.map((o) => o.lpId));
  const lpIdsWithCapabilities = new Set(inputs.capabilities.map((c) => c.ownerId));

  for (const lpId of lpIdsWithCapabilities) {
    if (!lpIdsWithOffers.has(lpId)) {
      const caps = inputs.capabilities.filter((c) => c.ownerId === lpId);
      recs.push(makeRec({
        kind: 'idle_liquidity',
        severity: 'warn',
        title: `Idle liquidity: LP ${lpId} has ${caps.length} capabilities but no marketplace offers`,
        description: `LP ${lpId} can serve ${caps.map((c) => `${c.from}→${c.to}`).join(', ')} but has no active offers. This liquidity is unavailable to the network.`,
        confidence: 0.9,
        expectedValue: [
          { dimension: 'volume', delta: `+${caps.length} routes enabled` },
        ],
        evidence: [{ source: 'capability_graph + marketplace', observation: `${caps.length} capabilities, 0 offers`, confidence: 0.95 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — LP needs to publish offers' },
        steps: [{ action: `LP ${lpId} should publish offers for its ${caps.length} capabilities`, estimatedEffort: 'low' }],
        assumptions: ['LP is willing to provide liquidity'],
        now,
      }));
    }
  }
  return recs;
}

/** Analyzer: single_provider_dependency — routes served by only one LP. */
function singleProviderDependencyAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  const routeProviders = new Map<string, Set<string>>();
  for (const cap of inputs.capabilities) {
    const key = `${cap.from}→${cap.to}`;
    if (!routeProviders.has(key)) routeProviders.set(key, new Set());
    routeProviders.get(key)!.add(cap.ownerId);
  }
  for (const [route, providers] of routeProviders) {
    if (providers.size === 1) {
      const lpId = [...providers][0];
      recs.push(makeRec({
        kind: 'single_provider_dependency',
        severity: 'warn',
        title: `Single provider dependency: ${route} served only by ${lpId}`,
        description: `Route ${route} has only 1 provider (${lpId}). If ${lpId} goes offline, this route fails. Attracting a second provider would add resilience.`,
        confidence: 0.85,
        expectedValue: [
          { dimension: 'resilience', delta: '+100% (2 providers vs 1)' },
          { dimension: 'cost', delta: '-10% from competition' },
        ],
        evidence: [{ source: 'capability_graph', observation: `Route ${route}: 1 provider (${lpId})`, confidence: 0.95 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — attract new LP' },
        steps: [{ action: `Attract a second LP for ${route}`, estimatedEffort: 'high' }],
        assumptions: ['A second LP is available in this corridor'],
        now,
      }));
    }
  }
  return recs;
}

/** Analyzer: high_latency_path — routes with above-median latency. */
function highLatencyPathAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  if (inputs.capabilities.length === 0) return recs;
  const latencies = inputs.capabilities.map((c) => c.latencyMs).sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)] ?? 0;

  for (const cap of inputs.capabilities) {
    if (cap.latencyMs > median * 2 && median > 0) {
      recs.push(makeRec({
        kind: 'high_latency_path',
        severity: 'info',
        title: `High latency: ${cap.from}→${cap.to} via ${cap.ownerId} (${cap.latencyMs}ms)`,
        description: `Latency ${cap.latencyMs}ms is ${Math.round(cap.latencyMs / median)}× the median (${median}ms). A faster connector or settlement method would improve UX.`,
        confidence: 0.75,
        expectedValue: [
          { dimension: 'latency', delta: `-${Math.round((cap.latencyMs - median) / 2)}ms` },
        ],
        evidence: [{ source: 'capability_graph', observation: `latency=${cap.latencyMs}ms vs median=${median}ms`, confidence: 0.9 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — connector upgrade' },
        steps: [{ action: `Upgrade connector for ${cap.ownerId} or add a faster provider`, estimatedEffort: 'medium' }],
        assumptions: ['A faster connector is available'],
        now,
      }));
    }
  }
  return recs;
}

/** Analyzer: excessive_fee_path — capabilities with high cost curves. */
function excessiveFeePathAnalyzer(inputs: DiscoveryInputs, now: number): OpportunityRecommendation[] {
  const recs: OpportunityRecommendation[] = [];
  for (const cap of inputs.capabilities) {
    const maxFee = Math.max(...cap.costCurve.map((t) => t.feeBps));
    if (maxFee > 300) {
      recs.push(makeRec({
        kind: 'excessive_fee_path',
        severity: 'warn',
        title: `Excessive fee: ${cap.from}→${cap.to} via ${cap.ownerId} (${maxFee}bps at high utilization)`,
        description: `Maximum fee tier ${maxFee}bps exceeds 300bps. This makes the route uncompetitive at high utilization.`,
        confidence: 0.8,
        expectedValue: [
          { dimension: 'cost', delta: `-${Math.round(maxFee * 0.3)}bps if repriced` },
        ],
        evidence: [{ source: 'capability_graph', observation: `maxFee=${maxFee}bps on cost curve`, confidence: 0.9 }],
        graphDiff: { addNodes: [], addEdges: [], description: 'No graph change — pricing optimization' },
        steps: [{ action: `Reprice ${cap.ownerId}'s cost curve to cap at 300bps`, estimatedEffort: 'low' }],
        assumptions: ['LP is willing to reprice'],
        now,
      }));
    }
  }
  return recs;
}

// Stubs for the remaining 4 analyzers (they exist for completeness; real logic in later milestones).
function missingLpCapabilityAnalyzer(_inputs: DiscoveryInputs, _now: number): OpportunityRecommendation[] { return []; }
function fragmentedLiquidityAnalyzer(_inputs: DiscoveryInputs, _now: number): OpportunityRecommendation[] { return []; }
function reserveFragmentationAnalyzer(_inputs: DiscoveryInputs, _now: number): OpportunityRecommendation[] { return []; }
function missingConnectorAnalyzer(_inputs: DiscoveryInputs, _now: number): OpportunityRecommendation[] { return []; }

// ─── Helper ─────────────────────────────────────────────────────────────────

function makeRec(params: {
  kind: OpportunityKind; severity: OpportunitySeverity; title: string; description: string;
  confidence: number; expectedValue: { dimension: string; delta: string }[];
  evidence: OpportunityEvidence[]; graphDiff: OpportunityGraphDiff;
  steps: OpportunityStep[]; assumptions: string[]; now: number;
}): OpportunityRecommendation {
  return {
    id: `rec_${params.kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: params.kind, severity: params.severity, title: params.title, description: params.description,
    confidence: params.confidence, expectedValue: params.expectedValue, evidence: params.evidence,
    graphDiff: params.graphDiff, implementationSteps: params.steps, assumptions: params.assumptions,
    generatedAt: params.now,
  };
}

// ─── The Engine ─────────────────────────────────────────────────────────────

/** All analyzers, in order. */
const ANALYZERS: Analyzer[] = [
  missingBridgeAnalyzer,
  missingLpCapabilityAnalyzer,
  expensiveCorridorAnalyzer,
  underutilizedReserveAnalyzer,
  overutilizedReserveAnalyzer,
  idleLiquidityAnalyzer,
  fragmentedLiquidityAnalyzer,
  reserveFragmentationAnalyzer,
  missingConnectorAnalyzer,
  highLatencyPathAnalyzer,
  excessiveFeePathAnalyzer,
  singleProviderDependencyAnalyzer,
];

/** The inputs needed to run discovery (all lower-layer services, read-only). */
export interface DiscoveryEngineInputs {
  capabilityGraph: ICapabilityGraph;
  reserveLedger: ReserveLedgerService;
  reserveMarket: ReserveMarketEngine;
  liquidityMarketplace: LiquidityMarketplaceService;
  routeCompiler: RouteCompiler;
  clock: RuntimeClock;
}

/**
 * OpportunityDiscoveryEngine — pure, deterministic network analysis.
 * Reads only compiled projections. Produces immutable Recommendations.
 * No mutations. No randomness.
 */
export class OpportunityDiscoveryEngine {
  constructor(private inputs: DiscoveryEngineInputs) {}

  /** Discover all opportunities. Pure, deterministic. */
  async discover(environment: Environment): Promise<DiscoveryResult> {
    const now = this.inputs.clock.now();

    // Gather all inputs (read-only — no mutations).
    const capabilities = this.inputs.capabilityGraph.all();
    const reserves = await this.inputs.reserveLedger.listReserves(environment);
    const marketSnapshots = (await this.inputs.reserveMarket.getMarketSnapshotAll(environment)).reserves;
    const book = await this.inputs.liquidityMarketplace.getOrderBook(environment);
    const offers = book.offers;
    const routeGraph = this.inputs.routeCompiler.rebuild(this.inputs.capabilityGraph, now);
    const routes = routeGraph.routes;

    const discoveryInputs: DiscoveryInputs = { capabilities, reserves, marketSnapshots, offers, routes };

    // Run all analyzers.
    const allRecs: OpportunityRecommendation[] = [];
    for (const analyzer of ANALYZERS) {
      const recs = analyzer(discoveryInputs, now);
      allRecs.push(...recs);
    }

    // Build the by-kind summary.
    const byKind: Record<string, number> = {};
    for (const rec of allRecs) {
      byKind[rec.kind] = (byKind[rec.kind] ?? 0) + 1;
    }

    return {
      recommendations: allRecs,
      count: allRecs.length,
      byKind,
      generatedAt: now,
    };
  }
}
