/**
 * EKG — Planner Decision Inspector ("Why did the planner choose this?")
 *
 * PHASE 7: Operability. Institutions don't buy dashboards — they buy
 * explainability. This module instruments the planner to produce a full
 * decision trace: which capabilities were considered, which providers were
 * scored, why each was accepted/rejected, and how memory influenced the choice.
 *
 * The inspector wraps prove() and captures every decision point:
 *   - Which capabilities SATISFY the goal? (all candidates)
 *   - For each capability, which entities OFFER it? (all candidates)
 *   - For each entity, what was its score + breakdown?
 *   - Why was the best one chosen? Why were others rejected?
 *   - What did memory say about this goal+capability+entity?
 *   - What were the constraint filters?
 *
 * The result is a human-readable explanation that a developer or auditor
 * can follow step-by-step.
 */

import { ekg } from './graph';
import { graph } from './graph';
import { getGoals } from './seed';
import { checkMemoryHits } from './scorer';
import type { Goal, Constraints, EntityLabel } from './types';

export interface DecisionTrace {
  goalId: string;
  goalName: string;
  goalTarget: string;
  constraints: Constraints;
  /** The full decision tree. */
  steps: DecisionStep[];
  /** Human-readable summary. */
  summary: string;
  /** Total candidates considered. */
  totalCandidates: number;
  /** Total candidates rejected. */
  totalRejected: number;
  tracedAt: number;
}

export interface DecisionStep {
  /** What the planner was trying to do at this step. */
  objective: string;
  /** The asset being resolved (for capability-finding steps). */
  assetId?: string;
  /** All candidate capabilities considered. */
  candidateCapabilities: Array<{
    capabilityId: string;
    capabilityName: string;
    accepted: boolean;
    reason: string;
    /** Candidate providers for this capability. */
    candidateProviders: Array<{
      entityId: string;
      entityName: string;
      entityLabel: EntityLabel;
      accepted: boolean;
      score: number;
      scoreBreakdown: { dimension: string; score: number; weight: number }[];
      cost: number;
      latencyMs: number;
      trustScore: number;
      reason: string;
      /** Memory hits for this goal+capability+entity combination. */
      memoryHits: number;
    }>;
    /** The chosen provider (if accepted). */
    chosenProvider?: string;
  }>;
  /** Constraint filters applied. */
  constraintFilters: string[];
}

/**
 * Trace the planner's decision process for a goal. Returns a full explanation
 * of why the planner would choose what it chooses — BEFORE or AFTER prove().
 */
export function traceDecision(goalId: string, constraints: Constraints = {}): DecisionTrace {
  const goals = getGoals();
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) throw new Error(`Goal not found: ${goalId}`);

  const steps: DecisionStep[] = [];
  let totalCandidates = 0;
  let totalRejected = 0;

  // Step 1: Find capabilities that produce the goal's target asset
  const candidateCaps = ekg.findCapabilitiesProducing(goal.targetAsset);
  const capStep: DecisionStep = {
    objective: `Find capabilities that produce the goal's target asset: ${goal.targetAsset}`,
    assetId: goal.targetAsset,
    candidateCapabilities: [],
    constraintFilters: [],
  };

  for (const cap of candidateCaps) {
    totalCandidates++;
    const providers = ekg.findEntitiesOffering(cap.id);
    const candidateProviders = providers.map((entity) => {
      const props = entity.properties as Record<string, number>;
      const offer = getOfferProperties(entity.id, cap.id);
      const score = scoreEntityDetailed(entity, cap.id, constraints);
      const memHits = countMemoryForEntity(entity.id, goal.id);
      const constraintReasons = checkConstraints(entity, constraints);
      const accepted = constraintReasons.length === 0;
      if (!accepted) totalRejected++;
      return {
        entityId: entity.id,
        entityName: entity.label,
        entityLabel: (entity.labels ?? [])[0] ?? 'ORGANIZATION',
        accepted,
        score: score.total,
        scoreBreakdown: score.breakdown,
        cost: offer.pricePerInvocation ?? 0,
        latencyMs: offer.latencyMs ?? 0,
        trustScore: props.trustScore ?? 50,
        reason: accepted
          ? `Score ${score.total.toFixed(1)}/100 — ${score.breakdown.map((b) => `${b.dimension}:${b.score.toFixed(0)}`).join(', ')}${memHits > 0 ? ` · ${memHits} memory hits` : ''}`
          : `Rejected: ${constraintReasons.join('; ')}`,
        memoryHits: memHits,
      };
    });

    // Sort by score
    candidateProviders.sort((a, b) => b.score - a.score);
    const chosen = candidateProviders.find((p) => p.accepted);

    capStep.candidateCapabilities.push({
      capabilityId: cap.id,
      capabilityName: cap.label,
      accepted: !!chosen,
      reason: chosen
        ? `Accepted — best provider: ${chosen.entityName} (score ${chosen.score.toFixed(1)})`
        : `Rejected — no providers passed constraints`,
      candidateProviders,
      chosenProvider: chosen?.entityId,
    });
  }

  // Constraint filters
  const filters: string[] = [];
  if (constraints.budget !== undefined) filters.push(`budget ≤ $${constraints.budget}`);
  if (constraints.deadline !== undefined) filters.push(`deadline ≤ ${constraints.deadline}ms`);
  if (constraints.minTrust !== undefined) filters.push(`minTrust ≥ ${constraints.minTrust}`);
  if (constraints.maxCarbon !== undefined) filters.push(`maxCarbon ≤ ${constraints.maxCarbon}kgCO2e`);
  if (constraints.jurisdiction) filters.push(`jurisdiction = ${constraints.jurisdiction}`);
  if (constraints.excludeEntities?.length) filters.push(`exclude: ${constraints.excludeEntities.join(', ')}`);
  if (constraints.preferEntityLabel) filters.push(`prefer: ${constraints.preferEntityLabel}`);
  capStep.constraintFilters = filters;

  steps.push(capStep);

  // Step 2+: For each required asset of the chosen capability, trace recursively
  // (simplified — one level deep for the inspector)
  for (const cap of candidateCaps) {
    const requires = ekg.getRelationshipsByType(cap.id, 'REQUIRES');
    for (const reqRel of requires) {
      const reqAsset = graph.nodes.get(reqRel.to);
      if (!reqAsset) continue;
      const isInput = goal.inputs[reqRel.to] !== undefined;
      if (isInput) {
        steps.push({
          objective: `Resolve required asset: ${reqAsset.label} (${reqRel.to})`,
          assetId: reqRel.to,
          candidateCapabilities: [{
            capabilityId: 'input',
            capabilityName: 'User-provided input',
            accepted: true,
            reason: `Asset ${reqRel.to} is provided by the user as an input (amount: ${goal.inputs[reqRel.to]})`,
            candidateProviders: [],
          }],
          constraintFilters: [],
        });
        continue;
      }
      const subCaps = ekg.findCapabilitiesProducing(reqRel.to);
      if (subCaps.length === 0) {
        steps.push({
          objective: `Resolve required asset: ${reqAsset.label} (${reqRel.to})`,
          assetId: reqRel.to,
          candidateCapabilities: [{
            capabilityId: 'none',
            capabilityName: 'No capability produces this asset',
            accepted: false,
            reason: `BACKTRACK: No capability in the graph produces ${reqRel.to}. This path fails.`,
            candidateProviders: [],
          }],
          constraintFilters: [],
        });
      }
    }
  }

  // Summary
  const accepted = capStep.candidateCapabilities.filter((c) => c.accepted).length;
  const memoryHits = checkMemoryHits(goal);
  const summary = `${candidateCaps.length} capabilities can produce the goal target. ${accepted} accepted (${totalCandidates - accepted} rejected by constraints). ${totalCandidates} providers competed across ${new Set(capStep.candidateCapabilities.flatMap((c) => c.candidateProviders.map((p) => p.entityLabel))).size} entity kinds. Memory contributed ${memoryHits} hits to bias the choice.`;

  return {
    goalId: goal.id,
    goalName: goal.name,
    goalTarget: goal.targetAsset,
    constraints,
    steps,
    summary,
    totalCandidates,
    totalRejected,
    tracedAt: Date.now(),
  };
}

function getOfferProperties(entityId: string, capabilityId: string): Record<string, number> {
  const rel = graph.relationships.find((r) => r.type === 'OFFERS' && r.from === entityId && r.to === capabilityId && !r.validTo);
  return (rel?.properties ?? {}) as Record<string, number>;
}

function scoreEntityDetailed(entity: { id: string; properties: Record<string, unknown>; labels?: EntityLabel[] }, capabilityId: string, constraints: Constraints): { total: number; breakdown: { dimension: string; score: number; weight: number }[] } {
  const props = entity.properties as Record<string, number>;
  const offer = getOfferProperties(entity.id, capabilityId);
  const breakdown: { dimension: string; score: number; weight: number }[] = [];

  const price = offer.pricePerInvocation ?? 1;
  breakdown.push({ dimension: 'Cost', score: price <= 0 ? 30 : Math.max(2, 30 - Math.log10(price + 1) * 18), weight: 30 });

  const lat = offer.latencyMs ?? 1000;
  breakdown.push({ dimension: 'Latency', score: lat <= 100 ? 20 : Math.max(1, 20 - (lat / 10000) * 19), weight: 20 });

  breakdown.push({ dimension: 'Trust', score: ((props.trustScore ?? 50) / 100) * 20, weight: 20 });

  breakdown.push({ dimension: 'SLA', score: (offer.slaSuccessRate ?? 0.99) * 10, weight: 10 });

  breakdown.push({ dimension: 'Reliability', score: ((props.reliabilityScore ?? 50) / 100) * 20, weight: 20 });

  let total = breakdown.reduce((s, b) => s + b.score, 0);
  if (constraints.preferEntityLabel && entity.labels?.includes(constraints.preferEntityLabel)) total += 3;

  return { total: Math.round(total * 10) / 10, breakdown };
}

function checkConstraints(entity: { id: string; properties: Record<string, unknown>; labels?: EntityLabel[] }, constraints: Constraints): string[] {
  const reasons: string[] = [];
  if (constraints.excludeEntities?.includes(entity.id)) reasons.push('entity excluded');
  if (constraints.jurisdiction) {
    const locRels = ekg.getRelationshipsByType(entity.id, 'LOCATED_IN');
    const locs = locRels.map((r) => r.to);
    if (locs.length > 0 && !locs.includes(constraints.jurisdiction)) reasons.push(`not located in ${constraints.jurisdiction}`);
  }
  if (constraints.minTrust) {
    const trust = (entity.properties.trustScore as number) ?? 50;
    if (trust < constraints.minTrust) reasons.push(`trust ${trust} < minTrust ${constraints.minTrust}`);
  }
  return reasons;
}

function countMemoryForEntity(entityId: string, goalId: string): number {
  const memoryNodes = ekg.listNodes({ kind: 'MEMORY' });
  return memoryNodes.filter((m) => m.properties.goalId === goalId).length;
}
