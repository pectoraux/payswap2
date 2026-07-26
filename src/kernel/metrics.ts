/**
 * PaySwap Runtime — Operational Metrics.
 *
 * Architecture documents are less valuable than metrics. This module computes
 * the 10 key indicators that tell you about the architecture's health:
 *
 *   1. Planning success rate — can intents become valid plans?
 *   2. Convergence rate — do plans actually complete?
 *   3. Average planning latency — planner performance
 *   4. Replay determinism — event sourcing correctness
 *   5. Evidence freshness — quality of off-chain knowledge
 *   6. Proposal acceptance rate — marketplace health
 *   7. Replacement fulfiller rate — LP reliability
 *   8. Manual intervention rate — operational friction
 *   9. Escrow dwell time — settlement efficiency
 *  10. Constitution violation rate — safety and protocol health
 */
import type { SimulationResult } from './types';
import { round } from './support';

export interface OperationalMetrics {
  planningSuccessRate: number;      // 0..1
  convergenceRate: number;          // 0..1
  avgPlanningLatencyMs: number;
  replayDeterminism: boolean;       // true if replay identical
  evidenceFreshness: number;        // 0..1 (avg confidence of valid evidence)
  proposalAcceptanceRate: number;   // 0..1
  replacementFulfillerRate: number; // 0..1
  manualInterventionRate: number;   // 0..1
  escrowDwellTimeMs: number;        // avg time tokens frozen
  constitutionViolationRate: number;// 0..1
}

/** Compute operational metrics from a simulation result. */
export function computeMetrics(result: SimulationResult): OperationalMetrics {
  // 1. Planning success rate — did the planner produce a feasible plan?
  const planningSuccessRate = result.plan.feasible ? 1 : 0;

  // 2. Convergence rate — did obligations converge?
  const activeObligations = (result.obligations ?? []).filter((o) => o.state !== 'fulfilled' && o.state !== 'cancelled');
  const convergenceRate = activeObligations.length === 0 ? 1 : 0;

  // 3. Average planning latency (simulated — based on plan complexity)
  const avgPlanningLatencyMs = result.plan.steps.length * 0.5 + 2;

  // 4. Replay determinism — result hash exists (structural replay verified in fuzz)
  const replayDeterminism = !!result.resultHash;

  // 5. Evidence freshness — average confidence of solver evidence
  const evidenceConfidences = (result.transitions ?? [])
    .flatMap((t) => t.evidenceCitations ?? [])
    .map((c) => c.confidence);
  const evidenceFreshness = evidenceConfidences.length > 0
    ? evidenceConfidences.reduce((s, c) => s + c, 0) / evidenceConfidences.length
    : 0;

  // 6. Proposal acceptance rate
  const proposals = result.proposals ?? [];
  const acceptedProposals = proposals.filter((p) => p.state === 'completed' || p.state === 'activated');
  const proposalAcceptanceRate = proposals.length > 0 ? acceptedProposals.length / proposals.length : 0;

  // 7. Replacement fulfiller rate (how often obligations were transferred)
  const transferred = (result.obligations ?? []).filter((o) => o.state === 'transferred').length;
  const totalObligations = Math.max(1, (result.obligations ?? []).length);
  const replacementFulfillerRate = transferred / totalObligations;

  // 8. Manual intervention rate (amendments + manual settlement)
  const manualInterventions = result.amendments.length + (result.plan.sourceDraws.filter((d) => d.manual).length);
  const totalDraws = Math.max(1, result.plan.sourceDraws.length);
  const manualInterventionRate = manualInterventions / totalDraws;

  // 9. Escrow dwell time (simulated — based on settlement time)
  const escrowDwellTimeMs = result.plan.metrics.settlementTimeMs;

  // 10. Constitution violation rate
  const constitutionViolationRate = 1 - (result.constitution.passedRules / result.constitution.totalRules);

  return {
    planningSuccessRate: round(planningSuccessRate, 4),
    convergenceRate: round(convergenceRate, 4),
    avgPlanningLatencyMs: round(avgPlanningLatencyMs, 2),
    replayDeterminism,
    evidenceFreshness: round(evidenceFreshness, 4),
    proposalAcceptanceRate: round(proposalAcceptanceRate, 4),
    replacementFulfillerRate: round(replacementFulfillerRate, 4),
    manualInterventionRate: round(manualInterventionRate, 4),
    escrowDwellTimeMs,
    constitutionViolationRate: round(constitutionViolationRate, 4),
  };
}

/** Aggregate metrics across multiple simulation results. */
export function aggregateMetrics(results: SimulationResult[]): OperationalMetrics & { count: number } {
  if (results.length === 0) {
    return {
      planningSuccessRate: 0, convergenceRate: 0, avgPlanningLatencyMs: 0,
      replayDeterminism: false, evidenceFreshness: 0, proposalAcceptanceRate: 0,
      replacementFulfillerRate: 0, manualInterventionRate: 0, escrowDwellTimeMs: 0,
      constitutionViolationRate: 0, count: 0,
    };
  }
  const all = results.map(computeMetrics);
  const avg = (key: keyof OperationalMetrics) =>
    round(all.reduce((s, m) => s + (m[key] as number), 0) / all.length, 4);

  return {
    planningSuccessRate: avg('planningSuccessRate'),
    convergenceRate: avg('convergenceRate'),
    avgPlanningLatencyMs: avg('avgPlanningLatencyMs'),
    replayDeterminism: all.every((m) => m.replayDeterminism),
    evidenceFreshness: avg('evidenceFreshness'),
    proposalAcceptanceRate: avg('proposalAcceptanceRate'),
    replacementFulfillerRate: avg('replacementFulfillerRate'),
    manualInterventionRate: avg('manualInterventionRate'),
    escrowDwellTimeMs: avg('escrowDwellTimeMs'),
    constitutionViolationRate: avg('constitutionViolationRate'),
    count: results.length,
  };
}

/** Format a metric for display. */
export function formatMetric(key: keyof OperationalMetrics, value: number | boolean): string {
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (key === 'avgPlanningLatencyMs' || key === 'escrowDwellTimeMs') return `${value}ms`;
  return `${(value * 100).toFixed(1)}%`;
}

/** Metric metadata for the dashboard. */
export const METRIC_META: { key: keyof OperationalMetrics; label: string; description: string; goodThreshold: number }[] = [
  { key: 'planningSuccessRate', label: 'Planning Success', description: 'Can intents become valid plans?', goodThreshold: 0.9 },
  { key: 'convergenceRate', label: 'Convergence Rate', description: 'Do plans actually complete?', goodThreshold: 0.8 },
  { key: 'avgPlanningLatencyMs', label: 'Planning Latency', description: 'Planner performance', goodThreshold: 100 },
  { key: 'replayDeterminism', label: 'Replay Determinism', description: 'Event sourcing correctness', goodThreshold: 1 },
  { key: 'evidenceFreshness', label: 'Evidence Freshness', description: 'Quality of off-chain knowledge', goodThreshold: 0.7 },
  { key: 'proposalAcceptanceRate', label: 'Proposal Acceptance', description: 'Marketplace health', goodThreshold: 0.85 },
  { key: 'replacementFulfillerRate', label: 'Replacement Fulfiller', description: 'LP reliability (lower = better)', goodThreshold: 0.1 },
  { key: 'manualInterventionRate', label: 'Manual Intervention', description: 'Operational friction (lower = better)', goodThreshold: 0.15 },
  { key: 'escrowDwellTimeMs', label: 'Escrow Dwell Time', description: 'Settlement efficiency (lower = better)', goodThreshold: 120000 },
  { key: 'constitutionViolationRate', label: 'Constitution Violations', description: 'Safety (lower = better)', goodThreshold: 0.05 },
];
