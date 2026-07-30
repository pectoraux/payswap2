/**
 * Economic Knowledge Graph — Proof Scorer + Memory lookup.
 */

import { ekg } from './graph';
import type { Goal, Constraints } from './types';

export function scoreProof(
  goal: Goal, cost: number, latency: number, trust: number, carbon: number, risk: number,
  constraints: Constraints,
): { score: number; breakdown: { dimension: string; score: number; weight: number }[] } {
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

  const riskScore = Math.max(0, 10 - (risk / 100) * 10);
  breakdown.push({ dimension: 'Risk', score: riskScore, weight: 10 });

  // Memory dimension — look up MEMORY nodes that LEARNED_FROM this goal
  const memoryHits = checkMemoryHits(goal);
  const memoryScore = memoryHits > 0 ? Math.min(20, 8 + memoryHits * 2) : 8;
  breakdown.push({ dimension: 'Memory', score: memoryScore, weight: 20 });

  const total = breakdown.reduce((s, b) => s + b.score, 0);
  return { score: Math.round(Math.max(0, Math.min(100, total)) * 10) / 10, breakdown };
}

export function checkMemoryHits(goal: Goal): number {
  // Count MEMORY nodes that reference this goal
  const memoryNodes = ekg.listNodes({ kind: 'MEMORY' });
  return memoryNodes.filter((m) => m.properties.goalId === goal.id).length;
}
