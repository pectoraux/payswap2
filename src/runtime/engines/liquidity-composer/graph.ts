/**
 * Liquidity Graph — builds the directed graph of currencies + LP offers.
 * (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * The graph is the substrate for pathfinding. Nodes are currencies; edges
 * are LP offers (or reserve-backed bridges). The graph is rebuilt on each
 * composition request (offers change over time).
 *
 * The graph is PURE: it never mutates state. It's a snapshot of the
 * current liquidity landscape, derived from the LP offers + reserves
 * passed to `buildGraph()`.
 */

import type { LiquidityEdge, LiquidityGraph, GraphNode, EdgeKind } from './types';

/** Input: a raw LP offer (before it's converted to a graph edge). */
export interface LPOfferInput {
  lpId: string;
  from: string;
  to: string;
  capacity: number;
  fxBps: number;
  feeBps: number;
  reserveOppCostBps: number;
  latencyMs: number;
  riskScore: number;
  failureProb: number;
}

/** Input: a reserve-backed bridge (e.g., TwinToken backed by a reserve). */
export interface ReserveBridgeInput {
  reserveId: string;
  from: string;
  to: string;
  capacity: number;
  fxBps: number;
  feeBps: number;
  reserveOppCostBps: number;
  latencyMs: number;
  riskScore: number;
  failureProb: number;
}

/** Inputs to buildGraph(): LP offers + reserve bridges. */
export interface GraphBuildInputs {
  offers: LPOfferInput[];
  bridges: ReserveBridgeInput[];
}

/** Currency labels for common currencies (fallback if not provided). */
const CURRENCY_LABELS: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  KES: 'Kenyan Shilling',
  GHS: 'Ghanaian Cedi',
  NGN: 'Nigerian Naira',
  ZAR: 'South African Rand',
  EGP: 'Egyptian Pound',
  TWINGHS: 'Twin Ghana Cedi',
  TWINKES: 'Twin Kenyan Shilling',
  USDC: 'USD Coin',
  USDT: 'Tether',
};

/**
 * Build a LiquidityGraph from LP offers + reserve bridges.
 *
 * Pure: same inputs → same graph. Deterministic edge ordering (sorted by
 * edge ID) so the pathfinder produces deterministic results.
 */
export function buildGraph(inputs: GraphBuildInputs): LiquidityGraph {
  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, LiquidityEdge[]>();

  // Helper: ensure a currency node exists.
  const ensureNode = (currency: string): void => {
    if (!nodes.has(currency)) {
      nodes.set(currency, {
        currency,
        label: CURRENCY_LABELS[currency] ?? currency,
      });
    }
    if (!adjacency.has(currency)) {
      adjacency.set(currency, []);
    }
  };

  // Add LP offer edges.
  for (const offer of inputs.offers) {
    ensureNode(offer.from);
    ensureNode(offer.to);
    const edge: LiquidityEdge = {
      id: `edge_lp_${offer.lpId}_${offer.from}_${offer.to}`,
      from: offer.from,
      to: offer.to,
      kind: 'convert' as EdgeKind,
      lpId: offer.lpId,
      capacity: offer.capacity,
      fxBps: offer.fxBps,
      feeBps: offer.feeBps,
      reserveOppCostBps: offer.reserveOppCostBps,
      latencyMs: offer.latencyMs,
      riskScore: offer.riskScore,
      failureProb: offer.failureProb,
    };
    adjacency.get(offer.from)!.push(edge);
  }

  // Add reserve bridge edges.
  for (const bridge of inputs.bridges) {
    ensureNode(bridge.from);
    ensureNode(bridge.to);
    const edge: LiquidityEdge = {
      id: `edge_reserve_${bridge.reserveId}_${bridge.from}_${bridge.to}`,
      from: bridge.from,
      to: bridge.to,
      kind: 'bridge' as EdgeKind,
      lpId: null,
      capacity: bridge.capacity,
      fxBps: bridge.fxBps,
      feeBps: bridge.feeBps,
      reserveOppCostBps: bridge.reserveOppCostBps,
      latencyMs: bridge.latencyMs,
      riskScore: bridge.riskScore,
      failureProb: bridge.failureProb,
    };
    adjacency.get(bridge.from)!.push(edge);
  }

  // Sort adjacency lists by edge ID for deterministic pathfinding.
  for (const edges of adjacency.values()) {
    edges.sort((a, b) => a.id.localeCompare(b.id));
  }

  return { nodes, adjacency };
}

/** Get the outgoing edges from a currency node. */
export function outgoingEdges(graph: LiquidityGraph, currency: string): LiquidityEdge[] {
  return graph.adjacency.get(currency) ?? [];
}

/** List all currencies in the graph. */
export function allCurrencies(graph: LiquidityGraph): string[] {
  return [...graph.nodes.keys()].sort();
}

/** Count edges in the graph. */
export function edgeCount(graph: LiquidityGraph): number {
  let count = 0;
  for (const edges of graph.adjacency.values()) count += edges.length;
  return count;
}
