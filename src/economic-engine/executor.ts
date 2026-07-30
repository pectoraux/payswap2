/**
 * General-Purpose Economic Computation Engine — Execution + Memory Recording.
 *
 * Executes a verified proof: walks the graph topologically, invokes each
 * organization's capability (simulated), updates org P&L, and records the
 * outcome to economic memory so the planner learns for next time.
 */

import { uid } from '@/runtime/types';
import { engineStore } from './store';
import { verifyProof } from './verifier';
import type {
  EconomicProof, VerificationResult, MemoryEntry, ConstraintBundle, Goal, Strategy,
} from './types';

export interface ExecutionResult {
  proofId: string;
  goalId: string;
  goalName: string;
  strategy: Strategy;
  status: 'SETTLED' | 'FAILED' | 'VERIFICATION_FAILED';
  verification: VerificationResult;
  memoryEntry: MemoryEntry;
  organizationIds: string[];
  totalRevenue: number;
  totalCost: number;
  durationMs: number;
}

/**
 * Execute a proof: verify first, then settle, then record to memory.
 * The proof must pass verification before settlement.
 */
export function executeProof(proof: EconomicProof, goal: Goal, constraints: ConstraintBundle = {}): ExecutionResult {
  const start = Date.now();

  // 1. Verify
  const verification = verifyProof(proof, goal, constraints);
  proof.verification = verification;

  if (!verification.allPassed) {
    proof.status = 'verification_failed';
    const memEntry: MemoryEntry = {
      id: uid('mem'), goalId: goal.id, goalName: goal.name, strategy: proof.strategy,
      proofId: proof.id, organizationIds: proof.nodes.filter((n) => n.organizationId).map((n) => n.organizationId!) as string[],
      totalCost: proof.totalCost, totalLatencyMs: proof.totalLatencyMs, trustScore: proof.trustScore, carbon: proof.carbon,
      outcome: 'FAILURE', failureReason: `Verification failed: ${verification.criticalFailures} critical, ${verification.majorFailures} major`,
      executedAt: Date.now(), durationMs: Date.now() - start,
    };
    engineStore.memory.unshift(memEntry);
    return {
      proofId: proof.id, goalId: goal.id, goalName: goal.name, strategy: proof.strategy,
      status: 'VERIFICATION_FAILED', verification, memoryEntry: memEntry,
      organizationIds: memEntry.organizationIds, totalRevenue: 0, totalCost: proof.totalCost,
      durationMs: Date.now() - start,
    };
  }

  // 2. Settle — update org P&L for each participating organization
  proof.status = 'executing';
  let totalRevenue = 0;
  let totalCost = 0;
  const orgIds: string[] = [];
  for (const node of proof.nodes) {
    if (!node.organizationId) continue;
    const org = engineStore.organizations.get(node.organizationId);
    if (!org) continue;
    orgIds.push(org.id);
    const revenue = node.cost;
    const upstreamCost = node.cost * 0.4; // 40% margin cost
    org.revenue += revenue;
    org.costs += upstreamCost;
    org.profit = org.revenue - org.costs;
    org.invocations++;
    org.successfulInvocations++;
    org.treasury['currency.usd'] = (org.treasury['currency.usd'] ?? 0) + revenue - upstreamCost;
    // update objectives
    for (const obj of org.objectives) {
      if (obj.type === 'MAXIMIZE_REVENUE') obj.current = org.revenue;
      if (obj.type === 'MAXIMIZE_IMPACT') obj.current = org.invocations;
    }
    totalRevenue += revenue;
    totalCost += upstreamCost;
  }

  proof.status = 'settled';
  const durationMs = Date.now() - start;

  // 3. Record to economic memory
  const memEntry: MemoryEntry = {
    id: uid('mem'), goalId: goal.id, goalName: goal.name, strategy: proof.strategy,
    proofId: proof.id, organizationIds: orgIds,
    totalCost: proof.totalCost, totalLatencyMs: proof.totalLatencyMs, trustScore: proof.trustScore, carbon: proof.carbon,
    outcome: 'SUCCESS',
    customerSatisfaction: Math.round(70 + (proof.plannerScore * 0.25) + (proof.trustScore * 0.05)),
    executedAt: Date.now(), durationMs,
  };
  engineStore.memory.unshift(memEntry);
  if (engineStore.memory.length > 500) engineStore.memory.length = 500;

  return {
    proofId: proof.id, goalId: goal.id, goalName: goal.name, strategy: proof.strategy,
    status: 'SETTLED', verification, memoryEntry: memEntry,
    organizationIds: orgIds, totalRevenue, totalCost, durationMs,
  };
}
