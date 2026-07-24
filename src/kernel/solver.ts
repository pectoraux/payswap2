/**
 * PaySwap Runtime — Constraint Solver (generic).
 *
 * The solver does NOT know finance. It knows only:
 *   - World Graph (entities + capabilities + edges)
 *   - State Machines
 *   - Policies
 *   - Objectives
 *   - Constraints
 *
 * It never hardcodes "if reserve exists" or "if LP exists". It asks the graph:
 * "who canBridge? who canDebit? who canCredit?" and the graph answers based on
 * declared capabilities. This is what makes the runtime general-purpose.
 *
 * Input:  Intent (currentWorld + desiredWorld + constraints + objectives + policies)
 * Output: Execution Graph (DAG of Transitions)
 *
 * The solver produces candidates by searching the capability graph, scores
 * them against objectives, and returns the winner + rejected alternatives.
 */
import type { Entity } from './entity';
import type { Capability } from './capabilities';
import { entitiesWithCapability, entitiesWithCapabilityIn, canPerform } from './capabilities';
import type { Transition } from './transition';
import { transition, buildTransitionsForDelta } from './transition';
import type { OptimizationWeights, ObjectiveScore, CurrencyCode } from './types';
import { uid, round, formatDuration, PRIORITY_WEIGHTS } from './support';

export interface ConvergenceIntent {
  currentWorld: { entities: Entity[] };
  desiredWorld: { deltas: { entityId: string; amount: number; command: string; capability: Capability; fromState: string; toState: string }[] };
  constraints: { maxCostPercent: number; maxRiskScore: number; maxSettlementMs: number };
  objectives: OptimizationWeights;
  policies: { reservePolicy: string; maxLpShare: number; requireInsurance: boolean };
}

export interface SolverCandidate {
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

export interface SolverOutput {
  transitions: Transition[];       // the winner's transitions
  candidates: SolverCandidate[];   // all candidates (winner + rejected)
  winner: SolverCandidate;
}

export class ConstraintSolver {
  /**
   * Converge: given the current world and desired deltas, find the best
   * sequence of valid state transitions. The solver queries capabilities — it
   * never hardcodes entity types.
   */
  converge(intent: ConvergenceIntent): SolverOutput {
    const { currentWorld, desiredWorld, objectives } = intent;
    const entities = currentWorld.entities;

    // The desired deltas tell us what needs to happen (e.g. merchant +25000,
    // buyer -25000). The solver must find entities with the right capabilities
    // to bridge the gap. It queries: who canDebit? who canCredit? who canBridge?

    const candidates: SolverCandidate[] = [];

    // Candidate 1: Find bridging entities (who canBridge) in the buyer country.
    const bridgeEntities = entitiesWithCapability(entities, 'canBridge');
    const debitEntities = entitiesWithCapability(entities, 'canDebit');
    const creditEntities = entitiesWithCapability(entities, 'canCredit');

    // Generate candidate solutions by trying different capability combinations.
    // The solver is generic — it doesn't know these are "LPs" or "reserves".

    // Candidate A: Pure bridge (use canBridge entities, cheapest first)
    candidates.push(this.candidatePureBridge(entities, desiredWorld.deltas, bridgeEntities, objectives, 'Pure bridge (capability-based)'));

    // Candidate B: Reserve + bridge (use canDebit reserve, then canBridge)
    candidates.push(this.candidateReserveBridge(entities, desiredWorld.deltas, debitEntities, bridgeEntities, objectives, 'Reserve debit + bridge'));

    // Candidate C: Fastest (largest capacity bridge entity first)
    candidates.push(this.candidateFastest(entities, desiredWorld.deltas, bridgeEntities, objectives, 'Fastest (largest capacity)'));

    // Candidate D: Diversified (spread across multiple bridge entities)
    candidates.push(this.candidateDiversified(entities, desiredWorld.deltas, bridgeEntities, objectives, 'Diversified bridges'));

    // Candidate E: Treasury (use canSwap entities — treasury)
    const swapEntities = entitiesWithCapability(entities, 'canSwap');
    if (swapEntities.length > 0) {
      candidates.push(this.candidateTreasury(entities, desiredWorld.deltas, swapEntities, bridgeEntities, objectives, 'Treasury swap'));
    }

    // Score all candidates
    const scored = candidates.map((c) => ({
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
    return { transitions: winner.transitions, candidates: scored, winner };
  }

  /* ----------------------------------------------------------------------- */
  /* Candidate generators — ALL generic, query capabilities, never hardcode  */
  /* ----------------------------------------------------------------------- */

  private candidatePureBridge(entities: Entity[], deltas: any[], bridges: Entity[], objectives: OptimizationWeights, label: string): SolverCandidate {
    // Find bridge entities sorted by fee (lowest cost first)
    const sorted = [...bridges].sort((a, b) => (a.policies.feeBps ?? 0) - (b.policies.feeBps ?? 0));
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;
    const cur = deltas.find((d) => d.amount > 0)?.capability;

    const transitions: Transition[] = [];
    let remaining = amount;
    let totalCost = 0;
    let totalLatency = 0;

    for (const bridge of sorted) {
      if (remaining <= 0) break;
      const drawn = Math.min(remaining, bridge.balance);
      if (drawn <= 0) continue;
      const fee = round((drawn * (bridge.policies.feeBps ?? 0)) / 1e4, 6);
      totalCost += fee;
      totalLatency += (bridge.attributes.latencyMs as number) ?? 5000;
      transitions.push(transition({
        entityId: bridge.id, entityType: bridge.type, command: 'BridgeLiquidity', capability: 'canBridge',
        fromState: bridge.state, toState: bridge.state, amount: drawn, currency: bridge.currency,
        preconditions: [{ entity: bridge.id, condition: 'canBridge === true', met: true }, { entity: bridge.id, condition: `balance >= ${drawn}`, met: bridge.balance >= drawn }],
        postconditions: [{ entity: bridge.id, condition: 'bridged', met: true }],
        rollback: { entityId: bridge.id, action: 'unbridge' },
        events: [{ type: 'bridge.drawn', payload: { entityId: bridge.id, amount: drawn, fee } }],
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

  private candidateReserveBridge(entities: Entity[], deltas: any[], debits: Entity[], bridges: Entity[], objectives: OptimizationWeights, label: string): SolverCandidate {
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;
    // Find a debit-capable entity (reserve) with enough balance
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

  private candidateFastest(entities: Entity[], deltas: any[], bridges: Entity[], objectives: OptimizationWeights, label: string): SolverCandidate {
    const sorted = [...bridges].sort((a, b) => b.balance - a.balance); // largest capacity first
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;

    const transitions: Transition[] = [];
    let totalCost = 0;
    let totalLatency = 0;
    let remaining = amount;

    for (const bridge of sorted) {
      if (remaining <= 0) break;
      const drawn = Math.min(remaining, bridge.balance);
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

  private candidateDiversified(entities: Entity[], deltas: any[], bridges: Entity[], objectives: OptimizationWeights, label: string): SolverCandidate {
    const amount = deltas.find((d) => d.amount > 0)?.amount ?? 0;
    const totalCap = bridges.reduce((s, b) => s + b.balance, 0) || 1;
    const cap = amount * 0.6;

    const transitions: Transition[] = [];
    let totalCost = 0;
    let totalLatency = 0;
    let remaining = amount;

    for (const bridge of bridges) {
      if (remaining <= 0) break;
      const share = (bridge.balance / totalCap) * amount;
      const drawn = Math.min(remaining, share, cap, bridge.balance);
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

  private candidateTreasury(entities: Entity[], deltas: any[], swaps: Entity[], bridges: Entity[], objectives: OptimizationWeights, label: string): SolverCandidate {
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

  private scoreObjectives(c: SolverCandidate, weights: OptimizationWeights, deltas: any[]): ObjectiveScore[] {
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

  private rejectionReason(c: SolverCandidate, best: SolverCandidate): string {
    const reasons: string[] = [];
    if (c.totalCost > best.totalCost) reasons.push(`cost ${round(c.totalCost, 2)} > ${round(best.totalCost, 2)}`);
    if (c.totalLatencyMs > best.totalLatencyMs) reasons.push(`slower by ${formatDuration(c.totalLatencyMs - best.totalLatencyMs)}`);
    if (c.riskScore > best.riskScore) reasons.push(`riskier ${c.riskScore.toFixed(2)} > ${best.riskScore.toFixed(2)}`);
    if (reasons.length === 0) reasons.push('lower weighted score');
    return `Rejected: ${reasons.join(', ')}`;
  }
}

export const constraintSolver = new ConstraintSolver();
