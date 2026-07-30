/**
 * Economic Computation Platform — Verification + Learning Loop.
 *
 * Verification: every proof is checked for asset conservation, capability
 * satisfaction, trust, budget, deadline, carbon, policy, and jurisdiction.
 *
 * Learning Loop: after every execution, measure() records a structured memory
 * entry, then learn() recomputes provider scores. The next resolve() is better.
 *   resolve() → execute() → measure() → learn() → update scores → next resolve()
 */

import { uid } from '@/runtime/types';
import { platformStore, recomputeLearningScores } from './store';
import { verifyProof as verifyProofImpl } from './verifier';
import type { EconomicProof, Goal, ConstraintBundle, VerificationResult, EconomicMemoryRecord, ProviderLearningScore } from './types';

export { verifyProofImpl as verifyProof };

export interface ExecutionResult {
  proofId: string;
  goalId: string;
  goalName: string;
  status: 'SETTLED' | 'FAILED' | 'VERIFICATION_FAILED';
  verification: VerificationResult;
  memoryRecord: EconomicMemoryRecord;
  providerIds: string[];
  capabilityIds: string[];
  totalRevenue: number;
  totalCost: number;
  /** The learning delta — how many provider scores were updated. */
  learningUpdates: number;
  durationMs: number;
}

/**
 * Execute a proof: verify → settle → measure → learn.
 * The self-improving loop: every execution teaches the graph.
 */
export function executeProof(proof: EconomicProof, goal: Goal, constraints: ConstraintBundle = {}): ExecutionResult {
  const start = Date.now();

  // 1. Verify
  const verification = verifyProofImpl(proof, goal, constraints);
  proof.verification = verification;

  if (!verification.allPassed) {
    proof.status = 'verification_failed';
    // Record failure to memory so the planner learns to avoid this path
    const memRecord: EconomicMemoryRecord = {
      id: uid('mem'), goalId: goal.id, goalName: goal.name, proofId: proof.id,
      capabilities: proof.nodes.filter((n) => n.capabilityId).map((n) => n.capabilityId!) as string[],
      providers: proof.nodes.filter((n) => n.providerId).map((n) => n.providerId!) as string[],
      context: { jurisdiction: constraints.jurisdiction, region: constraints.region, riskLevel: verification.criticalFailures > 0 ? 80 : 40 },
      outcome: 'FAILURE', failureReason: `Verification failed: ${verification.criticalFailures} critical`,
      totalCost: proof.totalCost, totalLatencyMs: proof.totalLatencyMs, trustScore: proof.trustScore, carbon: proof.carbon,
      executedAt: Date.now(), durationMs: Date.now() - start,
    };
    platformStore.memory.unshift(memRecord);
    recomputeLearningScores();
    return {
      proofId: proof.id, goalId: goal.id, goalName: goal.name,
      status: 'VERIFICATION_FAILED', verification, memoryRecord: memRecord,
      providerIds: memRecord.providers, capabilityIds: memRecord.capabilities,
      totalRevenue: 0, totalCost: proof.totalCost, learningUpdates: platformStore.learningScores.size,
      durationMs: Date.now() - start,
    };
  }

  // 2. Settle — update provider P&L + reliability
  proof.status = 'settled';
  let totalRevenue = 0;
  const providerIds: string[] = [];
  const capabilityIds: string[] = [];
  for (const node of proof.nodes) {
    if (!node.providerId || !node.capabilityId) continue;
    const provider = platformStore.providers.get(node.providerId);
    if (!provider) continue;
    providerIds.push(provider.id);
    capabilityIds.push(node.capabilityId);
    const revenue = node.cost;
    provider.revenue += revenue;
    provider.invocations++;
    provider.successfulInvocations++;
    provider.reliabilityScore = Math.min(100, provider.reliabilityScore + 0.001);
    totalRevenue += revenue;
  }

  // 3. Measure — record structured memory
  const memRecord: EconomicMemoryRecord = {
    id: uid('mem'), goalId: goal.id, goalName: goal.name, proofId: proof.id,
    capabilities: capabilityIds, providers: providerIds,
    context: {
      jurisdiction: constraints.jurisdiction,
      region: constraints.region,
      timeOfDay: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening',
      seasonality: 'off-peak',
      riskLevel: Math.round(100 - proof.trustScore),
    },
    outcome: 'SUCCESS',
    totalCost: proof.totalCost, totalLatencyMs: proof.totalLatencyMs, trustScore: proof.trustScore, carbon: proof.carbon,
    customerSatisfaction: Math.round(70 + (proof.plannerScore * 0.25) + (proof.trustScore * 0.05)),
    executedAt: Date.now(), durationMs: Date.now() - start,
  };
  platformStore.memory.unshift(memRecord);
  if (platformStore.memory.length > 500) platformStore.memory.length = 500;

  // 4. Learn — recompute provider scores from all memory
  const learningUpdatesBefore = platformStore.learningScores.size;
  recomputeLearningScores();
  const learningUpdates = platformStore.learningScores.size - learningUpdatesBefore;

  return {
    proofId: proof.id, goalId: goal.id, goalName: goal.name,
    status: 'SETTLED', verification, memoryRecord: memRecord,
    providerIds, capabilityIds, totalRevenue, totalCost: proof.totalCost,
    learningUpdates, durationMs: Date.now() - start,
  };
}
