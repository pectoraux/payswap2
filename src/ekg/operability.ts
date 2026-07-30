/**
 * Economic Knowledge Graph — Operability Tools.
 *
 * PHASE 7: The tools institutions actually buy.
 *   - Proof Debugger: step through a proof tree node-by-node, inspect each
 *     step's inputs/outputs/score/alternatives. Set "breakpoints" on capabilities
 *     to see why they were chosen.
 *   - Graph Diff Viewer: compare graph state at two sequence numbers. Show what
 *     nodes/relationships were added/removed/modified between them.
 *   - Policy Simulator: given a hypothetical policy change, simulate which proofs
 *     would pass/fail under the new policy — without committing the change.
 */

import { ekg } from './graph';
import { graph } from './graph';
import { getGoals, getProof } from './index';
import { replayProjection, stateAtSeq } from './event-log';
import { prove } from './planner';
import { issueCertificate } from './formal-verifier';
import type { Proof, Goal, Constraints, ProofStep, GraphNode, GraphRelationship } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// PROOF DEBUGGER — step through a proof tree node-by-node
// ═══════════════════════════════════════════════════════════════════════════

export interface ProofDebugStep {
  /** The step index in the traversal (0 = root). */
  index: number;
  /** The depth in the tree (0 = root). */
  depth: number;
  /** The proof step. */
  step: ProofStep;
  /** The parent step (null for root). */
  parentIndex: number | null;
  /** Children step indices. */
  childIndices: number[];
  /** A breakpoint hit if this step's capability matches a breakpoint. */
  breakpointHit?: string;
  /** Human-readable trace line. */
  trace: string;
}

export interface ProofDebugSession {
  proofId: string;
  goalName: string;
  steps: ProofDebugStep[];
  /** Capabilities that breakpoints were set on. */
  breakpoints: string[];
  /** The step indices where breakpoints were hit. */
  breakpointHits: number[];
  /** Summary statistics. */
  stats: {
    totalSteps: number;
    capabilitySteps: number;
    inputSteps: number;
    settlementSteps: number;
    goalSteps: number;
    maxDepth: number;
    totalCost: number;
    totalLatencyMs: number;
    distinctProviders: number;
  };
}

/**
 * Debug a proof: flatten the tree into a step-by-step traversal with
 * parent/child indices, breakpoints, and per-step trace lines.
 *
 * Set breakpoints on capability names to see exactly when/why they're chosen.
 */
export function debugProof(proofId: string, breakpoints: string[] = []): ProofDebugSession {
  const proof = getProof(proofId);
  if (!proof) throw new Error(`Proof not found: ${proofId}`);

  const steps: ProofDebugStep[] = [];
  const breakpointHits: number[] = [];
  let maxDepth = 0;

  const walk = (step: ProofStep, depth: number, parentIndex: number | null) => {
    const index = steps.length;
    if (depth > maxDepth) maxDepth = depth;

    // Check breakpoint
    let breakpointHit: string | undefined;
    if (step.capabilityName && breakpoints.includes(step.capabilityName)) {
      breakpointHit = step.capabilityName;
      breakpointHits.push(index);
    }
    if (step.capabilityId && breakpoints.includes(step.capabilityId)) {
      breakpointHit = step.capabilityId;
      breakpointHits.push(index);
    }

    // Build trace line
    const parts: string[] = [];
    parts.push(`[${step.kind}]`);
    if (step.capabilityName) parts.push(step.capabilityName);
    if (step.entityName) parts.push(`→ ${step.entityName} (${step.entityLabel ?? 'ENTITY'})`);
    if (step.cost > 0) parts.push(`$${step.cost.toFixed(4)}`);
    if (step.latencyMs > 0) parts.push(`${step.latencyMs}ms`);
    if (step.produces.length > 0) parts.push(`produces: ${step.produces.join(', ')}`);
    if (step.consumes.length > 0) parts.push(`consumes: ${step.consumes.join(', ')}`);
    if (step.alternatives && step.alternatives.length > 0) parts.push(`${step.alternatives.length} alternatives considered`);

    steps.push({
      index, depth, step, parentIndex, childIndices: [],
      breakpointHit,
      trace: parts.join(' '),
    });

    // Walk children
    for (const child of step.children) {
      const childIndex = steps.length; // will be the next index
      walk(child, depth + 1, index);
      steps[index].childIndices.push(childIndex);
    }
  };

  walk(proof.root, 0, null);

  const capSteps = steps.filter((s) => s.step.kind === 'CAPABILITY');
  const distinctProviders = new Set(capSteps.map((s) => s.step.entityId).filter(Boolean)).size;

  return {
    proofId: proof.id,
    goalName: proof.goalName,
    steps,
    breakpoints,
    breakpointHits,
    stats: {
      totalSteps: steps.length,
      capabilitySteps: capSteps.length,
      inputSteps: steps.filter((s) => s.step.kind === 'INPUT').length,
      settlementSteps: steps.filter((s) => s.step.kind === 'SETTLEMENT').length,
      goalSteps: steps.filter((s) => s.step.kind === 'GOAL').length,
      maxDepth,
      totalCost: proof.totalCost,
      totalLatencyMs: proof.totalLatencyMs,
      distinctProviders,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH DIFF VIEWER — compare state at two sequence numbers
// ═══════════════════════════════════════════════════════════════════════════

export interface GraphDiff {
  fromSeq: number;
  toSeq: number;
  nodesAdded: Array<{ id: string; kind: string; label: string }>;
  nodesRemoved: Array<{ id: string; kind: string; label: string }>;
  nodesVersioned: Array<{ oldId: string; newId: string; label: string; changes: Record<string, unknown> }>;
  relationshipsAdded: Array<{ id: string; from: string; to: string; type: string }>;
  relationshipsRemoved: Array<{ id: string; from: string; to: string; type: string }>;
  summary: {
    nodesAdded: number;
    nodesRemoved: number;
    nodesVersioned: number;
    relationshipsAdded: number;
    relationshipsRemoved: number;
    totalChanges: number;
  };
}

/**
 * Compare graph state at two sequence numbers. Shows what was added, removed,
 * or versioned (temporally updated) between the two points.
 */
export function diffGraph(fromSeq: number, toSeq: number): GraphDiff {
  const fromState = stateAtSeq(fromSeq);
  const toState = stateAtSeq(toSeq);

  const fromNodeIds = new Set(fromState.nodes.map((n) => n.id));
  const toNodeIds = new Set(toState.nodes.map((n) => n.id));

  const nodesAdded: GraphDiff['nodesAdded'] = [];
  for (const node of toState.nodes) {
    if (!fromNodeIds.has(node.id)) {
      nodesAdded.push({ id: node.id, kind: node.kind, label: node.label });
    }
  }

  const nodesRemoved: GraphDiff['nodesRemoved'] = [];
  for (const node of fromState.nodes) {
    if (!toNodeIds.has(node.id)) {
      nodesRemoved.push({ id: node.id, kind: node.kind, label: node.label });
    }
  }

  // Versioned nodes: nodes that exist in both but have different properties
  const nodesVersioned: GraphDiff['nodesVersioned'] = [];
  const fromNodesMap = new Map(fromState.nodes.map((n) => [n.id, n]));
  for (const toNode of toState.nodes) {
    const fromNode = fromNodesMap.get(toNode.id);
    if (fromNode) {
      // Compare properties
      const fromProps = JSON.stringify(fromNode.properties);
      const toProps = JSON.stringify(toNode.properties);
      if (fromProps !== toProps) {
        // Find changed keys
        const changes: Record<string, unknown> = {};
        for (const key of Object.keys(toNode.properties)) {
          if (JSON.stringify(fromNode.properties[key]) !== JSON.stringify(toNode.properties[key])) {
            changes[key] = { from: fromNode.properties[key], to: toNode.properties[key] };
          }
        }
        if (Object.keys(changes).length > 0) {
          nodesVersioned.push({ oldId: fromNode.previousVersionId ?? fromNode.id, newId: toNode.id, label: toNode.label, changes });
        }
      }
    }
  }

  // Relationships
  const fromRelIds = new Set(fromState.relationships.map((r) => r.id));
  const toRelIds = new Set(toState.relationships.map((r) => r.id));

  const relationshipsAdded: GraphDiff['relationshipsAdded'] = [];
  for (const rel of toState.relationships) {
    if (!fromRelIds.has(rel.id)) {
      relationshipsAdded.push({ id: rel.id, from: rel.from, to: rel.to, type: rel.type });
    }
  }

  const relationshipsRemoved: GraphDiff['relationshipsRemoved'] = [];
  for (const rel of fromState.relationships) {
    if (!toRelIds.has(rel.id)) {
      relationshipsRemoved.push({ id: rel.id, from: rel.from, to: rel.to, type: rel.type });
    }
  }

  return {
    fromSeq, toSeq,
    nodesAdded, nodesRemoved, nodesVersioned,
    relationshipsAdded, relationshipsRemoved,
    summary: {
      nodesAdded: nodesAdded.length,
      nodesRemoved: nodesRemoved.length,
      nodesVersioned: nodesVersioned.length,
      relationshipsAdded: relationshipsAdded.length,
      relationshipsRemoved: relationshipsRemoved.length,
      totalChanges: nodesAdded.length + nodesRemoved.length + nodesVersioned.length + relationshipsAdded.length + relationshipsRemoved.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POLICY SIMULATOR — simulate hypothetical policy changes without committing
// ═══════════════════════════════════════════════════════════════════════════

export interface PolicyChange {
  type: 'ADD' | 'MODIFY' | 'REMOVE';
  policyId?: string;           // for MODIFY/REMOVE
  capabilityId?: string;       // for ADD (which capability to constrain)
  rule?: string;               // for ADD/MODIFY
  enforcement?: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL'; // for ADD/MODIFY
  description?: string;        // for ADD/MODIFY
}

export interface PolicySimulationResult {
  change: PolicyChange;
  /** Goals that would PASS under the new policy. */
  goalsPassing: Array<{ goalId: string; goalName: string; proofId: string; certificateValid: boolean }>;
  /** Goals that would FAIL under the new policy. */
  goalsFailing: Array<{ goalId: string; goalName: string; reason: string }>;
  summary: {
    goalsTested: number;
    goalsPassing: number;
    goalsFailing: number;
    impact: string;
  };
  /** Whether the change was committed (always false for simulation). */
  committed: boolean;
}

/**
 * Simulate a hypothetical policy change. For each goal in the graph, re-prove
 * it under the hypothetical policy and report which would pass/fail.
 * Does NOT commit the change — this is "what if?" reasoning.
 */
export function simulatePolicyChange(change: PolicyChange): PolicySimulationResult {
  const goals = getGoals();
  const goalsPassing: PolicySimulationResult['goalsPassing'] = [];
  const goalsFailing: PolicySimulationResult['goalsFailing'] = [];

  // For simulation, we don't actually modify the graph. Instead, we check
  // whether each goal's proofs would be affected by the policy change.
  for (const goal of goals) {
    try {
      const proofs = prove(goal, goal.constraints ?? {});
      if (proofs.length === 0) {
        goalsFailing.push({ goalId: goal.id, goalName: goal.name, reason: 'No proof found (policy may block all paths)' });
        continue;
      }

      const bestProof = proofs[0];

      // Check if the policy change would affect this proof
      let wouldFail = false;
      let failReason = '';

      if (change.type === 'ADD' && change.capabilityId && change.enforcement === 'BLOCK') {
        // A new BLOCK policy on a capability — check if this proof uses that capability
        const allSteps: ProofStep[] = [];
        const collect = (s: ProofStep) => { allSteps.push(s); for (const c of s.children) collect(c); };
        collect(bestProof.root);
        const usesCapability = allSteps.some((n) => n.capabilityId === change.capabilityId);
        if (usesCapability) {
          wouldFail = true;
          failReason = `Proof uses capability ${change.capabilityId} which would be blocked by new policy "${change.rule ?? 'unknown'}"`;
        }
      }

      if (change.type === 'REMOVE' && change.policyId) {
        // Removing a policy might make previously-failing proofs pass — no impact on currently-passing ones
        // (This is a simplification — in reality removing a policy could have complex effects)
      }

      if (change.type === 'MODIFY' && change.policyId && change.enforcement === 'BLOCK') {
        // Tightening a policy to BLOCK — check if any capability in the proof is constrained by this policy
        const allSteps: ProofStep[] = [];
        const collect = (s: ProofStep) => { allSteps.push(s); for (const c of s.children) collect(c); };
        collect(bestProof.root);
        for (const node of allSteps) {
          if (!node.capabilityId) continue;
          const constrainedBy = ekg.getRelationshipsByType(node.capabilityId, 'CONSTRAINED_BY');
          if (constrainedBy.some((r) => r.to === change.policyId)) {
            wouldFail = true;
            failReason = `Proof uses capability ${node.capabilityName} which is constrained by policy ${change.policyId} (now BLOCK)`;
            break;
          }
        }
      }

      if (wouldFail) {
        goalsFailing.push({ goalId: goal.id, goalName: goal.name, reason: failReason });
      } else {
        // Issue a certificate to confirm it would still pass
        const cert = issueCertificate(bestProof, goal, goal.constraints ?? {});
        goalsPassing.push({ goalId: goal.id, goalName: goal.name, proofId: bestProof.id, certificateValid: cert.valid });
      }
    } catch (e) {
      goalsFailing.push({ goalId: goal.id, goalName: goal.name, reason: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  const impact = goalsFailing.length > 0
    ? `⚠️  ${goalsFailing.length} of ${goals.length} goals would FAIL under this policy change`
    : `✓ All ${goals.length} goals would still pass under this policy change`;

  return {
    change,
    goalsPassing,
    goalsFailing,
    summary: {
      goalsTested: goals.length,
      goalsPassing: goalsPassing.length,
      goalsFailing: goalsFailing.length,
      impact,
    },
    committed: false,
  };
}
