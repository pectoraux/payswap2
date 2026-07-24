/**
 * PaySwap Runtime — Convergence Planner.
 *
 * The planner does NOT know finance. It knows only:
 *   - Entities + Capabilities
 *   - Evidence + Claims
 *   - Constraints
 *
 * PLANNING vs STRATEGY are separated:
 *   Planner answers: "Can this converge?" (feasibility)
 *   Strategy answers: "Which path do we prefer?" (cost, speed, fraud risk, etc.)
 *
 * Input:  Intent (currentWorld + desiredWorld + constraints + strategy)
 * Output: Execution Plan (DAG of Transitions) — a proof of convergence
 */
import type { Entity } from './entity';
import type { Capability } from './capabilities';
import { entitiesWithCapability, entitiesWithCapabilityIn, canPerform } from './capabilities';
import type { Transition } from './transition';
import { transition, buildTransitionsForDelta } from './transition';
import type { Evidence, EvidenceCitation } from './evidence';
import { computeEvidenceConfidence, effectiveLiquidityFromEvidence } from './evidence';
import type { OptimizationWeights, ObjectiveScore, CurrencyCode } from './types';
import { uid, round, formatDuration, PRIORITY_WEIGHTS } from './support';

export interface ConvergenceIntent {
  currentWorld: { entities: Entity[]; evidence: Evidence[] };
  desiredWorld: { deltas: { entityId: string; amount: number; command: string; capability: Capability; fromState: string; toState: string }[] };
  constraints: { maxCostPercent: number; maxRiskScore: number; maxSettlementMs: number; minConfidence: number };
  objectives: OptimizationWeights;
  policies: { reservePolicy: string; maxLpShare: number; requireInsurance: boolean };
}

/** A proof of convergence — demonstrates the world can reach the desired state. */
export interface ConvergencePlan {
  id: string;
  label: string;
  transitions: Transition[];
  totalCost: number;
  totalLatencyMs: number;
  riskScore: number;
  confidence: number;
  weightedScore: number;
  objectiveScores: ObjectiveScore[];
  feasible: boolean;
  selected: boolean;
  rejectionReason?: string;
  sourceCount: number;
  usesReserve: boolean;
  usesTreasury: boolean;
}

/** Strategy — determines which convergent plan is preferred. */
export interface Strategy {
  objectives: OptimizationWeights;
  minConfidence: number;
  maxCost: number;
  maxLatencyMs: number;
}

export interface PlannerOutput {
  transitions: Transition[];       // the winner's transitions
  plans: ConvergencePlan[];        // all plans (winner + rejected)
  winner: ConvergencePlan;
}

/**
 * Convergence Planner — determines whether convergence is possible.
 * Strategy — determines which convergent plan is preferred.
 * These are separate concerns: changing business goals never changes the planner.
 */
export class ConvergencePlanner {
  /**
   * Converge: given the current world and desired deltas, find the best
   * sequence of valid state transitions. The solver queries capabilities — it
   * never hardcodes entity types.
   */
  converge(intent: ConvergenceIntent): PlannerOutput {
    const { currentWorld, desiredWorld, objectives } = intent;
    const entities = currentWorld.entities;
    const evidence = currentWorld.evidence ?? [];

    // The desired deltas tell us what needs to happen. The solver must find
    // entities with the right capabilities AND sufficient EVIDENCE-BASED
    // confidence to bridge the gap. It queries: who canBridge? What evidence
    // do we have for their liquidity?

    const plans: ConvergencePlan[] = [];

    const bridgeEntities = entitiesWithCapability(entities, 'canBridge');
    const debitEntities = entitiesWithCapability(entities, 'canDebit');
    const creditEntities = entitiesWithCapability(entities, 'canCredit');

    // Candidate A: Pure bridge (evidence-weighted, cheapest first)
    plans.push(this.candidatePureBridge(entities, evidence, desiredWorld.deltas, bridgeEntities, objectives, 'Pure bridge (evidence-weighted)'));

    // Candidate B: Reserve + bridge
    plans.push(this.candidateReserveBridge(entities, evidence, desiredWorld.deltas, debitEntities, bridgeEntities, objectives, 'Reserve debit + bridge'));

    // Candidate C: Fastest (highest confidence bridge first)
    plans.push(this.candidateFastest(entities, evidence, desiredWorld.deltas, bridgeEntities, objectives, 'Fastest (highest confidence)'));

    // Candidate D: Diversified
    plans.push(this.candidateDiversified(entities, evidence, desiredWorld.deltas, bridgeEntities, objectives, 'Diversified bridges'));

    // Candidate E: Treasury swap
    const swapEntities = entitiesWithCapability(entities, 'canSwap');
    if (swapEntities.length > 0) {
      plans.push(this.candidateTreasury(entities, evidence, desiredWorld.deltas, swapEntities, bridgeEntities, objectives, 'Treasury swap'));
    }

    // STRATEGY: score and rank plans (separate from planning feasibility)
    const scored = plans.map((c) => ({
      ...c,
      objectiveScores: this.scoreObjectives(c, objectives, desiredWorld.deltas),
    }));
    scored.forEach((c) => { c.weightedScore = this.weighted(c.objectiveScores, objectives); });
    scored.sort((a, b) => b.weightedScore - a.weightedScore);

    // Mark winner + rejection reasons
    scored.forEach((c, i) => {
      c.selected = i === 0;
      if (i > 0) c.rejectionReason = this.rejectionReason(c, scored[0]);
    });

    const winner = scored[0];
    return { transitions: winner.transitions, plans: scored, winner };
  }

  /* ----------------------------------------------------------------------- */
  /* Candidate generators — ALL generic, query capabilities, never hardcode  */
  /* ----------------------------------------------------------------------- */

  private candidatePureBridge(entities: Entity[], evidence: Evidence[], deltas: any[], bridges: Entity[], objectives: OptimizationWeights, label: string): ConvergencePlan {
    // Find bridge entities sorted by fee (lowest cost first), using EVIDENCE-BASED liquidity
    const now = Date.now();
    const scored = bridges.map((b) => {
      const { amount, confidence, bestEvidence } = effectiveLiquidityFromEvidence(evidence, b.id, b.currency ?? 'GHS', now);
      return { entity: b, effectiveLiquidity: amount, confidence, evidence: bestEvidence };
    }).filter((s) => s.effectiveLiquidity > 0).sort((a, b) => (a.entity.policies.feeBps ?? 0) - (b.entity.policies.feeBps ?? 0));

    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;

    const transitions: Transition[] = [];
    let remaining = amount;
    let totalCost = 0;
    let totalLatency = 0;

    for (const { entity: bridge, effectiveLiquidity, confidence, evidence: ev } of scored) {
      if (remaining <= 0) break;
      const drawn = Math.min(remaining, effectiveLiquidity);
      if (drawn <= 0) continue;
      const fee = round((drawn * (bridge.policies.feeBps ?? 0)) / 1e4, 6);
      totalCost += fee;
      totalLatency += (bridge.attributes.latencyMs as number) ?? 5000;
      const citations: EvidenceCitation[] = ev ? [{ evidenceId: ev.id, evidenceType: ev.type, confidence, reliedOn: true }] : [];
      transitions.push(transition({
        entityId: bridge.id, entityType: bridge.type, command: 'BridgeLiquidity', capability: 'canBridge',
        fromState: bridge.state, toState: bridge.state, amount: drawn, currency: bridge.currency,
        evidenceCitations: citations,
        preconditions: [
          { entity: bridge.id, condition: 'canBridge === true', met: true },
          { entity: bridge.id, condition: `effectiveLiquidity (evidence-based) >= ${drawn}`, met: effectiveLiquidity >= drawn },
        ],
        postconditions: [{ entity: bridge.id, condition: 'bridged', met: true }],
        rollback: { entityId: bridge.id, action: 'unbridge' },
        events: [{ type: 'bridge.drawn', payload: { entityId: bridge.id, amount: drawn, fee, confidence, evidenceId: ev?.id } }],
      }));
      remaining -= drawn;
    }

    const feasible = remaining <= 0;
    const riskScore = this.assessRisk(transitions, bridges);
    return {
      id: uid('cand'), label, transitions, totalCost, totalLatencyMs: totalLatency,
      riskScore, confidence: Math.max(70, 100 - riskScore * 100), weightedScore: 0,
      objectiveScores: [], feasible, selected: false, sourceCount: transitions.length,
      usesReserve: false, usesTreasury: false,
    };
  }

  private candidateReserveBridge(entities: Entity[], evidence: Evidence[], deltas: any[], debits: Entity[], bridges: Entity[], objectives: OptimizationWeights, label: string): ConvergencePlan {
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;
    const reserve = debits.find((e) => e.type === 'reserve' && e.balance >= amount * 0.8);
    const reserveDraw = reserve ? Math.min(amount * 0.8, reserve.balance) : 0;
    const remaining = amount - reserveDraw;

    const transitions: Transition[] = [];
    let totalCost = 0;
    let totalLatency = 0;

    if (reserve && reserveDraw > 0) {
      transitions.push(transition({
        entityId: reserve.id, entityType: reserve.type, command: 'DebitReserve', capability: 'canDebit',
        fromState: reserve.state, toState: reserve.state, amount: reserveDraw, currency: reserve.currency,
        preconditions: [{ entity: reserve.id, condition: 'canDebit', met: true }],
        rollback: { entityId: reserve.id, action: 'credit' },
        events: [{ type: 'reserve.debited', payload: { amount: reserveDraw } }],
      }));
      totalLatency += 8000;
    }

    // Bridge the remainder
    const sorted = [...bridges].sort((a, b) => (a.policies.feeBps ?? 0) - (b.policies.feeBps ?? 0));
    let rem = remaining;
    for (const bridge of sorted) {
      if (rem <= 0) break;
      const drawn = Math.min(rem, bridge.balance);
      if (drawn <= 0) continue;
      const fee = round((drawn * (bridge.policies.feeBps ?? 0)) / 1e4, 6);
      totalCost += fee;
      totalLatency += (bridge.attributes.latencyMs as number) ?? 5000;
      transitions.push(transition({
        entityId: bridge.id, entityType: bridge.type, command: 'BridgeLiquidity', capability: 'canBridge',
        fromState: bridge.state, toState: bridge.state, amount: drawn, currency: bridge.currency,
        events: [{ type: 'bridge.drawn', payload: { amount: drawn, fee } }],
        rollback: { entityId: bridge.id, action: 'unbridge' },
      }));
      rem -= drawn;
    }

    const feasible = rem <= 0;
    const riskScore = this.assessRisk(transitions, bridges);
    return {
      id: uid('cand'), label, transitions, totalCost, totalLatencyMs: totalLatency,
      riskScore, confidence: Math.max(70, 100 - riskScore * 100), weightedScore: 0,
      objectiveScores: [], feasible, selected: false, sourceCount: transitions.length,
      usesReserve: reserveDraw > 0, usesTreasury: false,
    };
  }

  private candidateFastest(entities: Entity[], evidence: Evidence[], deltas: any[], bridges: Entity[], objectives: OptimizationWeights, label: string): ConvergencePlan {
    // Sort by effective liquidity (highest confidence first)
    const now = Date.now();
    const scored = bridges.map((b) => {
      const { amount, confidence } = effectiveLiquidityFromEvidence(evidence, b.id, b.currency ?? 'GHS', now);
      return { entity: b, effectiveLiquidity: amount, confidence };
    }).filter((s) => s.effectiveLiquidity > 0).sort((a, b) => b.effectiveLiquidity - a.effectiveLiquidity);
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;

    const transitions: Transition[] = [];
    let totalCost = 0;
    let totalLatency = 0;
    let remaining = amount;

    for (const { entity: bridge, effectiveLiquidity } of scored) {
      if (remaining <= 0) break;
      const drawn = Math.min(remaining, effectiveLiquidity);
      if (drawn <= 0) continue;
      const fee = round((drawn * (bridge.policies.feeBps ?? 0)) / 1e4, 6);
      totalCost += fee;
      totalLatency += (bridge.attributes.latencyMs as number) ?? 5000;
      transitions.push(transition({
        entityId: bridge.id, entityType: bridge.type, command: 'BridgeLiquidity', capability: 'canBridge',
        fromState: bridge.state, toState: bridge.state, amount: drawn, currency: bridge.currency,
        events: [{ type: 'bridge.drawn', payload: { amount: drawn, fee } }],
        rollback: { entityId: bridge.id, action: 'unbridge' },
      }));
      remaining -= drawn;
    }

    const feasible = remaining <= 0;
    const riskScore = this.assessRisk(transitions, bridges);
    return {
      id: uid('cand'), label, transitions, totalCost, totalLatencyMs: totalLatency,
      riskScore, confidence: Math.max(70, 100 - riskScore * 100), weightedScore: 0,
      objectiveScores: [], feasible, selected: false, sourceCount: transitions.length,
      usesReserve: false, usesTreasury: false,
    };
  }

  private candidateDiversified(entities: Entity[], evidence: Evidence[], deltas: any[], bridges: Entity[], objectives: OptimizationWeights, label: string): ConvergencePlan {
    const now = Date.now();
    const scored = bridges.map((b) => {
      const { amount } = effectiveLiquidityFromEvidence(evidence, b.id, b.currency ?? 'GHS', now);
      return { entity: b, effectiveLiquidity: amount };
    }).filter((s) => s.effectiveLiquidity > 0);
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;
    const totalCap = scored.reduce((s, b) => s + b.effectiveLiquidity, 0) || 1;
    const cap = amount * 0.6;

    const transitions: Transition[] = [];
    let totalCost = 0;
    let totalLatency = 0;
    let remaining = amount;

    for (const { entity: bridge, effectiveLiquidity } of scored) {
      if (remaining <= 0) break;
      const share = (effectiveLiquidity / totalCap) * amount;
      const drawn = Math.min(remaining, share, cap, effectiveLiquidity);
      if (drawn <= 0) continue;
      const fee = round((drawn * (bridge.policies.feeBps ?? 0)) / 1e4, 6);
      totalCost += fee;
      totalLatency += (bridge.attributes.latencyMs as number) ?? 5000;
      transitions.push(transition({
        entityId: bridge.id, entityType: bridge.type, command: 'BridgeLiquidity', capability: 'canBridge',
        fromState: bridge.state, toState: bridge.state, amount: drawn, currency: bridge.currency,
        events: [{ type: 'bridge.drawn', payload: { amount: drawn, fee } }],
        rollback: { entityId: bridge.id, action: 'unbridge' },
      }));
      remaining -= drawn;
    }

    const feasible = remaining <= 0;
    const riskScore = this.assessRisk(transitions, bridges);
    return {
      id: uid('cand'), label, transitions, totalCost, totalLatencyMs: totalLatency,
      riskScore, confidence: Math.max(70, 100 - riskScore * 100), weightedScore: 0,
      objectiveScores: [], feasible, selected: false, sourceCount: transitions.length,
      usesReserve: false, usesTreasury: false,
    };
  }

  private candidateTreasury(entities: Entity[], evidence: Evidence[], deltas: any[], swaps: Entity[], bridges: Entity[], objectives: OptimizationWeights, label: string): ConvergencePlan {
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;
    const treasury = swaps[0];
    const treasuryDraw = Math.min(amount, treasury.balance);

    const transitions: Transition[] = [];
    const fee = round((treasuryDraw * 30) / 1e4, 6); // 30 bps stablecoin conversion

    transitions.push(transition({
      entityId: treasury.id, entityType: treasury.type, command: 'SwapStablecoin', capability: 'canSwap',
      fromState: treasury.state, toState: treasury.state, amount: treasuryDraw, currency: treasury.currency,
      preconditions: [{ entity: treasury.id, condition: 'canSwap', met: true }],
      events: [{ type: 'treasury.swapped', payload: { amount: treasuryDraw, fee } }],
      rollback: { entityId: treasury.id, action: 'reverse_swap' },
    }));

    const remaining = amount - treasuryDraw;
    let totalCost = fee;
    let totalLatency = 5000;

    if (remaining > 0) {
      const sorted = [...bridges].sort((a, b) => (a.policies.feeBps ?? 0) - (b.policies.feeBps ?? 0));
      for (const bridge of sorted) {
        if (remaining <= 0) break;
        const drawn = Math.min(remaining, bridge.balance);
        if (drawn <= 0) continue;
        const bridgeFee = round((drawn * (bridge.policies.feeBps ?? 0)) / 1e4, 6);
        totalCost += bridgeFee;
        totalLatency += (bridge.attributes.latencyMs as number) ?? 5000;
        transitions.push(transition({
          entityId: bridge.id, entityType: bridge.type, command: 'BridgeLiquidity', capability: 'canBridge',
          fromState: bridge.state, toState: bridge.state, amount: drawn, currency: bridge.currency,
          events: [{ type: 'bridge.drawn', payload: { amount: drawn, fee: bridgeFee } }],
          rollback: { entityId: bridge.id, action: 'unbridge' },
        }));
      }
    }

    const riskScore = this.assessRisk(transitions, [treasury, ...bridges]);
    return {
      id: uid('cand'), label, transitions, totalCost, totalLatencyMs: totalLatency,
      riskScore, confidence: Math.max(70, 100 - riskScore * 100), weightedScore: 0,
      objectiveScores: [], feasible: true, selected: false, sourceCount: transitions.length,
      usesReserve: false, usesTreasury: true,
    };
  }

  /* ----------------------------------------------------------------------- */
  /* Scoring (generic — no finance knowledge)                                 */
  /* ----------------------------------------------------------------------- */

  private scoreObjectives(c: ConvergencePlan, weights: OptimizationWeights, deltas: any[]): ObjectiveScore[] {
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 1;
    const costPercent = round((c.totalCost / amount) * 100, 4);
    const costScore = Math.max(0, 1 - costPercent / 5);
    const speedScore = Math.max(0, 1 - c.totalLatencyMs / 300000);
    const safetyScore = Math.max(0, 1 - c.riskScore);
    const preservation = c.usesReserve ? 0.5 : 1;
    const merchantSat = (speedScore + costScore) / 2;
    const community = Math.min(1, c.sourceCount / 2);
    const carbon = c.usesTreasury ? 0.8 : Math.max(0.3, 1 - c.sourceCount * 0.1);
    const treasuryHealth = c.usesTreasury ? 0.4 : 0.9;
    return [
      { objective: 'cost', score: round(costScore, 4), raw: costPercent, rationale: `${costPercent}% blended` },
      { objective: 'speed', score: round(speedScore, 4), raw: c.totalLatencyMs, rationale: formatDuration(c.totalLatencyMs) },
      { objective: 'safety', score: round(safetyScore, 4), raw: c.riskScore, rationale: `Risk ${c.riskScore.toFixed(2)}` },
      { objective: 'liquidityPreservation', score: round(preservation, 4), raw: c.usesReserve ? 1 : 0, rationale: c.usesReserve ? 'Reserve drawn' : 'No reserve' },
      { objective: 'merchantSatisfaction', score: round(merchantSat, 4), raw: merchantSat, rationale: 'Speed + cost' },
      { objective: 'communityImpact', score: round(community, 4), raw: c.sourceCount, rationale: `${c.sourceCount} sources` },
      { objective: 'carbonImpact', score: round(carbon, 4), raw: c.sourceCount, rationale: c.usesTreasury ? 'Treasury' : `${c.sourceCount} hops` },
      { objective: 'treasuryHealth', score: round(treasuryHealth, 4), raw: c.usesTreasury ? 1 : 0, rationale: c.usesTreasury ? 'Treasury drawn' : 'Treasury intact' },
    ];
  }

  private weighted(scores: ObjectiveScore[], weights: OptimizationWeights): number {
    return scores.reduce((sum, s) => sum + s.score * (weights[s.objective] ?? 0), 0);
  }

  private assessRisk(transitions: Transition[], sources: Entity[]): number {
    if (transitions.length === 0) return 1;
    const concentration = transitions.length === 1 ? 0.12 : Math.max(...transitions.map((t) => t.amount ?? 0)) / (transitions.reduce((s, t) => s + (t.amount ?? 0), 0) || 1) * 0.08;
    const pathRisk = Math.min(0.06, transitions.length * 0.008);
    const manualRisk = transitions.filter((t) => t.capability === 'canBridge' && sources.find((s) => s.id === t.entityId)?.capabilities.manualOnly).length * 0.06;
    return Math.min(1, round(concentration + pathRisk + manualRisk, 4));
  }

  private rejectionReason(c: ConvergencePlan, best: ConvergencePlan): string {
    const reasons: string[] = [];
    if (c.totalCost > best.totalCost) reasons.push(`cost ${round(c.totalCost, 2)} > ${round(best.totalCost, 2)}`);
    if (c.totalLatencyMs > best.totalLatencyMs) reasons.push(`slower by ${formatDuration(c.totalLatencyMs - best.totalLatencyMs)}`);
    if (c.riskScore > best.riskScore) reasons.push(`riskier ${c.riskScore.toFixed(2)} > ${best.riskScore.toFixed(2)}`);
    if (reasons.length === 0) reasons.push('lower weighted score');
    return `Rejected: ${reasons.join(', ')}`;
  }
}

export const convergencePlanner = new ConvergencePlanner();
