/**
 * Economic Operating System — Settlement Kernel.
 *
 * Executes a compiled CompositionGraph in topological order. Each node invokes
 * its actor's capability (simulated), produces its assets, consumes its inputs,
 * and records P&L: the actor earns revenue (its pricePerInvocation) and pays
 * costs to upstream actors. The settlement is atomic — if any required node
 * fails, the graph is marked failed (but opportunistic nodes are best-effort).
 *
 * After settlement, every actor in the graph has updated P&L, treasury, and
 * invocation counters. This is what makes the "internal economy" observable:
 * actors trade with each other through the compiler, and the kernel settles
 * the trades.
 */

import { uid } from '@/runtime/types';
import { eosStore, touchHolding } from './store';
import type {
  CompositionGraph, SettlementExecution, SettlementStep,
  EconomicActor,
} from './types';

/**
 * Execute a compiled graph. Returns the settlement execution trace.
 * Mutates the in-memory store: updates actor P&L, treasury, holdings.
 */
export function settleGraph(graph: CompositionGraph): SettlementExecution {
  const startedAt = Date.now();
  const steps: SettlementStep[] = [];
  const executionOrder = topologicalSort(graph);

  let totalRevenue = 0;
  let totalCost = 0;
  let failed = false;

  for (const nodeId of executionOrder) {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    // Skip input + output nodes (they're structural)
    if (node.kind === 'INPUT') {
      steps.push({
        nodeId, status: 'SUCCESS',
        producedAssets: node.produces, consumedAssets: [],
        revenue: 0, cost: 0,
        detail: `User provided ${node.produces.length} input asset(s)`,
        ts: Date.now(),
      });
      continue;
    }
    if (node.kind === 'OUTPUT') {
      steps.push({
        nodeId, status: 'SUCCESS',
        producedAssets: node.produces, consumedAssets: node.consumes,
        revenue: 0, cost: 0,
        detail: `Intent goal satisfied: ${node.consumes.map((c) => c.assetId).join(', ')}`,
        ts: Date.now(),
      });
      continue;
    }

    // ACTOR or OPPORTUNISTIC node — invoke the capability
    const actor = node.actorId ? eosStore.actors.get(node.actorId) : undefined;
    if (!actor) {
      steps.push({
        nodeId, actorId: node.actorId, actorName: node.actorName,
        status: 'FAILED',
        producedAssets: [], consumedAssets: node.consumes,
        revenue: 0, cost: 0,
        detail: 'Actor not found',
        ts: Date.now(),
      });
      if (node.kind === 'ACTOR') failed = true;
      continue;
    }

    // Simulate the capability invocation
    // Revenue: the actor charges its price (node.cost)
    // Cost: the actor pays upstream actors (sum of upstream node costs weighted by 0.4 — margin)
    const revenue = node.cost;
    const upstreamCost = computeUpstreamCost(graph, node.id) * 0.4; // 40% of upstream = this actor's input cost
    const profit = revenue - upstreamCost;

    // Update actor P&L
    actor.revenue += revenue;
    actor.costs += upstreamCost;
    actor.profit = actor.revenue - actor.costs;
    actor.invocations++;
    actor.successfulInvocations++;
    actor.treasury['currency.usd'] = (actor.treasury['currency.usd'] ?? 0) + revenue - upstreamCost;

    // Produce the assets (credit them to the actor's treasury + intent recipient)
    for (const ab of node.produces) {
      touchHolding(ab.assetId, actor.id, 'ACTOR', actor.name, ab.amount);
      // Also credit the "intent recipient" (customer) for user-facing assets
      const asset = eosStore.assets.get(ab.assetId);
      if (asset && (asset.type === 'CREDENTIAL' || asset.type === 'RIGHT' || asset.type === 'RECEIPT' || asset.type === 'EVIDENCE' || asset.type === 'REPUTATION')) {
        touchHolding(ab.assetId, 'cust_intent', 'CUSTOMER', 'Intent Customer', ab.amount);
      }
      if (asset) {
        asset.totalSupply += ab.amount;
        asset.holderCount = countHolders(ab.assetId);
      }
    }

    // Consume the inputs (debit from holders)
    for (const ab of node.consumes) {
      // find the producing node's actor and debit them
      const producerNode = findProducerNode(graph, ab.assetId, node.id);
      if (producerNode?.actorId) {
        const producer = eosStore.actors.get(producerNode.actorId);
        if (producer) {
          // the producer already "sent" the asset — for consumable assets, decrement
          const asset = eosStore.assets.get(ab.assetId);
          if (asset?.consumable) {
            touchHolding(ab.assetId, producer.id, 'ACTOR', producer.name, -ab.amount, ab.amount);
            asset.totalSupply -= ab.amount;
          }
        }
      }
    }

    totalRevenue += revenue;
    totalCost += upstreamCost;

    steps.push({
      nodeId,
      actorId: actor.id,
      actorName: actor.name,
      capability: node.capability,
      status: 'SUCCESS',
      producedAssets: node.produces,
      consumedAssets: node.consumes,
      revenue,
      cost: upstreamCost,
      detail: `${node.capability} → produced ${node.produces.map((p) => p.assetId).join(', ') || 'side-effect'} · charged $${revenue.toFixed(4)} · paid $${upstreamCost.toFixed(4)} upstream · profit $${profit.toFixed(4)}`,
      ts: Date.now(),
    });

    // mark node completed
    node.status = 'completed';
  }

  const completedAt = Date.now();
  graph.status = failed ? 'failed' : 'settled';

  return {
    id: uid('eoss'),
    graphId: graph.id,
    intentId: graph.intentId,
    intentName: graph.intentName,
    steps,
    status: failed ? 'FAILED' : 'SETTLED',
    totalRevenue,
    totalCost,
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
  };
}

/** Topological sort of graph nodes by edges (producer → consumer). */
function topologicalSort(graph: CompositionGraph): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) if (deg === 0) queue.push(id);
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  // Any nodes not in result (cycles) — append them
  for (const n of graph.nodes) if (!result.includes(n.id)) result.push(n.id);
  return result;
}

function computeUpstreamCost(graph: CompositionGraph, nodeId: string): number {
  let cost = 0;
  for (const e of graph.edges) {
    if (e.to === nodeId) {
      const producer = graph.nodes.find((n) => n.id === e.from);
      if (producer) cost += producer.cost;
    }
  }
  return cost;
}

function findProducerNode(graph: CompositionGraph, assetId: string, consumerNodeId: string): CompositionGraph['nodes'][number] | undefined {
  for (const e of graph.edges) {
    if (e.to === consumerNodeId && e.assetId === assetId) {
      return graph.nodes.find((n) => n.id === e.from);
    }
  }
  return undefined;
}

function countHolders(assetId: string): number {
  let n = 0;
  for (const h of eosStore.holdings.values()) if (h.assetId === assetId && h.balance > 0) n++;
  return n;
}
