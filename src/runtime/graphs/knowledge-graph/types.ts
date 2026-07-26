/**
 * Financial Knowledge Graph — the root graph. (v1.4 §7Q.)
 *
 * Five graphs exist (Capability, Route, Liquidity, Resource, Economic), but
 * relationships span them. The Financial Knowledge Graph is the single root
 * with multiple projections — one API, cross-graph queries.
 *
 * It is the single source of truth the Financial Compiler reads at compile
 * time. All five projections are views over it; cross-graph queries power
 * Opportunity Discovery, LP/Treasury Growth, and Counterfactual evaluation.
 *
 * M-RT-1 ships types + a no-op interface. Later milestones wire the real
 * projections + cross-graph traversal.
 */

import type { EvidenceCitation } from '../../types';
import type { CapabilityGraph } from '../capability/types';
import type { RouteGraph } from '../route/types';
import type { LiquidityGraphQuery } from '../liquidity-graph/types';

// Resource + Economic graph query types are referenced abstractly here to
// avoid hard dependencies that don't exist yet as standalone modules.
// They will be formalized in M-RT-14 (Full Inspector + Three Graphs).
export interface ResourceGraphQuery {
  businessTree(rootId: string): { nodes: unknown[]; edges: unknown[] };
}
export interface EconomicGraphQuery {
  moneyFlow(rootId: string): { nodes: unknown[]; edges: unknown[] };
}

export type GraphProjection =
  | 'capability'
  | 'route'
  | 'liquidity'
  | 'resource'
  | 'economic'
  | 'opportunity';

export interface KnowledgeQuery {
  subject: string;                 // "lp:Acacia"
  relationships: string[];         // ['supports', 'owns', 'connects', 'serves']
  traverse: GraphProjection[];     // ['capability', 'reserve', 'economic', 'route', 'opportunity']
  filter?: Record<string, unknown>;
}

export interface KnowledgeNode {
  id: string;
  type: string;
  label: string;
  projection: GraphProjection;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  relationship: string;
  weight?: number;
}

export interface DerivedFact {
  claim: string;
  evidence: EvidenceCitation[];
  confidence: number;
}

export interface KnowledgeQueryResult {
  subject: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  derivedFacts: DerivedFact[];
}

/**
 * The Financial Knowledge Graph — the single root over all five graphs.
 */
export interface FinancialKnowledgeGraph {
  // The five projections (each is a view over the same underlying graph):
  capability(): CapabilityGraph;
  route(): RouteGraph;
  liquidity(): LiquidityGraphQuery;
  resource(): ResourceGraphQuery;
  economic(): EconomicGraphQuery;

  // Cross-graph queries no individual graph can answer:
  query(q: KnowledgeQuery): Promise<KnowledgeQueryResult>;

  // "Which LPs could become profitable if Treasury opened an XOF reserve?"
  //   → traverses Capability → Reserve → Economic → Route → Opportunity
  whatIf(opensReserve: string): Promise<{ lpId: string; projectedProfitability: number }[]>;
}

/**
 * NoOpFinancialKnowledgeGraph — the M-RT-1 placeholder. Returns empty
 * projections + empty query results. Later milestones wire the real root
 * graph with cross-graph traversal.
 */
export class NoOpFinancialKnowledgeGraph implements FinancialKnowledgeGraph {
  capability(): CapabilityGraph {
    // Returns a no-op CapabilityGraph shell; real projection wired later.
    return new (class implements CapabilityGraph {
      publish(): void {}
      withdraw(): void {}
      forLP(): import('../capability/types').LPCapability[] { return []; }
      canMove(): import('../capability/types').LPCapability[] { return []; }
      all(): import('../capability/types').LPCapability[] { return []; }
    })();
  }

  route(): RouteGraph {
    return new (class implements RouteGraph {
      async regenerate(): Promise<void> {}
      direct(): import('../route/types').Route[] { return []; }
      multiHop(): import('../route/types').Route[] { return []; }
      all(): import('../route/types').Route[] { return []; }
    })();
  }

  liquidity(): LiquidityGraphQuery {
    // Minimal no-op shell matching the LiquidityGraphQuery contract exactly.
    const noop: LiquidityGraphQuery = {
      async paths(): Promise<import('../liquidity-graph/types').LiquidityPath[]> { return []; },
      async corridor(): Promise<{ nodes: import('../liquidity-graph/types').LiquidityNode[]; edges: import('../liquidity-graph/types').LiquidityEdge[] }> { return { nodes: [], edges: [] }; },
      async concentration(): Promise<import('../liquidity-graph/types').ConcentrationReport> {
        return { subject: '', topShare: 0, hhi: 0, isConcentrated: false };
      },
    };
    return noop;
  }

  resource(): ResourceGraphQuery {
    return { businessTree: () => ({ nodes: [], edges: [] }) };
  }

  economic(): EconomicGraphQuery {
    return { moneyFlow: () => ({ nodes: [], edges: [] }) };
  }

  async query(q: KnowledgeQuery): Promise<KnowledgeQueryResult> {
    return { subject: q.subject, nodes: [], edges: [], derivedFacts: [] };
  }

  async whatIf(_opensReserve: string): Promise<{ lpId: string; projectedProfitability: number }[]> {
    return [];
  }
}
