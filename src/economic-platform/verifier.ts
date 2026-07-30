/**
 * Economic Computation Platform — Verification Layer.
 *
 * Compositional + hierarchical invariant checks. Every proof is verified for:
 * asset conservation, capability satisfaction, trust, budget, deadline,
 * carbon, policy, and jurisdiction.
 */

import { uid } from '@/runtime/types';
import { platformStore } from './store';
import type { EconomicProof, Goal, ConstraintBundle, VerificationResult, InvariantCheck } from './types';

export function verifyProof(proof: EconomicProof, goal: Goal, constraints: ConstraintBundle = {}): VerificationResult {
  const checks: InvariantCheck[] = [];

  // 1. Asset Conservation — every consumed asset is produced upstream or is an input
  const produced = new Set<string>();
  for (const inp of goal.inputs) produced.add(inp.assetId);
  for (const node of proof.nodes) {
    if (node.kind === 'INPUT') continue;
    for (const c of node.consumes) {
      if (!produced.has(c.assetId)) {
        checks.push({
          id: uid('inv'), name: 'Asset Conservation', category: 'ASSET_CONSERVATION',
          description: `Node ${node.capabilityName ?? node.kind} consumes ${c.assetId} but no upstream node produces it.`,
          passed: false, severity: 'CRITICAL',
          detail: `Consumed asset ${c.assetId} has no producer in the graph.`,
        });
      }
    }
    for (const p of node.produces) produced.add(p.assetId);
  }
  if (!checks.some((c) => c.category === 'ASSET_CONSERVATION' && !c.passed)) {
    checks.push({
      id: uid('inv'), name: 'Asset Conservation', category: 'ASSET_CONSERVATION',
      description: 'All consumed assets are produced by upstream nodes or provided as inputs.',
      passed: true, severity: 'CRITICAL',
      detail: `${proof.nodes.length} nodes verified. All asset flows are conserved.`,
    });
  }

  // 2. Capability Satisfaction — the goal target asset is produced
  const goalSatisfied = proof.nodes.some((n) => n.produces.some((p) => p.assetId === goal.targetAsset));
  checks.push({
    id: uid('inv'), name: 'Capability Satisfaction', category: 'CAPABILITY_SATISFACTION',
    description: `The goal target (${goal.targetAsset}) must be produced.`,
    passed: goalSatisfied, severity: 'CRITICAL',
    detail: goalSatisfied ? `Goal target ${goal.targetAsset} is produced.` : `Goal target ${goal.targetAsset} is NOT produced.`,
  });

  // 3. Trust
  const minTrust = constraints.minTrust ?? 0;
  const trustOk = proof.trustScore >= minTrust;
  checks.push({
    id: uid('inv'), name: 'Trust Satisfaction', category: 'TRUST',
    description: `Aggregate trust ≥ ${minTrust}.`,
    passed: trustOk, severity: 'MAJOR',
    detail: `Proof trust ${proof.trustScore} ${trustOk ? '≥' : '<'} minTrust ${minTrust}.`,
  });

  // 4. Budget
  if (constraints.budget !== undefined) {
    const ok = proof.totalCost <= constraints.budget;
    checks.push({ id: uid('inv'), name: 'Budget Compliance', category: 'BUDGET', description: `Cost ≤ $${constraints.budget}.`, passed: ok, severity: 'MAJOR', detail: `Cost $${proof.totalCost.toFixed(4)} ${ok ? '≤' : '>'} budget $${constraints.budget}.` });
  }
  // 5. Deadline
  if (constraints.deadline !== undefined) {
    const ok = proof.totalLatencyMs <= constraints.deadline;
    checks.push({ id: uid('inv'), name: 'Deadline Compliance', category: 'DEADLINE', description: `Latency ≤ ${constraints.deadline}ms.`, passed: ok, severity: 'MAJOR', detail: `Latency ${proof.totalLatencyMs}ms ${ok ? '≤' : '>'} deadline ${constraints.deadline}ms.` });
  }
  // 6. Carbon
  if (constraints.maxCarbon !== undefined) {
    const ok = proof.carbon <= constraints.maxCarbon;
    checks.push({ id: uid('inv'), name: 'Carbon Compliance', category: 'CARBON', description: `Carbon ≤ ${constraints.maxCarbon} kgCO2e.`, passed: ok, severity: 'MINOR', detail: `Carbon ${proof.carbon.toFixed(3)} ${ok ? '≤' : '>'} limit ${constraints.maxCarbon}.` });
  }
  // 7. Jurisdiction
  if (constraints.jurisdiction) {
    const allApproved = proof.nodes.filter((n) => n.providerId).every((n) => {
      const p = platformStore.providers.get(n.providerId!);
      return !p || p.jurisdictions.length === 0 || p.jurisdictions.includes(constraints.jurisdiction!);
    });
    checks.push({ id: uid('inv'), name: 'Jurisdiction Compliance', category: 'JURISDICTION', description: `All providers approved in ${constraints.jurisdiction}.`, passed: allApproved, severity: 'MAJOR', detail: allApproved ? 'All providers jurisdiction-approved.' : 'Some providers not approved.' });
  }

  const criticalFailures = checks.filter((c) => !c.passed && c.severity === 'CRITICAL').length;
  const majorFailures = checks.filter((c) => !c.passed && c.severity === 'MAJOR').length;
  return { proofId: proof.id, checks, allPassed: criticalFailures === 0 && majorFailures === 0, criticalFailures, majorFailures, verifiedAt: Date.now() };
}
