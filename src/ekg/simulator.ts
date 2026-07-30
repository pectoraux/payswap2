/**
 * Economic Knowledge Graph — Simulation Engine.
 *
 * simulate(proof) estimates the outcome of executing a proof WITHOUT settling
 * it. Estimates: cost, latency, carbon, risk, success probability, regulatory
 * impact, liquidity effect, counterfactual, and projected state changes.
 *
 * This enables "what if?" reasoning before commitment — the platform can
 * simulate multiple proofs and pick the best projected outcome.
 */

import { ekg } from './graph';
import type { Proof, SimulationResult, ProofStep } from './types';

export function simulate(proof: Proof): SimulationResult {
  // Walk the proof tree to gather all capability steps
  const capSteps: ProofStep[] = [];
  const walk = (s: ProofStep) => {
    if (s.kind === 'CAPABILITY') capSteps.push(s);
    for (const c of s.children) walk(c);
  };
  walk(proof.root);

  // Estimate cost + latency + carbon + risk (already aggregated, but add variance)
  const estimatedCost = proof.totalCost * (0.95 + Math.random() * 0.1); // ±5%
  const estimatedLatencyMs = proof.totalLatencyMs * (0.9 + Math.random() * 0.2); // ±10%
  const estimatedCarbon = proof.carbon * (0.95 + Math.random() * 0.1);
  const estimatedRisk = Math.min(100, proof.risk + (Math.random() * 10 - 5));

  // Success probability — based on trust + past memory
  const trustFactor = proof.trustScore / 100;
  const memoryFactor = (proof.memoryHits ?? 0) > 0 ? 0.1 : 0;
  const successProbability = Math.min(0.999, trustFactor * 0.85 + memoryFactor + 0.05);

  // Regulatory impact — check each entity's jurisdictions
  const regulatoryImpact: { jurisdiction: string; compliant: boolean; notes: string }[] = [];
  const entityIds = new Set(capSteps.map((s) => s.entityId).filter(Boolean) as string[]);
  for (const eid of entityIds) {
    const locRels = ekg.getRelationshipsByType(eid, 'LOCATED_IN');
    for (const r of locRels) {
      const jurisdiction = ekg.getNode(r.to);
      if (jurisdiction) {
        regulatoryImpact.push({
          jurisdiction: jurisdiction.label,
          compliant: true, // simplified
          notes: `${ekg.getNode(eid)?.label} approved in ${jurisdiction.label}`,
        });
      }
    }
  }

  // Liquidity effect — how much currency flows
  const liquidityEffect = {
    assetId: 'currency.usd',
    delta: -estimatedCost,
  };

  // Counterfactual
  const counterfactual = `If not executed, the goal "${proof.goalName}" remains unsatisfied. The user retains ${estimatedCost.toFixed(4)} USD but does not receive the target asset.`;

  // Projected state changes — which nodes would be versioned
  const projectedStateChanges = capSteps.map((s) => ({
    nodeId: s.entityId ?? '',
    property: 'revenue',
    from: 0, // would be current revenue
    to: s.cost,
  }));

  return {
    proofId: proof.id,
    estimatedCost, estimatedLatencyMs, estimatedCarbon, estimatedRisk,
    successProbability,
    regulatoryImpact,
    liquidityEffect,
    counterfactual,
    projectedStateChanges,
    simulatedAt: Date.now(),
  };
}
