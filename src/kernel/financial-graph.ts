/**
 * Financial Graph — the kernel's canonical world topology.
 *
 * Every wallet, reserve, LP, treasury, financial operator, stablecoin pool and
 * insurance pool is a NODE. Every possible liquidity movement between two
 * nodes is an EDGE with 9 weighted properties (cost, latency, reliability,
 * liquidity, trust, settlement, carbon, impact, compliance).
 *
 * The Liquidity Planner does not hardcode routes. It builds this graph from
 * the world state and traverses it to find the optimal path (or mixed path)
 * from source to destination. This is what makes the kernel a Financial
 * Operating System rather than a payment router: any liquidity movement —
 * payment, treasury rebalance, insurance payout, reserve refill, LP
 * withdrawal, stablecoin conversion — is a graph traversal.
 */
import type {
  CurrencyCode,
  LiquiditySourceKind,
  FinancialOperatorType,
} from './types';

export type GraphNodeType =
  | 'wallet'
  | 'reserve'
  | 'lp'
  | 'treasury'
  | 'stablecoin'
  | 'fo'
  | 'insurance_pool';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  country?: string;
  currency?: CurrencyCode;
  balance: number;
  sourceKind?: LiquiditySourceKind;
  foType?: FinancialOperatorType;
  online: boolean;
  manualOnly: boolean;
}

export type GraphEdgeKind =
  | 'debit'
  | 'credit'
  | 'convert'
  | 'bridge'
  | 'mint'
  | 'burn'
  | 'draw';

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: GraphEdgeKind;
  cost: number;       // bps
  latencyMs: number;
  reliability: number; // 0..1
  liquidity: number;   // available capacity through this edge
  trust: number;       // 0..1
  settlement: number;  // 0..1 settlement guarantee
  carbon: number;      // 0..1 (lower is better)
  impact: number;      // 0..1 (higher is better — community/cooperative)
  compliance: number;  // 0..1
}

export interface GraphPath {
  edges: GraphEdge[];
  nodes: GraphNode[];
  totalCost: number;
  totalLatencyMs: number;
  avgReliability: number;
  totalLiquidity: number;
  feasible: boolean;
}

export class FinancialGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private adjacency: Map<string, GraphEdge[]> = new Map();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, []);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  addEdge(edge: GraphEdge): void {
    this.edges.push(edge);
    if (!this.adjacency.has(edge.from)) this.adjacency.set(edge.from, []);
    this.adjacency.get(edge.from)!.push(edge);
  }

  allNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  allEdges(): GraphEdge[] {
    return [...this.edges];
  }

  edgesFrom(nodeId: string): GraphEdge[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  /**
   * Find all paths from `source` to `destination` up to `maxDepth` hops.
   * Returns paths sorted by a blended score (cost + latency + reliability).
   * The planner then picks the best (or mixes multiple).
   */
  findPaths(source: string, destination: string, maxDepth = 5): GraphPath[] {
    const paths: GraphPath[] = [];
    const visited = new Set<string>();

    const dfs = (current: string, path: GraphEdge[], depth: number) => {
      if (depth > maxDepth) return;
      if (current === destination && path.length > 0) {
        paths.push(this.evaluatePath(path));
        return;
      }
      if (visited.has(current) && path.length > 0) return; // no cycles
      visited.add(current);
      for (const edge of this.edgesFrom(current)) {
        const targetNode = this.getNode(edge.to);
        if (!targetNode || !targetNode.online) continue;
        if (edge.liquidity <= 0) continue;
        dfs(edge.to, [...path, edge], depth + 1);
      }
      visited.delete(current);
    };

    dfs(source, [], 0);
    // Sort by blended score: lower cost + lower latency + higher reliability.
    paths.sort((a, b) => {
      const sa = a.totalCost / 10 + a.totalLatencyMs / 10000 + (1 - a.avgReliability) * 100;
      const sb = b.totalCost / 10 + b.totalLatencyMs / 10000 + (1 - b.avgReliability) * 100;
      return sa - sb;
    });
    return paths;
  }

  private evaluatePath(edges: GraphEdge[]): GraphPath {
    const nodes = edges.map((e) => this.getNode(e.to)!).filter(Boolean);
    return {
      edges,
      nodes,
      totalCost: edges.reduce((s, e) => s + e.cost, 0),
      totalLatencyMs: edges.reduce((s, e) => s + e.latencyMs, 0),
      avgReliability: edges.length ? edges.reduce((s, e) => s + e.reliability, 0) / edges.length : 1,
      totalLiquidity: Math.min(...edges.map((e) => e.liquidity), Infinity),
      feasible: edges.every((e) => e.liquidity > 0),
    };
  }

  /**
   * Mix multiple paths to satisfy an amount that no single path can cover.
   * Returns a weighted combination (e.g. 40% reserve + 35% LP + 25% treasury).
   */
  mixPaths(paths: GraphPath[], amount: number, weights: number[]): { path: GraphPath; draw: number }[] {
    const result: { path: GraphPath; draw: number }[] = [];
    let remaining = amount;
    for (let i = 0; i < paths.length && remaining > 1e-6; i++) {
      const path = paths[i];
      const allocation = Math.min(remaining, path.totalLiquidity * (weights[i] ?? 1 / paths.length));
      if (allocation <= 0) continue;
      result.push({ path, draw: allocation });
      remaining -= allocation;
    }
    return result;
  }
}

/**
 * Build a Financial Graph from a simulation scenario's world state.
 * Each reserve, LP, treasury, stablecoin, FO and wallet becomes a node;
 * every possible movement between them becomes a weighted edge.
 */
export function buildGraph(
  world: {
    reserves: { id: string; country: string; currency: CurrencyCode; available: number; minThreshold: number }[];
    liquidityProviders: import('./types').LiquidityProvider[];
    treasury: { stablecoinBalance: number; emergencyBalance: number };
    financialOperators: import('./types').FinancialOperator[];
    scenario: import('./types').SimulationScenario;
  },
): FinancialGraph {
  const g = new FinancialGraph();
  const s = world.scenario;
  const buyerCountry = s.transaction.buyer.country;
  const merchantCountry = s.transaction.merchant.country;
  const cur = s.transaction.merchant.currency;

  // --- Nodes ---
  g.addNode({ id: 'wallet:buyer', type: 'wallet', label: `${buyerCountry} Buyer`, country: buyerCountry, currency: s.transaction.buyer.currency, balance: s.transaction.amount, online: true, manualOnly: false });
  g.addNode({ id: 'wallet:merchant', type: 'wallet', label: `${merchantCountry} Merchant`, country: merchantCountry, currency: cur, balance: 0, online: true, manualOnly: false });

  for (const r of world.reserves) {
    g.addNode({ id: `reserve:${r.country}`, type: 'reserve', label: `Reserve ${r.country}`, country: r.country, currency: r.currency, balance: r.available, online: r.available > 0, manualOnly: false });
  }

  for (const lp of world.liquidityProviders) {
    g.addNode({
      id: `lp:${lp.id}`, type: 'lp', label: lp.name, country: lp.country, currency: lp.currency,
      balance: lp.tradingCapacity, sourceKind: lp.sourceKind, online: lp.online, manualOnly: lp.manualOnly,
    });
  }

  g.addNode({ id: 'treasury:stablecoin', type: 'stablecoin', label: 'Stablecoin Treasury', currency: cur, balance: world.treasury.stablecoinBalance, online: world.treasury.stablecoinBalance > 0, manualOnly: false });
  g.addNode({ id: 'treasury:emergency', type: 'treasury', label: 'Emergency Treasury', currency: cur, balance: world.treasury.emergencyBalance, online: world.treasury.emergencyBalance > 0, manualOnly: false });
  g.addNode({ id: 'insurance:pool', type: 'insurance_pool', label: 'Insurance Pool', currency: cur, balance: world.treasury.emergencyBalance * 0.5, online: true, manualOnly: false });

  for (const fo of world.financialOperators) {
    g.addNode({ id: `fo:${fo.id}`, type: 'fo', label: fo.name, country: fo.country, foType: fo.type, balance: fo.maxAmount, online: fo.online, manualOnly: false });
  }

  // --- Edges (weighted) ---
  const buyerFo = world.financialOperators.find((f) => f.id === s.transaction.buyer.foId) ?? world.financialOperators[0];
  const merchantFo = world.financialOperators.find((f) => f.id === s.transaction.merchant.foId) ?? world.financialOperators[1];

  // Buyer → FO → Reserve (origin)
  if (buyerFo) {
    g.addEdge(edge('wallet:buyer', `fo:${buyerFo.id}`, 'debit', buyerFo.feeBps, buyerFo.latencyMs, buyerFo.uptime, s.transaction.amount, 0.9, 0.95, 0.3, 0.2, 1));
    g.addEdge(edge(`fo:${buyerFo.id}`, `reserve:${buyerCountry}`, 'credit', 0, 2000, 0.99, s.transaction.amount, 0.95, 0.99, 0.1, 0.2, 1));
  }

  // Origin reserve → LPs (bridge liquidity)
  for (const lp of world.liquidityProviders.filter((l) => l.country === buyerCountry)) {
    g.addEdge(edge(`reserve:${buyerCountry}`, `lp:${lp.id}`, 'draw', lp.tradingFees * 100, lp.settlementSpeedMs, lp.historicalPerformance, lp.tradingCapacity, lp.aiReputation, 1 - lp.riskProfile, 0.2, lp.sourceKind === 'cooperative_pool' || lp.sourceKind === 'diaspora_pool' ? 0.9 : 0.3, 0.95));
  }

  // LPs → Treasury (LP can sell twin tokens to treasury)
  g.addEdge(edge(`lp:1`, 'treasury:stablecoin', 'bridge', 30, 5000, 0.99, world.treasury.stablecoinBalance, 0.95, 0.99, 0.1, 0.3, 1));
  g.addEdge(edge(`lp:2`, 'treasury:stablecoin', 'bridge', 30, 5000, 0.99, world.treasury.stablecoinBalance, 0.95, 0.99, 0.1, 0.3, 1));
  g.addEdge(edge(`lp:3`, 'treasury:stablecoin', 'bridge', 30, 5000, 0.99, world.treasury.stablecoinBalance, 0.95, 0.99, 0.1, 0.3, 1));

  // Treasury → Destination reserve (stablecoin bridge)
  g.addEdge(edge('treasury:stablecoin', `reserve:${merchantCountry}`, 'convert', 30, 5000, 0.99, world.treasury.stablecoinBalance, 0.95, 0.99, 0.1, 0.3, 1));

  // LPs → Destination reserve (LP bridge to destination)
  for (const lp of world.liquidityProviders.filter((l) => l.country === buyerCountry)) {
    g.addEdge(edge(`lp:${lp.id}`, `reserve:${merchantCountry}`, 'bridge', lp.tradingFees * 100, lp.settlementSpeedMs, lp.historicalPerformance, lp.tradingCapacity, lp.aiReputation, 1 - lp.riskProfile, 0.2, lp.sourceKind === 'cooperative_pool' || lp.sourceKind === 'diaspora_pool' ? 0.9 : 0.3, 0.95));
  }

  // Destination reserve → FO → Merchant
  if (merchantFo) {
    g.addEdge(edge(`reserve:${merchantCountry}`, `fo:${merchantFo.id}`, 'credit', merchantFo.feeBps, merchantFo.latencyMs, merchantFo.uptime, s.transaction.amount, 0.9, 0.95, 0.3, 0.2, 1));
    g.addEdge(edge(`fo:${merchantFo.id}`, 'wallet:merchant', 'credit', 0, 2000, 0.99, s.transaction.amount, 0.95, 0.99, 0.1, 0.2, 1));
  }

  // Twin token mint/burn edges (conceptual)
  g.addEdge(edge(`reserve:${buyerCountry}`, 'twin:mint', 'mint', 0, 1000, 1, s.transaction.amount, 1, 1, 0, 0.5, 1));
  g.addEdge(edge('twin:burn', `reserve:${merchantCountry}`, 'burn', 0, 1000, 1, s.transaction.amount, 1, 1, 0, 0.5, 1));

  // Insurance pool edges
  g.addEdge(edge('treasury:emergency', 'insurance:pool', 'credit', 0, 1000, 1, world.treasury.emergencyBalance * 0.5, 1, 1, 0, 0.5, 1));

  return g;
}

function edge(
  from: string, to: string, kind: GraphEdgeKind, cost: number, latencyMs: number,
  reliability: number, liquidity: number, trust: number, settlement: number,
  carbon: number, impact: number, compliance: number,
): GraphEdge {
  return { id: `${from}->${to}:${kind}`, from, to, kind, cost, latencyMs, reliability, liquidity, trust, settlement, carbon, impact, compliance };
}
