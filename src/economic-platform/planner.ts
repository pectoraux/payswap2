/**
 * Economic Computation Platform — Graph Planner.
 *
 * Graph search over CAPABILITIES (not organizations). For a goal, the planner:
 *   1. Finds the capability that produces the goal's target asset.
 *   2. Recursively finds capabilities that produce that capability's required assets.
 *   3. For each capability, picks the best PROVIDER from the capability market
 *      (heterogeneous providers compete — orgs, AI models, humans, APIs, banks,
 *      government, blockchain, IoT all compete on the same capability).
 *   4. Scores using economic memory (learned scores bias provider selection).
 *   5. Returns a proof.
 *
 * The planner doesn't care what KIND of entity provides a capability — a
 * university, Claude, a freelancer, Stripe, a sensor, a central bank, and a
 * smart contract are all just providers. That's the universal abstraction.
 */

import { uid } from '@/runtime/types';
import { platformStore } from './store';
import type {
  Goal, ConstraintBundle, EconomicProof, ProofNode, ProofEdge,
  Capability, CapabilityProvider, ProviderKind,
} from './types';

/**
 * resolve(goal, constraints) → EconomicProof
 * The universal API. Graph search + market optimization.
 */
export function resolveGoal(goal: Goal, constraints: ConstraintBundle = {}): EconomicProof | null {
  const nodes: ProofNode[] = [];
  const edges: ProofEdge[] = [];
  const producedAssets = new Set<string>();
  const visitedCapabilities = new Set<string>();

  // Input node
  const inputNode: ProofNode = {
    id: uid('pn'), kind: 'INPUT',
    produces: goal.inputs, consumes: [],
    cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, status: 'completed',
    reasoning: 'User-provided inputs',
  };
  nodes.push(inputNode);
  for (const inp of goal.inputs) producedAssets.add(inp.assetId);

  // Backward-chain from the goal's target asset
  const goalNode = resolveAsset(goal.targetAsset, goal, constraints, producedAssets, nodes, edges, visitedCapabilities, new Set(), 0);
  if (!goalNode) return null;

  // Output node
  const outputNode: ProofNode = {
    id: uid('pn'), kind: 'OUTPUT',
    produces: [{ assetId: goal.targetAsset, amount: 1 }],
    consumes: [{ assetId: goal.targetAsset, amount: 1 }],
    cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, status: 'pending',
    reasoning: `Goal target: ${goal.targetAsset}`,
  };
  edges.push({ from: goalNode.id, to: outputNode.id, assetId: goal.targetAsset, amount: 1 });
  nodes.push(outputNode);

  // Opportunistic capabilities (carbon offset, fraud detection, compliance)
  const opportunistic = discoverOpportunistic(producedAssets, constraints);
  for (const { cap, provider } of opportunistic) {
    const oppNode: ProofNode = {
      id: uid('pn'), kind: 'OPPORTUNISTIC',
      capabilityId: cap.id, capabilityName: cap.name,
      providerId: provider.id, providerName: provider.name, providerKind: provider.kind,
      produces: cap.produces.map((a) => ({ assetId: a, amount: 1 })),
      consumes: cap.requires.filter((r) => producedAssets.has(r)).map((a) => ({ assetId: a, amount: 1 })),
      cost: getOfferPrice(provider, cap.id),
      latencyMs: getOfferLatency(provider, cap.id),
      trustScore: provider.trustScore,
      carbon: provider.carbonPerInvocation,
      status: 'selected',
      reasoning: `Opportunistic: ${provider.name} (${provider.kind}) reacts to produced assets`,
    };
    nodes.push(oppNode);
    for (const r of cap.requires) {
      if (producedAssets.has(r)) {
        const producer = nodes.find((n) => n.produces.some((p) => p.assetId === r));
        if (producer) edges.push({ from: producer.id, to: oppNode.id, assetId: r, amount: 1 });
      }
    }
    for (const p of cap.produces) producedAssets.add(p);
  }

  // Aggregate scores
  const capNodes = nodes.filter((n) => n.kind === 'CAPABILITY' || n.kind === 'OPPORTUNISTIC');
  const totalCost = capNodes.reduce((s, n) => s + n.cost, 0);
  const totalLatencyMs = capNodes.reduce((s, n) => s + n.latencyMs, 0);
  const trustScore = capNodes.length ? Math.round(capNodes.reduce((s, n) => s + n.trustScore, 0) / capNodes.length) : 100;
  const carbon = capNodes.reduce((s, n) => s + n.carbon, 0);
  const providerIds = new Set(capNodes.map((n) => n.providerId).filter(Boolean) as string[]);
  const providerKinds = new Set(capNodes.map((n) => n.providerKind).filter(Boolean) as ProviderKind[]);

  // Score using memory
  const { score, breakdown, memoryHits, predictedSuccessRate } = scoreProof(goal, totalCost, totalLatencyMs, trustScore, carbon, constraints);

  return {
    id: uid('proof'), goalId: goal.id, goalName: goal.name,
    nodes, edges,
    totalCost, totalLatencyMs, trustScore, carbon,
    capabilityCount: capNodes.filter((n) => n.kind === 'CAPABILITY').length,
    providerCount: providerIds.size,
    providerKinds: Array.from(providerKinds),
    plannerScore: score, scoreBreakdown: breakdown,
    status: 'proposed', memoryHits, predictedSuccessRate,
    createdAt: Date.now(),
  };
}

function resolveAsset(
  assetId: string, goal: Goal, constraints: ConstraintBundle,
  producedAssets: Set<string>, nodes: ProofNode[], edges: ProofEdge[],
  visited: Set<string>, resolving: Set<string>, depth: number,
): ProofNode | null {
  if (depth > 12) return null;
  if (resolving.has(assetId)) return null;
  resolving.add(assetId);

  // Already produced?
  const existing = nodes.find((n) => n.produces.some((p) => p.assetId === assetId));
  if (existing) { resolving.delete(assetId); return existing; }

  // Find capabilities that produce this asset
  const candidates = Array.from(platformStore.capabilities.values()).filter((c) => c.produces.includes(assetId));
  if (candidates.length === 0) { resolving.delete(assetId); return null; }

  // Pick the best capability (for now, the first that's reachable)
  // In a full impl, we'd try all + score each path
  for (const cap of candidates) {
    if (visited.has(cap.id)) continue;
    visited.add(cap.id);

    // Find the best provider for this capability (the market)
    const { provider, alternatives, reasoning } = selectBestProvider(cap, constraints);
    if (!provider) continue;

    const node: ProofNode = {
      id: uid('pn'), kind: 'CAPABILITY',
      capabilityId: cap.id, capabilityName: cap.name,
      providerId: provider.id, providerName: provider.name, providerKind: provider.kind,
      produces: cap.produces.map((a) => ({ assetId: a, amount: 1 })),
      consumes: cap.requires.filter((r) => producedAssets.has(r)).map((a) => ({ assetId: a, amount: 1 })),
      cost: getOfferPrice(provider, cap.id),
      latencyMs: getOfferLatency(provider, cap.id),
      trustScore: provider.trustScore,
      carbon: provider.carbonPerInvocation,
      status: 'selected',
      reasoning,
      alternatives,
    };
    nodes.push(node);
    for (const p of cap.produces) producedAssets.add(p);

    // Resolve required assets
    let allResolved = true;
    for (const req of cap.requires) {
      if (producedAssets.has(req)) {
        const producer = nodes.find((n) => n.produces.some((p) => p.assetId === req));
        if (producer) edges.push({ from: producer.id, to: node.id, assetId: req, amount: 1 });
        continue;
      }
      // Is it an input?
      if (goal.inputs.some((i) => i.assetId === req)) {
        edges.push({ from: nodes[0].id, to: node.id, assetId: req, amount: 1 });
        producedAssets.add(req);
        continue;
      }
      const producer = resolveAsset(req, goal, constraints, producedAssets, nodes, edges, visited, resolving, depth + 1);
      if (producer) {
        edges.push({ from: producer.id, to: node.id, assetId: req, amount: 1 });
      } else {
        allResolved = false;
      }
    }
    if (allResolved || cap.requires.length === 0) {
      resolving.delete(assetId);
      return node;
    }
  }
  resolving.delete(assetId);
  return null;
}

/**
 * Select the best provider for a capability from the market. This is THE
 * market optimization — heterogeneous providers compete, and the planner picks
 * the best based on cost, latency, trust, SLA, and LEARNED memory scores.
 */
function selectBestProvider(cap: Capability, constraints: ConstraintBundle): {
  provider: CapabilityProvider | null;
  alternatives: NonNullable<ProofNode['alternatives']>;
  reasoning: string;
} {
  // Find all providers offering this capability
  const providersWithOffer = Array.from(platformStore.providers.values())
    .filter((p) => p.status === 'ACTIVE' && p.offers.some((o) => o.capabilityId === cap.id))
    .map((p) => {
      const offer = p.offers.find((o) => o.capabilityId === cap.id)!;
      // Look up learned score
      const learnKey = `${p.id}::${cap.id}`;
      const learned = platformStore.learningScores.get(learnKey);
      return { provider: p, offer, learnedScore: learned?.learnedScore ?? 50, learned };
    });

  if (providersWithOffer.length === 0) {
    return { provider: null, alternatives: [], reasoning: 'No provider offers this capability' };
  }

  // Filter by constraints
  let filtered = providersWithOffer;
  if (constraints.excludeProviders) {
    filtered = filtered.filter((x) => !constraints.excludeProviders!.includes(x.provider.id));
  }
  if (constraints.jurisdiction) {
    filtered = filtered.filter((x) => x.provider.jurisdictions.length === 0 || x.provider.jurisdictions.includes(constraints.jurisdiction!));
  }
  if (constraints.preferProviderKind) {
    // Don't exclude others, but boost the preferred kind
  }

  // Score each provider
  const scored = filtered.map((x) => {
    let s = 0;
    // Cost (30) — log scale
    s += x.offer.pricePerInvocation <= 0 ? 30 : Math.max(2, 30 - Math.log10(x.offer.pricePerInvocation + 1) * 18);
    // Latency (20)
    s += x.offer.latencyMs <= 100 ? 20 : Math.max(1, 20 - (x.offer.latencyMs / 10000) * 19);
    // Trust (20)
    s += (x.provider.trustScore / 100) * 20;
    // SLA (10)
    s += x.offer.slaSuccessRate * 10;
    // Learned score (20) — THE ADAPTIVE COMPONENT
    s += (x.learnedScore / 100) * 20;
    // Prefer provider kind bias
    if (constraints.preferProviderKind && x.provider.kind === constraints.preferProviderKind) s += 3;
    // Carbon penalty
    if (constraints.maxCarbon !== undefined && x.provider.carbonPerInvocation > constraints.maxCarbon) s *= 0.7;
    return { ...x, score: Math.round(s * 10) / 10 };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const alternatives = scored.slice(1, 4).map((x) => ({
    providerId: x.provider.id, providerName: x.provider.name, providerKind: x.provider.kind,
    cost: x.offer.pricePerInvocation, latencyMs: x.offer.latencyMs, trustScore: x.provider.trustScore,
    reason: `score ${x.score.toFixed(1)} · learned ${x.learnedScore}`,
  }));

  const reasoning = `Selected ${best.provider.name} (${best.provider.kind}) · score ${best.score.toFixed(1)}/100 · cost $${best.offer.pricePerInvocation.toFixed(4)} · ${best.offer.latencyMs}ms · trust ${best.provider.trustScore} · learned ${best.learnedScore} · ${scored.length} providers competed`;

  return { provider: best.provider, alternatives, reasoning };
}

function discoverOpportunistic(producedAssets: Set<string>, _constraints: ConstraintBundle): Array<{ cap: Capability; provider: CapabilityProvider }> {
  const result: Array<{ cap: Capability; provider: CapabilityProvider }> = [];
  const usedCaps = new Set<string>();
  for (const assetId of producedAssets) {
    for (const cap of platformStore.capabilities.values()) {
      if (usedCaps.has(cap.id)) continue;
      if (cap.requires.includes(assetId) && cap.produces.some((p) =>
        p === 'carbon.offset' || p === 'evidence.compliance' || p === 'knowledge.insight' || p === 'reputation.seller')) {
        const { provider } = selectBestProvider(cap, _constraints);
        if (provider) {
          result.push({ cap, provider });
          usedCaps.add(cap.id);
        }
      }
    }
  }
  return result;
}

function getOfferPrice(provider: CapabilityProvider, capId: string): number {
  return provider.offers.find((o) => o.capabilityId === capId)?.pricePerInvocation ?? 1;
}
function getOfferLatency(provider: CapabilityProvider, capId: string): number {
  return provider.offers.find((o) => o.capabilityId === capId)?.latencyMs ?? 1000;
}

interface ScoredProof { score: number; breakdown: { dimension: string; score: number; weight: number }[]; memoryHits: number; predictedSuccessRate: number; }

function scoreProof(goal: Goal, cost: number, latency: number, trust: number, carbon: number, constraints: ConstraintBundle): ScoredProof {
  const breakdown: { dimension: string; score: number; weight: number }[] = [];
  let costScore = cost <= 0 ? 25 : Math.max(2, 25 - Math.log10(cost + 1) * 18);
  if (constraints.budget !== undefined && cost > constraints.budget) costScore *= 0.2;
  breakdown.push({ dimension: 'Cost', score: costScore, weight: 25 });

  let latencyScore = latency <= 100 ? 15 : Math.max(1, 15 - (latency / 10000) * 14);
  if (constraints.deadline !== undefined && latency > constraints.deadline) latencyScore *= 0.3;
  breakdown.push({ dimension: 'Latency', score: latencyScore, weight: 15 });

  let trustScore = (trust / 100) * 20;
  if (constraints.minTrust !== undefined && trust < constraints.minTrust) trustScore *= 0.3;
  breakdown.push({ dimension: 'Trust', score: trustScore, weight: 20 });

  const carbonScore = carbon <= 0 ? 10 : Math.max(1, 10 - carbon * 9);
  breakdown.push({ dimension: 'Carbon', score: carbonScore, weight: 10 });

  // Memory dimension — look up past executions for this goal
  const pastExecutions = platformStore.memory.filter((m) => m.goalId === goal.id);
  const memoryHits = pastExecutions.length;
  let memoryScore = 8; let predictedSuccessRate = 85;
  if (pastExecutions.length > 0) {
    const successRate = pastExecutions.filter((m) => m.outcome === 'SUCCESS').length / pastExecutions.length;
    predictedSuccessRate = successRate * 100;
    const avgSat = pastExecutions.filter((m) => m.customerSatisfaction !== undefined).reduce((s, m) => s + (m.customerSatisfaction ?? 0), 0) / Math.max(1, pastExecutions.filter((m) => m.customerSatisfaction !== undefined).length);
    memoryScore = (successRate * 12) + (avgSat / 100) * 8;
  }
  breakdown.push({ dimension: 'Memory', score: memoryScore, weight: 20 });

  const riskScore = 10; // simplified
  breakdown.push({ dimension: 'Risk', score: riskScore, weight: 10 });

  const total = breakdown.reduce((s, b) => s + b.score, 0);
  return { score: Math.round(Math.max(0, Math.min(100, total)) * 10) / 10, breakdown, memoryHits, predictedSuccessRate };
}
