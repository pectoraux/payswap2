/**
 * General-Purpose Economic Computation Engine — The Planner.
 *
 * A constraint solver that takes a Goal (implementation-agnostic) + constraints
 * and discovers MULTIPLE economic proofs — one per acceptable strategy. Each
 * proof is a different implementation path (payment, scholarship, sponsorship,
 * voucher, etc.). The planner scores them using economic memory and returns
 * ranked alternatives.
 *
 * This is the universal resolve():
 *   resolve(goal, constraints, policies) → EconomicProof[]
 *
 * Algorithm:
 *   For each acceptable strategy:
 *     1. Synthesize a proof graph for that strategy (different organizations
 *        + capabilities depending on the strategy).
 *     2. Score the proof against the constraints (cost, latency, trust, carbon,
 *        risk) AND economic memory (past success rate for this goal+strategy).
 *     3. Rank.
 *   Return all proofs, ranked by planner score.
 *
 * The planner is adaptive — economic memory biases it toward strategies +
 * organizations that have historically succeeded.
 */

import { uid } from '@/runtime/types';
import { engineStore } from './store';
import type {
  Goal, Strategy, ConstraintBundle, EconomicProof, ProofNode, ProofEdge,
  Organization,
} from './types';
import { STRATEGY_META } from './types';

interface ResolveResult {
  proofs: EconomicProof[];
  bestProofId: string;
  totalStrategiesExplored: number;
  planningMs: number;
}

/**
 * The universal resolve() — the primary programming model.
 *   resolve(goal, constraints) → multiple ranked proofs
 */
export function resolve(goal: Goal, constraints: ConstraintBundle = {}): ResolveResult {
  const start = Date.now();
  const proofs: EconomicProof[] = [];

  for (const strategy of goal.acceptableStrategies) {
    const proof = synthesizeProof(goal, strategy, constraints);
    if (proof) proofs.push(proof);
  }

  // Rank by planner score (descending)
  proofs.sort((a, b) => b.plannerScore - a.plannerScore);

  const planningMs = Date.now() - start;
  return {
    proofs,
    bestProofId: proofs[0]?.id ?? '',
    totalStrategiesExplored: goal.acceptableStrategies.length,
    planningMs,
  };
}

/**
 * Synthesize a proof for a specific strategy. Different strategies route
 * through different organizations + capabilities.
 */
function synthesizeProof(goal: Goal, strategy: Strategy, constraints: ConstraintBundle): EconomicProof | null {
  const nodes: ProofNode[] = [];
  const edges: ProofEdge[] = [];
  const producedAssets = new Set<string>();

  // Input node
  const inputNode: ProofNode = {
    id: uid('pn'), kind: 'INPUT',
    produces: goal.inputs, consumes: [],
    cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, risk: 0,
  };
  nodes.push(inputNode);
  for (const inp of goal.inputs) producedAssets.add(inp.assetId);

  // Strategy-specific routing
  const orgChain = selectOrganizationsForStrategy(goal, strategy, constraints);
  if (orgChain.length === 0) return null;

  let prevNodeId = inputNode.id;
  for (const org of orgChain) {
    const cap = org.capabilities[0]; // primary capability
    const produces = org.produces.map((a) => ({ assetId: a, amount: 1 }));
    // Only include consumed assets that are actually produced upstream (or are inputs).
    // The verification layer enforces asset conservation — we must not claim to consume
    // assets that no node produces.
    const consumes = org.consumes
      .filter((a) => producedAssets.has(a))
      .map((a) => ({ assetId: a, amount: 1 }));
    const node: ProofNode = {
      id: uid('pn'), kind: 'ORGANIZATION',
      organizationId: org.id, organizationName: org.name,
      capability: cap,
      produces, consumes,
      cost: estimateCost(org, strategy),
      latencyMs: org.avgLatencyMs,
      trustScore: org.trustScore,
      carbon: org.carbonPerInvocation,
      risk: estimateRisk(org, strategy),
      reasoning: `${org.name} ${cap} (strategy: ${STRATEGY_META[strategy].label})`,
    };
    nodes.push(node);
    for (const p of org.produces) producedAssets.add(p);
    // edge from prev to this node (for the first consumed asset that's produced)
    const linkedAsset = org.consumes.find((c) => producedAssets.has(c)) ?? org.consumes[0];
    if (linkedAsset) edges.push({ from: prevNodeId, to: node.id, assetId: linkedAsset, amount: 1 });
    prevNodeId = node.id;
  }

  // Output node (the goal target)
  const outputNode: ProofNode = {
    id: uid('pn'), kind: 'OUTPUT',
    produces: [{ assetId: goal.targetAsset ?? goal.targetAssetType, amount: 1 }],
    consumes: [{ assetId: goal.targetAsset ?? goal.targetAssetType, amount: 1 }],
    cost: 0, latencyMs: 0, trustScore: 100, carbon: 0, risk: 0,
  };
  edges.push({ from: prevNodeId, to: outputNode.id, assetId: goal.targetAsset ?? goal.targetAssetType, amount: 1 });
  nodes.push(outputNode);

  // Opportunistic organizations (carbon offset, rewards, compliance)
  const opportunistic = discoverOpportunistic(producedAssets, goal, constraints);
  for (const opp of opportunistic) {
    const oppNode: ProofNode = {
      id: uid('pn'), kind: 'OPPORTUNISTIC',
      organizationId: opp.id, organizationName: opp.name,
      capability: opp.capabilities[0],
      produces: opp.produces.map((a) => ({ assetId: a, amount: 1 })),
      consumes: opp.consumes.filter((c) => producedAssets.has(c)).map((a) => ({ assetId: a, amount: 1 })),
      cost: estimateCost(opp, strategy),
      latencyMs: opp.avgLatencyMs,
      trustScore: opp.trustScore,
      carbon: opp.carbonPerInvocation,
      risk: 0,
      reasoning: `Opportunistic: reacts to produced assets to add value (${opp.produces.join(', ')})`,
    };
    nodes.push(oppNode);
    for (const c of opp.consumes) {
      if (producedAssets.has(c)) {
        const producer = nodes.find((n) => n.produces.some((p) => p.assetId === c));
        if (producer) edges.push({ from: producer.id, to: oppNode.id, assetId: c, amount: 1 });
      }
    }
  }

  // Aggregate scores
  const orgNodes = nodes.filter((n) => n.kind === 'ORGANIZATION' || n.kind === 'OPPORTUNISTIC');
  const totalCost = orgNodes.reduce((s, n) => s + n.cost, 0);
  const totalLatencyMs = orgNodes.reduce((s, n) => s + n.latencyMs, 0);
  const trustScore = orgNodes.length ? Math.round(orgNodes.reduce((s, n) => s + n.trustScore, 0) / orgNodes.length) : 100;
  const carbon = orgNodes.reduce((s, n) => s + n.carbon, 0);
  const risk = orgNodes.length ? Math.round(orgNodes.reduce((s, n) => s + n.risk, 0) / orgNodes.length) : 0;
  const organizationCount = new Set(orgNodes.map((n) => n.organizationId).filter(Boolean)).size;

  // Score against constraints + memory
  const { score, breakdown, memoryHits, predictedSuccessRate } = scoreProof(goal, strategy, totalCost, totalLatencyMs, trustScore, carbon, risk, constraints);

  return {
    id: uid('proof'),
    goalId: goal.id,
    goalName: goal.name,
    strategy,
    strategyRationale: STRATEGY_META[strategy].description,
    nodes, edges,
    totalCost, totalLatencyMs, trustScore, carbon, risk,
    organizationCount,
    opportunisticCount: opportunistic.length,
    plannerScore: score,
    scoreBreakdown: breakdown,
    status: 'proposed',
    memoryHits,
    predictedSuccessRate,
    createdAt: Date.now(),
  };
}

/**
 * Select the chain of organizations for a given strategy. Different strategies
 * route through different orgs — this is where the planner's strategy-awareness
 * lives.
 */
function selectOrganizationsForStrategy(goal: Goal, strategy: Strategy, constraints: ConstraintBundle): Organization[] {
  const orgs = engineStore.organizations;
  const chain: Organization[] = [];

  // All strategies that involve a customer need identity verification first
  // (unless identity is an input)
  const hasIdentityInput = goal.inputs.some((i) => i.assetId === 'credential.verified_identity');
  if (!hasIdentityInput && strategy !== 'TRADE') {
    const identity = orgs.get('identity');
    if (identity) chain.push(identity);
  }

  switch (strategy) {
    case 'PAYMENT': {
      // For payment: treasury settles payment, then the target org accepts the payment receipt + produces the goal asset
      const treasury = orgs.get('treasury');
      if (treasury) chain.push(treasury);
      const target = findOrgProducingGoal(goal);
      if (target && !chain.includes(target)) chain.push(target);
      break;
    }
    case 'SCHOLARSHIP': {
      const scholarship = orgs.get('scholarship');
      if (scholarship) chain.push(scholarship);
      const target = findOrgConsuming(goal, 'right.scholarship');
      if (target) chain.push(target);
      break;
    }
    case 'SPONSORSHIP': {
      const sponsor = orgs.get('sponsor');
      if (sponsor) chain.push(sponsor);
      const target = findOrgConsuming(goal, 'right.sponsorship');
      if (target) chain.push(target);
      break;
    }
    case 'VOUCHER': {
      const voucher = orgs.get('voucher');
      if (voucher) chain.push(voucher);
      const target = findOrgConsuming(goal, 'right.voucher');
      if (target) chain.push(target);
      break;
    }
    case 'STORED_CREDITS': {
      // Direct: the target org accepts stored credits (no treasury needed)
      const target = findOrgProducingGoal(goal);
      if (target) chain.push(target);
      break;
    }
    case 'DEFERRED_FINANCE': {
      const lending = orgs.get('lending');
      if (lending) chain.push(lending);
      const target = findOrgConsuming(goal, 'right.financing') ?? findOrgProducingGoal(goal);
      if (target && !chain.includes(target)) chain.push(target);
      break;
    }
    case 'TOKENIZED_RIGHT': {
      const target = findOrgProducingGoal(goal);
      if (target) chain.push(target);
      break;
    }
    case 'DONATION': {
      const scholarship = orgs.get('scholarship');
      if (scholarship) chain.push(scholarship);
      const target = findOrgProducingGoal(goal);
      if (target && !chain.includes(target)) chain.push(target);
      break;
    }
    case 'GRANT': {
      const scholarship = orgs.get('scholarship');
      if (scholarship) chain.push(scholarship);
      const target = findOrgProducingGoal(goal);
      if (target && !chain.includes(target)) chain.push(target);
      break;
    }
    case 'TRADE': {
      const target = findOrgProducingGoal(goal);
      if (target) chain.push(target);
      break;
    }
    case 'INSURANCE': {
      const insurance = orgs.get('insurance');
      if (insurance) chain.push(insurance);
      break;
    }
    case 'SUBSCRIPTION': {
      const target = findOrgProducingGoal(goal);
      if (target) chain.push(target);
      break;
    }
  }

  // Apply constraint filters
  return chain.filter((o) => {
    if (constraints.excludeOrganizations?.includes(o.id)) return false;
    if (constraints.requireOrganizations && !constraints.requireOrganizations.includes(o.id)) {
      // requireOrganizations means these MUST be included, but we don't force-exclude others
    }
    if (constraints.minReputation !== undefined && o.reputation < constraints.minReputation) return false;
    if (constraints.jurisdiction && o.policies.some((p) => p.rule === 'jurisdiction_check')) {
      // compliance org handles jurisdiction — keep it
    }
    return true;
  });
}

function findOrgProducingGoal(goal: Goal, preferredAsset?: string): Organization | undefined {
  const target = preferredAsset ?? goal.targetAsset;
  if (target) {
    const org = Array.from(engineStore.organizations.values()).find((o) => o.produces.includes(target));
    if (org) return org;
  }
  // fallback: find any org producing the target asset type
  return Array.from(engineStore.organizations.values()).find((o) =>
    o.produces.some((p) => p.startsWith(goal.targetAssetType.toLowerCase()) || p.includes(goal.targetAssetType.toLowerCase())),
  );
}

function findOrgConsuming(goal: Goal, assetId: string): Organization | undefined {
  const target = findOrgProducingGoal(goal);
  if (target && target.consumes.includes(assetId)) return target;
  return Array.from(engineStore.organizations.values()).find((o) => o.consumes.includes(assetId));
}

function discoverOpportunistic(producedAssets: Set<string>, _goal: Goal, _constraints: ConstraintBundle): Organization[] {
  const result: Organization[] = [];
  const used = new Set<string>();
  for (const assetId of producedAssets) {
    for (const org of engineStore.organizations.values()) {
      if (used.has(org.id)) continue;
      if (org.consumes.includes(assetId)) {
        // valuable side-effect producers
        if (org.produces.some((p) =>
          p === 'carbon.offset' || p === 'reward.points' || p === 'evidence.tax' ||
          p === 'evidence.compliance' || p === 'reputation.seller' || p === 'credential.skill')) {
          result.push(org);
          used.add(org.id);
        }
      }
    }
  }
  return result;
}

function estimateCost(org: Organization, strategy: Strategy): number {
  // Base cost by org category + strategy multiplier
  const baseByCategory: Record<string, number> = {
    identity: strategy === 'PAYMENT' ? 0.20 : 0.20,
    treasury: 0.001,
    education: strategy === 'PAYMENT' ? 1.50 : 0.50,
    marketplace: 0.01,
    lending: 25,
    scholarship: 0,
    sponsor: 1.80,
    voucher: 0.05,
    insurance: 12,
    rewards: 0.0001,
    carbon: 0.05,
    employment: 5,
    compliance: 0.50,
    ai: 0.002,
  };
  return baseByCategory[org.category] ?? 1;
}

function estimateRisk(org: Organization, _strategy: Strategy): number {
  // Risk inverse to trust + reputation
  return Math.max(0, Math.min(100, 100 - org.trustScore + (100 - org.reputation) / 2));
}

interface ScoredProof {
  score: number;
  breakdown: { dimension: string; score: number; weight: number }[];
  memoryHits: number;
  predictedSuccessRate: number;
}

/**
 * Score a proof against constraints + economic memory. Returns 0–100.
 */
function scoreProof(
  goal: Goal, strategy: Strategy,
  cost: number, latency: number, trust: number, carbon: number, risk: number,
  constraints: ConstraintBundle,
): ScoredProof {
  const breakdown: { dimension: string; score: number; weight: number }[] = [];

  // ── Cost (25) ──
  let costScore: number;
  if (cost <= 0) costScore = 25;
  else if (cost >= 50) costScore = 2;
  else costScore = Math.max(2, 25 - Math.log10(cost + 1) * 18);
  if (constraints.budget !== undefined && cost > constraints.budget) costScore *= 0.2;
  breakdown.push({ dimension: 'Cost', score: costScore, weight: 25 });

  // ── Latency (15) ──
  let latencyScore: number;
  if (latency <= 100) latencyScore = 15;
  else if (latency >= 10000) latencyScore = 1;
  else latencyScore = Math.max(1, 15 - (latency / 10000) * 14);
  if (constraints.deadline !== undefined && latency > constraints.deadline) latencyScore *= 0.3;
  breakdown.push({ dimension: 'Latency', score: latencyScore, weight: 15 });

  // ── Trust (20) ──
  let trustScore = (trust / 100) * 20;
  if (constraints.minTrust !== undefined && trust < constraints.minTrust) trustScore *= 0.3;
  breakdown.push({ dimension: 'Trust', score: trustScore, weight: 20 });

  // ── Risk (10) ──
  let riskScore = Math.max(0, 10 - (risk / 100) * 10);
  if (constraints.maxRisk !== undefined && risk > constraints.maxRisk) riskScore *= 0.3;
  breakdown.push({ dimension: 'Risk', score: riskScore, weight: 10 });

  // ── Carbon (10) ──
  let carbonScore: number;
  if (carbon <= 0) carbonScore = 10;
  else if (carbon >= 1) carbonScore = 1;
  else carbonScore = Math.max(1, 10 - carbon * 9);
  if (constraints.maxCarbon !== undefined && carbon > constraints.maxCarbon) carbonScore *= 0.3;
  breakdown.push({ dimension: 'Carbon', score: carbonScore, weight: 10 });

  // ── Economic Memory (20) — THE ADAPTIVE COMPONENT ──
  // Look up past executions of this goal + strategy
  const pastExecutions = engineStore.memory.filter((m) => m.goalId === goal.id && m.strategy === strategy);
  const memoryHits = pastExecutions.length;
  let memoryScore: number;
  let predictedSuccessRate = 100;
  if (pastExecutions.length > 0) {
    const successRate = pastExecutions.filter((m) => m.outcome === 'SUCCESS').length / pastExecutions.length;
    predictedSuccessRate = successRate * 100;
    const avgSatisfaction = pastExecutions.filter((m) => m.customerSatisfaction !== undefined).reduce((s, m) => s + (m.customerSatisfaction ?? 0), 0) / Math.max(1, pastExecutions.filter((m) => m.customerSatisfaction !== undefined).length);
    memoryScore = (successRate * 12) + (avgSatisfaction / 100) * 8;
  } else {
    memoryScore = 8; // neutral — no memory yet
    predictedSuccessRate = 85; // default
  }
  breakdown.push({ dimension: 'Memory', score: memoryScore, weight: 20 });

  // ── Strategy preference bonus ──
  if (constraints.preferStrategy === strategy) {
    breakdown[0].score += 3; // boost cost dimension
  }

  const total = breakdown.reduce((s, b) => s + b.score, 0);
  return {
    score: Math.round(Math.max(0, Math.min(100, total)) * 10) / 10,
    breakdown,
    memoryHits,
    predictedSuccessRate,
  };
}
