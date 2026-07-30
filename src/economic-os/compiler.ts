/**
 * Economic Operating System — Intent Compiler.
 *
 * THE HEART. Takes an Intent (a goal the user expresses) and discovers a
 * composition DAG by walking the Produces/Consumes contracts across actors.
 * No pipeline is written — the compiler discovers it.
 *
 * Algorithm: backward-chaining planner.
 *   1. Start from the Intent's goal asset (what must be produced).
 *   2. Find all capabilities (across all actors) that produce that asset.
 *   3. For each candidate, score it via the Economic Optimizer (cost, latency,
 *      trust, reputation, treasury health, regulatory, geography).
 *   4. Pick the best; add it to the DAG.
 *   5. For each asset that capability consumes, recurse (find producers).
 *   6. If a consumed asset matches an Intent input, bind it (leaf).
 *   7. If no capability produces a consumed asset and it's not an input, fail.
 *   8. After the main path is built, scan for OPPORTUNISTIC actors — actors
 *      that consume any produced asset and produce valuable side-effects
 *      (carbon offset, tax receipt, compliance evidence, rewards). Attach them.
 *   9. Run the Policy Engine over the full DAG; record violations.
 *  10. Return the CompositionGraph.
 *
 * Guarded against cycles (visited set) and depth limits (MAX_DEPTH=12).
 */

import { uid } from '@/runtime/types';
import { eosStore } from './store';
import { scoreProvider, checkPolicies } from './optimizer';
import type {
  Intent, CompositionGraph, CompositionNode, CompositionEdge,
  AssetBinding, CapabilityAdvertisement, PolicyViolation,
  EconomicActor, CompositionNodeKind,
} from './types';

const MAX_DEPTH = 12;

/**
 * Compile an intent into a composition DAG. Returns the graph + any policy
 * violations. The graph is in 'compiled' status — call the settlement kernel
 * to execute it.
 */
export function compileIntent(intent: Intent): CompositionGraph {
  const nodes: CompositionNode[] = [];
  const edges: CompositionEdge[] = [];
  const producedAssets = new Set<string>(); // asset ids that will exist after the DAG runs
  const visited = new Set<string>();        // (capabilityId) — cycle guard
  const nodeByCapability = new Map<string, string>(); // capabilityAdId → nodeId

  // Input nodes (assets the user brings)
  const inputNode: CompositionNode = {
    id: uid('eosn'),
    kind: 'INPUT',
    produces: intent.inputs,
    consumes: [],
    cost: 0, latencyMs: 0, trustScore: 100,
    status: 'completed',
    reasoning: 'User-provided inputs',
  };
  nodes.push(inputNode);
  for (const inp of intent.inputs) producedAssets.add(inp.assetId);

  // Backward-chain from the goal
  const goalNode = resolveAsset(intent.goal, 1, intent, producedAssets, nodes, edges, visited, nodeByCapability, new Set());
  if (!goalNode) {
    return {
      id: uid('eosg'), intentId: intent.id, intentName: intent.name,
      nodes, edges,
      totalCost: 0, totalLatencyMs: 0, trustScore: 0,
      actorCount: 0, opportunisticCount: 0,
      status: 'failed',
      compiledAt: Date.now(),
    };
  }

  // Output node (the goal)
  const outputNode: CompositionNode = {
    id: uid('eosn'),
    kind: 'OUTPUT',
    produces: [{ assetId: intent.goal, amount: 1 }],
    consumes: [{ assetId: intent.goal, amount: 1 }],
    cost: 0, latencyMs: 0, trustScore: 100,
    status: 'pending',
    reasoning: `Intent goal: ${intent.goal}`,
  };
  // edge from goal-producing node to output
  edges.push({ from: goalNode.id, to: outputNode.id, assetId: intent.goal, amount: 1 });
  nodes.push(outputNode);

  // Opportunistic actors — actors that consume any produced asset and produce
  // valuable side-effects. These attach to the main path without being required.
  const opportunistic = discoverOpportunistic(producedAssets, intent);
  for (const opp of opportunistic) {
    const oppNode: CompositionNode = {
      id: uid('eosn'),
      kind: 'OPPORTUNISTIC',
      actorId: opp.capability.actorId,
      actorName: eosStore.actors.get(opp.capability.actorId)?.name ?? opp.capability.actorId,
      capability: opp.capability.name,
      capabilityAdId: opp.capability.id,
      produces: opp.capability.produces.map((a) => ({ assetId: a, amount: 1 })),
      consumes: opp.capability.consumes.filter((c) => producedAssets.has(c)).map((a) => ({ assetId: a, amount: 1 })),
      cost: opp.capability.pricePerInvocation,
      latencyMs: opp.capability.latencyMs,
      trustScore: opp.capability.trustScore,
      status: 'selected',
      reasoning: `Opportunistic: reacts to ${opp.triggerAsset} to produce ${opp.capability.produces.join(', ')}`,
    };
    nodes.push(oppNode);
    for (const c of opp.capability.consumes) {
      if (producedAssets.has(c)) {
        // find the node that produces c
        const producer = nodes.find((n) => n.produces.some((p) => p.assetId === c));
        if (producer) edges.push({ from: producer.id, to: oppNode.id, assetId: c, amount: 1 });
      }
    }
    for (const p of opp.capability.produces) producedAssets.add(p);
  }

  // Policy engine — check all selected actors
  const selectedActorIds = new Set<string>();
  for (const n of nodes) if (n.actorId) selectedActorIds.add(n.actorId);
  const violations: PolicyViolation[] = [];
  for (const actorId of selectedActorIds) {
    const actor = eosStore.actors.get(actorId);
    if (!actor) continue;
    violations.push(...checkPolicies(actor, intent));
  }

  // Aggregate
  const actorNodes = nodes.filter((n) => n.kind === 'ACTOR' || n.kind === 'OPPORTUNISTIC');
  const totalCost = actorNodes.reduce((s, n) => s + n.cost, 0);
  const totalLatencyMs = actorNodes.reduce((s, n) => s + n.latencyMs, 0);
  const trustScore = actorNodes.length ? Math.round(actorNodes.reduce((s, n) => s + n.trustScore, 0) / actorNodes.length) : 100;

  // Mark policy-blocked if any BLOCK violations
  const hasBlock = violations.some((v) => v.severity === 'BLOCK');

  return {
    id: uid('eosg'),
    intentId: intent.id,
    intentName: intent.name,
    nodes,
    edges,
    totalCost,
    totalLatencyMs,
    trustScore,
    actorCount: selectedActorIds.size,
    opportunisticCount: opportunistic.length,
    status: hasBlock ? 'policy_blocked' : 'compiled',
    policyViolations: violations.length ? violations : undefined,
    compiledAt: Date.now(),
  };
}

/**
 * Recursively resolve an asset by finding the best capability that produces it.
 * Returns the node that produces the asset, or null if unresolvable.
 */
function resolveAsset(
  assetId: string,
  depth: number,
  intent: Intent,
  producedAssets: Set<string>,
  nodes: CompositionNode[],
  edges: CompositionEdge[],
  visited: Set<string>,
  nodeByCapability: Map<string, string>,
  resolving: Set<string>,
): CompositionNode | null {
  if (depth > MAX_DEPTH) return null;
  if (resolving.has(assetId)) return null; // cycle guard
  resolving.add(assetId);

  // If the asset is already produced by a node we've placed, return it
  const existing = nodes.find((n) => n.produces.some((p) => p.assetId === assetId));
  if (existing) {
    resolving.delete(assetId);
    return existing;
  }

  // Find all capabilities that produce this asset
  const candidates = Array.from(eosStore.capabilities.values()).filter((c) => c.produces.includes(assetId));
  if (candidates.length === 0) {
    resolving.delete(assetId);
    return null; // unresolvable
  }

  // Score each candidate via the optimizer; pick the best
  const scored = candidates.map((c) => {
    const s = scoreProvider(c, intent);
    return { capability: c, score: s.score, reasoning: s.reasoning, reason: s.reason };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) {
    resolving.delete(assetId);
    return null;
  }

  // Cycle guard on capability
  let chosen = best;
  if (visited.has(best.capability.id)) {
    const alt = scored.find((s) => !visited.has(s.capability.id));
    if (!alt) { resolving.delete(assetId); return null; }
    chosen = alt;
  }
  visited.add(chosen.capability.id);

  const actor = eosStore.actors.get(chosen.capability.actorId);
  const node: CompositionNode = {
    id: uid('eosn'),
    kind: 'ACTOR',
    actorId: chosen.capability.actorId,
    actorName: actor?.name ?? chosen.capability.actorId,
    capability: chosen.capability.name,
    capabilityAdId: chosen.capability.id,
    produces: chosen.capability.produces.map((a) => ({ assetId: a, amount: 1 })),
    consumes: chosen.capability.consumes.map((a) => ({ assetId: a, amount: 1 })),
    cost: chosen.capability.pricePerInvocation,
    latencyMs: chosen.capability.latencyMs,
    trustScore: chosen.capability.trustScore,
    status: 'selected',
    reasoning: chosen.reasoning,
    alternatives: scored.filter((s) => s.capability.id !== chosen.capability.id).slice(0, 3).map((s) => ({
      actorId: s.capability.actorId,
      actorName: eosStore.actors.get(s.capability.actorId)?.name ?? s.capability.actorId,
      cost: s.capability.pricePerInvocation,
      latencyMs: s.capability.latencyMs,
      trustScore: s.capability.trustScore,
      reason: s.reason,
    })),
  };
  nodes.push(node);
  nodeByCapability.set(chosen.capability.id, node.id);
  for (const p of chosen.capability.produces) producedAssets.add(p);

  // Recursively resolve each consumed asset
  for (const consumed of chosen.capability.consumes) {
    // Check if it's an input
    const isInput = intent.inputs.some((i) => i.assetId === consumed);
    if (isInput) {
      edges.push({ from: nodes[0].id, to: node.id, assetId: consumed, amount: 1 }); // from input node
      continue;
    }
    // Check if already produced
    if (producedAssets.has(consumed)) {
      const producer = nodes.find((n) => n.produces.some((p) => p.assetId === consumed));
      if (producer) edges.push({ from: producer.id, to: node.id, assetId: consumed, amount: 1 });
      continue;
    }
    // Recurse
    const producer = resolveAsset(consumed, depth + 1, intent, producedAssets, nodes, edges, visited, nodeByCapability, resolving);
    if (producer) {
      edges.push({ from: producer.id, to: node.id, assetId: consumed, amount: 1 });
    }
    // if null, the consumed asset is unresolvable — the node will fail at settlement
  }

  resolving.delete(assetId);
  return node;
}

interface ScoredCapability { capability: CapabilityAdvertisement; score: number; reasoning: string; reason: string; }

/**
 * Discover opportunistic actors — actors that consume any produced asset and
 * produce a desired output (or any valuable side-effect). These are NOT on the
 * critical path but add value (carbon offset, rewards, tax evidence, etc.).
 */
function discoverOpportensive(producedAssets: Set<string>, intent: Intent): Array<{ capability: CapabilityAdvertisement; triggerAsset: string }> {
  const result: Array<{ capability: CapabilityAdvertisement; triggerAsset: string }> = [];
  const desired = new Set(intent.desiredOutputs ?? []);
  const usedCapabilities = new Set<string>();

  for (const assetId of producedAssets) {
    // Find capabilities that consume this asset
    const reactive = Array.from(eosStore.capabilities.values()).filter(
      (c) => c.consumes.includes(assetId) && !usedCapabilities.has(c.id),
    );
    for (const cap of reactive) {
      // Include if it produces a desired output, OR if it's a known valuable side-effect
      const produces = cap.produces.some((p) => desired.has(p));
      const valuableSideEffect = cap.produces.some((p) =>
        p === 'carbon.offset' || p === 'reward.points' || p === 'evidence.tax' ||
        p === 'evidence.compliance' || p === 'reputation.seller' || p === 'reputation.borrower' ||
        p === 'evidence.kyc');
      if (produces || valuableSideEffect) {
        result.push({ capability: cap, triggerAsset: assetId });
        usedCapabilities.add(cap.id);
      }
    }
  }
  return result;
}

// fix the function name typo in the call site + export
function discoverOpportunistic(producedAssets: Set<string>, intent: Intent): Array<{ capability: CapabilityAdvertisement; triggerAsset: string }> {
  return discoverOpportensive(producedAssets, intent);
}
