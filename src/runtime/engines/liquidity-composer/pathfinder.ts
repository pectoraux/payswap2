/**
 * Pathfinder — bounded depth-first search through the liquidity graph.
 * (M-RT-16, Multi-hop Liquidity Composition.)
 *
 * Generates ALL candidate paths from `source` to `destination` with:
 *   - Max 4 hops (configurable)
 *   - No cycles (a currency is visited at most once per path)
 *   - Deterministic ordering (sorted by edge IDs, then by path cost)
 *
 * The pathfinder is PURE: same graph + request → same paths. It never
 * mutates the graph. It returns paths sorted by (hops, totalCostBps, id)
 * so the optimizer receives a deterministic candidate list.
 */

import type { LiquidityEdge, LiquidityGraph, LiquidityPath } from './types';
import { outgoingEdges } from './graph';

/** Default max hops (per the M-RT-16 spec). */
export const DEFAULT_MAX_HOPS = 4;

/**
 * Find all candidate paths from `from` to `to` in the graph.
 *
 * Bounded DFS: explores up to `maxHops` edges deep, never revisiting a
 * currency (no cycles). Returns paths sorted by (hops, totalCostBps, id)
 * for deterministic ordering.
 */
export function findPaths(
  graph: LiquidityGraph,
  from: string,
  to: string,
  maxHops: number = DEFAULT_MAX_HOPS,
): LiquidityPath[] {
  const paths: LiquidityPath[] = [];
  const visited = new Set<string>([from]);

  // DFS: explore all edges from the current currency.
  const dfs = (current: string, edges: LiquidityEdge[]): void => {
    if (current === to) {
      if (edges.length > 0) {
        paths.push(buildPath(from, to, edges));
      }
      return;
    }
    if (edges.length >= maxHops) return;

    for (const edge of outgoingEdges(graph, current)) {
      // No cycles: skip if the destination currency was already visited.
      if (visited.has(edge.to)) continue;
      // Skip zero-capacity edges.
      if (edge.capacity <= 0) continue;

      visited.add(edge.to);
      edges.push(edge);
      dfs(edge.to, edges);
      edges.pop();
      visited.delete(edge.to);
    }
  };

  dfs(from, []);

  // Sort by (hops, totalCostBps, id) for deterministic ordering.
  paths.sort((a, b) => {
    if (a.hops !== b.hops) return a.hops - b.hops;
    if (a.totalCostBps !== b.totalCostBps) return a.totalCostBps - b.totalCostBps;
    return a.id.localeCompare(b.id);
  });

  return paths;
}

/**
 * Build a LiquidityPath from an ordered list of edges.
 *
 * Computes: hops, minCapacity, totalCostBps, totalLatencyMs, compoundedRisk,
 * failureProb. The path ID is a deterministic hash of edge IDs.
 */
export function buildPath(from: string, to: string, edges: LiquidityEdge[]): LiquidityPath {
  if (edges.length === 0) {
    throw new Error('Cannot build a path with zero edges');
  }

  // hops = number of edges.
  const hops = edges.length;

  // minCapacity = bottleneck (min of edge capacities).
  const minCapacity = Math.min(...edges.map((e) => e.capacity));

  // totalCostBps = compounded FX + summed fees.
  // FX compounds: (1 + fxBps1/10000) * (1 + fxBps2/10000) * ... → total FX bps.
  let fxMultiplier = 1;
  let feeBps = 0;
  let reserveOppCostBps = 0;
  for (const edge of edges) {
    fxMultiplier *= 1 + edge.fxBps / 10_000;
    feeBps += edge.feeBps;
    reserveOppCostBps += edge.reserveOppCostBps;
  }
  const fxBps = (fxMultiplier - 1) * 10_000;
  const totalCostBps = fxBps + feeBps + reserveOppCostBps;

  // totalLatencyMs = sum of edge latencies (sequential hops).
  const totalLatencyMs = edges.reduce((s, e) => s + e.latencyMs, 0);

  // compoundedRisk = 1 - product of (1 - edge.riskScore).
  // (Risk compounds: each hop adds its own counterparty + settlement risk.)
  let reliability = 1;
  for (const edge of edges) {
    reliability *= 1 - edge.riskScore;
  }
  const compoundedRisk = 1 - reliability;

  // failureProb = 1 - product of (1 - edge.failureProb).
  // (The path fails if ANY hop fails — parallel reliability.)
  let successProb = 1;
  for (const edge of edges) {
    successProb *= 1 - edge.failureProb;
  }
  const failureProb = 1 - successProb;

  // Deterministic path ID: hash of edge IDs.
  const id = `path_${edges.map((e) => e.id).join('_')}`;

  return {
    id,
    from,
    to,
    edges,
    hops,
    minCapacity,
    totalCostBps,
    totalLatencyMs,
    compoundedRisk,
    failureProb,
  };
}
