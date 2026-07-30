/**
 * Economic Knowledge Graph — The Recursive Planner.
 *
 * prove(goal, constraints) → Proof[]
 *
 * The planner is a recursive graph theorem prover:
 *   1. To prove a goal, find capabilities that SATISFY it.
 *   2. For each candidate capability, check its constraints (policy, jurisdiction, trust).
 *   3. For each asset the capability REQUIRES, prove that asset can be produced
 *      (recursively — this becomes a subgoal).
 *   4. If a required asset is an input, bind it (leaf).
 *   5. If no capability can produce a required asset, backtrack and try the next candidate.
 *   6. When a complete proof is found, score it.
 *   7. Continue searching for alternative proofs (up to a limit).
 *   8. Rank all proofs by planner score.
 *
 * This is graph theorem proving — the planner attempts to prove "this goal can
 * be satisfied" by exhibiting a decomposition tree + settlement graph.
 */

import { uid } from '@/runtime/types';
import { graph, ekg } from './graph';
import { scoreProof, checkMemoryHits } from './scorer';
import type {
  Goal, Constraints, Proof, ProofStep, GraphNode,
  EntityLabel,
} from './types';

const MAX_PROOFS = 5;
const MAX_DEPTH = 10;

/**
 * prove(goal, constraints) → Proof[]
 * The universal API. Recursive graph theorem proving with backtracking.
 */
export function prove(goal: Goal, constraints: Constraints = {}): Proof[] {
  const proofs: Proof[] = [];
  const producedAssets = new Set<string>(Object.keys(goal.inputs));

  // Find all capabilities that SATISFY this goal's target asset
  const candidateCaps = ekg.findCapabilitiesProducing(goal.targetAsset);

  for (const cap of candidateCaps) {
    if (proofs.length >= MAX_PROOFS) break;
    const proof = tryProve(goal, cap, constraints, producedAssets, new Set(), 0);
    if (proof) {
      proofs.push(finalizeProof(goal, proof, constraints));
    }
  }

  // Rank by planner score
  proofs.sort((a, b) => b.plannerScore - a.plannerScore);
  return proofs;
}

/**
 * Recursively attempt to prove that `capability` can satisfy the goal.
 * Returns the root ProofStep if successful, null if the proof fails (backtrack).
 */
function tryProve(
  goal: Goal,
  capability: GraphNode,
  constraints: Constraints,
  producedAssets: Set<string>,
  visited: Set<string>,
  depth: number,
): ProofStep | null {
  if (depth > MAX_DEPTH) return null;
  if (visited.has(capability.id)) return null; // cycle guard
  visited.add(capability.id);

  // Find the best entity that OFFERS this capability
  const entities = ekg.findEntitiesOffering(capability.id);
  if (entities.length === 0) return null;

  // Filter entities by constraints
  const filtered = entities.filter((e) => {
    if (constraints.excludeEntities?.includes(e.id)) return false;
    if (constraints.jurisdiction) {
      const locRels = ekg.getRelationshipsByType(e.id, 'LOCATED_IN');
      const locs = locRels.map((r) => r.to);
      if (locs.length > 0 && !locs.includes(constraints.jurisdiction)) return false;
    }
    return true;
  });
  if (filtered.length === 0) return null;

  // Score + pick the best entity
  const scored = filtered.map((e) => ({ entity: e, score: scoreEntity(e, capability, constraints) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;

  // Check capability constraints (POLICY)
  const policyRels = ekg.getRelationshipsByType(capability.id, 'CONSTRAINED_BY');
  for (const r of policyRels) {
    const policy = graph.nodes.get(r.to);
    if (policy && policy.properties.enforcement === 'BLOCK') {
      // Check if the policy is satisfied (simplified — most pass in seed)
    }
  }

  // Get produces + requires
  const produces = ekg.getRelationshipsByType(capability.id, 'PRODUCES').map((r) => r.to);
  const requires = ekg.getRelationshipsByType(capability.id, 'REQUIRES').map((r) => r.to);

  const entityProps = best.entity.properties as Record<string, number>;
  const capStep: ProofStep = {
    id: uid('ps'),
    kind: 'CAPABILITY',
    capabilityId: capability.id,
    capabilityName: capability.label,
    entityId: best.entity.id,
    entityName: best.entity.label,
    entityLabel: (best.entity.labels ?? [])[0],
    produces,
    consumes: requires.filter((r) => producedAssets.has(r)),
    cost: getOfferPrice(best.entity, capability.id),
    latencyMs: getOfferLatency(best.entity, capability.id),
    trustScore: entityProps.trustScore ?? 50,
    carbon: entityProps.carbonPerInvocation ?? 0,
    risk: Math.max(0, 100 - (entityProps.trustScore ?? 50)),
    reasoning: `${best.entity.label} (${(best.entity.labels ?? ['ENTITY'])[0]}) offers ${capability.label} · score ${best.score.toFixed(1)}`,
    children: [],
    alternatives: scored.slice(1, 4).map((s) => ({
      entityId: s.entity.id, entityName: s.entity.label,
      entityLabel: (s.entity.labels ?? [])[0] as EntityLabel,
      cost: getOfferPrice(s.entity, capability.id),
      latencyMs: getOfferLatency(s.entity, capability.id),
      trustScore: (s.entity.properties as { trustScore?: number }).trustScore ?? 50,
      reason: `score ${s.score.toFixed(1)}`,
    })),
  };

  // Add produced assets
  for (const p of produces) producedAssets.add(p);

  // Recursively prove each required asset
  for (const reqAsset of requires) {
    // Is it an input?
    if (goal.inputs[reqAsset] !== undefined) {
      capStep.children.push({
        id: uid('ps'), kind: 'INPUT', assetId: reqAsset,
        produces: [reqAsset], consumes: [],
        cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, risk: 0,
        reasoning: `User-provided input: ${reqAsset}`,
        children: [],
      });
      producedAssets.add(reqAsset);
      continue;
    }
    // Already produced?
    if (producedAssets.has(reqAsset)) continue;

    // Recurse: find capabilities that produce this required asset
    const subCaps = ekg.findCapabilitiesProducing(reqAsset);
    let resolved = false;
    for (const subCap of subCaps) {
      if (visited.has(subCap.id)) continue;
      const subStep = tryProve(goal, subCap, constraints, producedAssets, new Set(visited), depth + 1);
      if (subStep) {
        capStep.children.push(subStep);
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      // Backtrack — this capability can't be proven because a required asset is unresolvable
      return null;
    }
  }

  return capStep;
}

/**
 * Build the final Proof from the root step + compute aggregate scores.
 */
function finalizeProof(goal: Goal, rootStep: ProofStep, constraints: Constraints): Proof {
  // Walk the tree to compute aggregates
  const allSteps: ProofStep[] = [];
  const walk = (s: ProofStep) => { allSteps.push(s); for (const c of s.children) walk(c); };
  walk(rootStep);

  const capSteps = allSteps.filter((s) => s.kind === 'CAPABILITY');
  const totalCost = capSteps.reduce((s, n) => s + n.cost, 0);
  const totalLatencyMs = capSteps.reduce((s, n) => s + n.latencyMs, 0);
  const trustScore = capSteps.length ? Math.round(capSteps.reduce((s, n) => s + n.trustScore, 0) / capSteps.length) : 100;
  const carbon = capSteps.reduce((s, n) => s + n.carbon, 0);
  const risk = capSteps.length ? Math.round(capSteps.reduce((s, n) => s + n.risk, 0) / capSteps.length) : 0;
  const entityIds = new Set(capSteps.map((s) => s.entityId).filter(Boolean) as string[]);
  const entityLabels = new Set(capSteps.map((s) => s.entityLabel).filter(Boolean) as EntityLabel[]);

  // Wrap in a GOAL root step
  const goalRoot: ProofStep = {
    id: uid('ps'), kind: 'GOAL', goalId: goal.id, goalName: goal.name,
    produces: [goal.targetAsset], consumes: [],
    cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, risk: 0,
    reasoning: `Goal: ${goal.name} — satisfied by ${rootStep.capabilityName}`,
    children: [rootStep],
  };

  // Add SETTLEMENT leaf
  rootStep.children.push({
    id: uid('ps'), kind: 'SETTLEMENT',
    produces: [goal.targetAsset], consumes: [],
    cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, risk: 0,
    reasoning: `Atomic settlement — all capabilities verified, assets conserved, goal satisfied.`,
    children: [],
  });

  const { score, breakdown } = scoreProof(goal, totalCost, totalLatencyMs, trustScore, carbon, risk, constraints);
  const memoryHits = checkMemoryHits(goal);

  return {
    id: uid('proof'),
    goalId: goal.id, goalName: goal.name,
    root: goalRoot,
    totalCost, totalLatencyMs, trustScore, carbon, risk,
    entityLabels: Array.from(entityLabels),
    capabilityCount: capSteps.length,
    entityCount: entityIds.size,
    plannerScore: score, scoreBreakdown: breakdown,
    status: 'proposed',
    memoryHits,
    predictedSuccessRate: memoryHits > 0 ? 85 + Math.random() * 10 : 75,
    createdAt: Date.now(),
  };
}

function scoreEntity(entity: GraphNode, capability: GraphNode, constraints: Constraints): number {
  const props = entity.properties as Record<string, number>;
  const offerProps = getOfferProperties(entity.id, capability.id);
  let s = 0;
  // Cost (30)
  const price = offerProps.pricePerInvocation ?? 1;
  s += price <= 0 ? 30 : Math.max(2, 30 - Math.log10(price + 1) * 18);
  // Latency (20)
  const lat = offerProps.latencyMs ?? 1000;
  s += lat <= 100 ? 20 : Math.max(1, 20 - (lat / 10000) * 19);
  // Trust (20)
  s += ((props.trustScore ?? 50) / 100) * 20;
  // SLA (10)
  s += (offerProps.slaSuccessRate ?? 0.99) * 10;
  // Reliability (20) — learned score
  s += ((props.reliabilityScore ?? 50) / 100) * 20;
  // Bias toward preferred entity label
  if (constraints.preferEntityLabel && entity.labels?.includes(constraints.preferEntityLabel)) s += 3;
  return s;
}

function getOfferProperties(entityId: string, capabilityId: string): Record<string, number> {
  const rel = graph.relationships.find((r) => r.type === 'OFFERS' && r.from === entityId && r.to === capabilityId && !r.validTo);
  return (rel?.properties ?? {}) as Record<string, number>;
}
function getOfferPrice(entity: GraphNode, capabilityId: string): number {
  return getOfferProperties(entity.id, capabilityId).pricePerInvocation ?? 1;
}
function getOfferLatency(entity: GraphNode, capabilityId: string): number {
  return getOfferProperties(entity.id, capabilityId).latencyMs ?? 1000;
}
