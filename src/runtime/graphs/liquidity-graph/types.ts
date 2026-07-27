/**
 * Liquidity Graph — the third graph. (Amendment 1 §16.)
 *
 * Nodes: LPs, corridors, currencies, twin currencies, reserves, connectors.
 * Edges carry capacity, cost, risk, latency, confidence, profitability,
 * availability. Opportunity Discovery operates on this graph.
 *
 * Distinct from the kernel's `financial-graph.ts` (the optimizer's in-memory
 * traversal) and from the Runtime's Resource + Economic graphs. M-RT-1 ships
 * types + an in-memory graph; M-RT-9 adds the projection that rebuilds it
 * from Domain Events.
 */

export type LiquidityNodeType =
  | 'lp'
  | 'corridor'
  | 'currency'
  | 'twin_currency'
  | 'reserve'
  | 'connector';

export interface LiquidityNode {
  id: string;
  type: LiquidityNodeType;
  label: string;
  meta?: Record<string, unknown>;
}

export interface LiquidityEdge {
  from: string;
  to: string;
  capacity: number;
  costBps: number;
  risk: number;          // 0..1
  latencyMs: number;
  confidence: number;    // 0..1
  profitabilityBps: number;
  availability: number;  // 0..1
}

export interface LiquidityPath {
  hops: LiquidityEdge[];
  totalCostBps: number;
  totalLatencyMs: number;
  weightedScore: number;   // per the 9-dimension objective
}

export interface ConcentrationReport {
  subject: string;
  topShare: number;        // e.g. 0.9 = 90% through one LP
  hhi: number;             // Herfindahl-Hirschman Index
  isConcentrated: boolean;
}

/** Query surface for the Liquidity Graph. */
export interface LiquidityGraphQuery {
  /** All paths between two currencies, ranked by the objective. */
  paths(from: string, to: string, amount: number): Promise<LiquidityPath[]>;
  /** Subgraph for a corridor (for the Inspector). */
  corridor(corridorId: string): Promise<{ nodes: LiquidityNode[]; edges: LiquidityEdge[] }>;
  /** Concentration check (for Liquidity Intelligence). */
  concentration(subject: string): Promise<ConcentrationReport>;
}

/** A mutable in-memory Liquidity Graph (M-RT-1). */
export class InMemoryLiquidityGraph implements LiquidityGraphQuery {
  private nodesById: Map<string, LiquidityNode> = new Map();
  private edgesByKey: Map<string, LiquidityEdge> = new Map();

  addNode(node: LiquidityNode): void {
    this.nodesById.set(node.id, node);
  }

  addEdge(edge: LiquidityEdge): void {
    this.edgesByKey.set(`${edge.from}->${edge.to}`, edge);
  }

  get edgesList(): LiquidityEdge[] {
    return [...this.edgesByKey.values()];
  }

  get nodesList(): LiquidityNode[] {
    return [...this.nodesById.values()];
  }

  async paths(from: string, to: string): Promise<LiquidityPath[]> {
    // M-RT-1: trivial direct-edge lookup. M-RT-9 implements full multi-hop DFS.
    const direct = this.edgesByKey.get(`${from}->${to}`);
    if (!direct) return [];
    return [{
      hops: [direct],
      totalCostBps: direct.costBps,
      totalLatencyMs: direct.latencyMs,
      weightedScore: direct.costBps,
    }];
  }

  async corridor(corridorId: string): Promise<{ nodes: LiquidityNode[]; edges: LiquidityEdge[] }> {
    const nodes = this.nodesList.filter((n) => n.id.includes(corridorId));
    const edges = this.edgesList.filter((e) => e.from.includes(corridorId) || e.to.includes(corridorId));
    return { nodes, edges };
  }

  async concentration(subject: string): Promise<ConcentrationReport> {
    // M-RT-1 stub. M-RT-9 computes HHI from settlement volume.
    return { subject, topShare: 0, hhi: 0, isConcentrated: false };
  }
}
