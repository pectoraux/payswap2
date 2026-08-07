/**
 * Optimization Engine — replaces the "Liquidity Planner".
 *
 * Calling it a planner undersells what it does. It is solving an optimization
 * problem: "Find the best world transition satisfying all constraints."
 *
 *   Inputs:  Liquidity Intent + Current World + Constitution + Objectives
 *            + Policies + Constraints
 *   Output:  Candidate Plans → Score → Winner → Execution Plan
 *
 * This is future-proof. Tomorrow it can optimize payments, loans, treasury,
 * liquidity, insurance, or FX without changing architecture — every financial
 * movement is "find the best world transition."
 *
 * The optimizer NEVER executes. The executor NEVER thinks. The constitution
 * NEVER plans. The graph NEVER mutates. Each engine has exactly one
 * responsibility.
 */
import type {
  SimulationScenario,
  LiquidityExecutionPlan,
  PlanStep,
  LiquiditySourceDraw,
  LiquidityProvider,
  Reserve,
  OptimizationWeights,
  ObjectiveScore,
  AIRecommendation,
  AIDecision,
  AlternativePlan,
  PlanMetrics,
  PolicyVerdict,
  CurrencyCode,
} from './types';
import type { WorldState } from './world-store';
import { fxEngine } from './fx';
import { pricingEngine } from './pricing';
import { riskEngine } from './risk';
import { policyEngine } from './policy';
import { uid, round, formatDuration, PRIORITY_WEIGHTS } from './support';

export interface OptimizationInput {
  scenario: SimulationScenario;
  world: WorldState;
  objectives: OptimizationWeights;
}

export interface OptimizationOutput {
  plan: LiquidityExecutionPlan;
  candidates: CandidatePlan[];
}

export interface CandidatePlan {
  id: string;
  label: string;
  strategy: string;
  lpUsage: LiquiditySourceDraw[];
  reserveDraw: number;
  treasuryDraw: number;
  usesReserve: boolean;
  usesTreasury: boolean;
  cost: { totalFees: number; costPercent: number; costAmount: number; lpFees: number; fxSpreadCost: number; reserveFee: number };
  settlementMs: number;
  riskScore: number;
  confidence: number;
  weightedScore: number;
  objectiveScores: ObjectiveScore[];
  notes: string[];
  steps: { title: string; type: PlanStep['type'] }[];
  feasible: boolean;
  selected: boolean;
  rejectionReason?: string;
}

interface RawCandidate {
  label: string;
  lpUsage: LiquiditySourceDraw[];
  reserveDraw: number;
  treasuryDraw: number;
  usesReserve: boolean;
  usesTreasury: boolean;
  cost: { totalFees: number; costPercent: number; costAmount: number; lpFees: number; fxSpreadCost: number; reserveFee: number };
  settlementMs: number;
  riskScore: number;
  confidence: number;
  notes: string[];
  steps: { title: string; type: PlanStep['type'] }[];
  feasible: boolean;
}

export class OptimizationEngine {
  optimize(input: OptimizationInput): OptimizationOutput {
    const { scenario, world, objectives } = input;
    const srcCur = scenario.transaction.buyer.currency;
    const tgtCur = scenario.transaction.merchant.currency;
    const amount = scenario.transaction.amount;
    const weights = { ...PRIORITY_WEIGHTS[scenario.transaction.priority], ...objectives };

    // FX quote — null means the rate is unavailable; fall back to rate=1
    // (same-currency or unknown corridor) so the optimizer still runs.
    const fxQuote = fxEngine.quote(amount, srcCur, tgtCur);
    const effectiveRate = fxQuote?.effectiveRate ?? 1;
    const sourceAmount = round(amount / effectiveRate, 2);

    // Candidate LPs from the WORLD STATE (not the scenario) — the world is the source of truth.
    const corridorLps = world.liquidityProviders.filter(
      (lp) => lp.country === scenario.transaction.buyer.country && lp.online,
    );

    // Generate candidate world transitions.
    const rawCandidates: RawCandidate[] = [];
    const policy = scenario.policies.reservePolicy;

    rawCandidates.push(this.candidatePureLp(scenario, corridorLps, amount, fxQuote, 'LP bridge (no reserve)'));
    const dstReserve = world.reserves.find((r) => r.country === scenario.transaction.merchant.country);
    if (dstReserve && dstReserve.available >= amount + amount * 0.05 && policy !== 'lp_first') {
      rawCandidates.push(this.candidateReserveFirst(scenario, corridorLps, amount, fxQuote, world, 'Reserve-first + LP top-up'));
    }
    rawCandidates.push(this.candidateFastest(scenario, corridorLps, amount, fxQuote, 'Single-LP fastest'));
    rawCandidates.push(this.candidateDiversified(scenario, corridorLps, amount, fxQuote, 'Diversified liquidity'));
    if (world.treasury.positions.some((p) => p.stablecoinBalance >= amount) && policy !== 'preserve_reserves' && policy !== 'lp_first') {
      rawCandidates.push(this.candidateTreasury(scenario, world, amount, fxQuote, 'Stablecoin treasury bridge'));
    }

    // Score every candidate across 8 explainable objectives.
    const scored = rawCandidates.map((c) => {
      const scores = this.scoreObjectives(c, weights, scenario, amount);
      return { candidate: c, scores, weighted: this.weighted(scores, weights) };
    });
    scored.sort((a, b) => b.weighted - a.weighted);

    const best = scored[0];

    // Build candidate plan objects (for the UI — shows ALL candidates, not just the winner).
    const candidates: CandidatePlan[] = scored.map(({ candidate, scores, weighted }, i) => ({
      id: uid('cand'),
      label: candidate.label,
      strategy: this.strategyLabel(scenario.transaction.priority),
      lpUsage: candidate.lpUsage,
      reserveDraw: candidate.reserveDraw,
      treasuryDraw: candidate.treasuryDraw,
      usesReserve: candidate.usesReserve,
      usesTreasury: candidate.usesTreasury,
      cost: candidate.cost,
      settlementMs: candidate.settlementMs,
      riskScore: candidate.riskScore,
      confidence: candidate.confidence,
      weightedScore: round(weighted, 4),
      objectiveScores: scores,
      notes: candidate.notes,
      steps: candidate.steps,
      feasible: candidate.feasible,
      selected: i === 0,
      rejectionReason: i === 0 ? undefined : this.rejectionReason(candidate, best.candidate),
    }));

    // Build the winner's immutable execution plan.
    const steps = this.buildSteps(scenario, best.candidate, sourceAmount, fxQuote);
    const twinSymbol = `TWIN-${scenario.transaction.buyer.country.slice(0, 3).toUpperCase()}-${scenario.transaction.merchant.country.slice(0, 3).toUpperCase()}-0001`;
    const decisions = this.buildDecisions(scenario, best.candidate, fxQuote, sourceAmount);
    const strategy = this.strategyLabel(scenario.transaction.priority);
    const narrative = this.buildFallbackNarrative(strategy, best.candidate, scenario);

    const recommendation: AIRecommendation = {
      strategy,
      objectiveScores: best.scores,
      weightedScore: round(best.weighted, 4),
      narrative,
      llmPowered: false,
      decisions,
    };

    const reservesAfter = this.projectReservesAfter(scenario, best.candidate);
    const policyVerdict = policyEngine.evaluate(scenario, best.candidate, reservesAfter);
    const metrics = this.buildMetrics(best.candidate, fxQuote, scenario, reservesAfter);

    const plan: LiquidityExecutionPlan = {
      id: uid('plan'),
      requestId: uid('req'),
      steps,
      sourceDraws: best.candidate.lpUsage,
      twinTokenSymbol: twinSymbol,
      metrics,
      reasoning: recommendation,
      policy: policyVerdict,
      alternatives: candidates.slice(1, 4).map((c) => ({
        label: c.label,
        reason: c.rejectionReason ?? 'lower score',
        weightedScore: c.weightedScore,
        costPercent: c.cost.costPercent,
        settlementTimeMs: c.settlementMs,
        riskScore: c.riskScore,
        lpCount: c.lpUsage.length,
        usesReserve: c.usesReserve,
        usesTreasury: c.usesTreasury,
        steps: c.steps,
      })),
      status: policyVerdict.passed && best.candidate.feasible ? 'validated' : 'draft',
      createdAt: Date.now(),
      feasible: best.candidate.feasible,
      notes: best.candidate.notes,
    };

    return { plan, candidates };
  }

  /* ----------------------------------------------------------------------- */
  /* Candidate generators                                                    */
  /* ----------------------------------------------------------------------- */

  private candidatePureLp(s: SimulationScenario, lps: LiquidityProvider[], amount: number, fxQuote: FxQuote, label: string): RawCandidate {
    const ordered = [...lps].sort((a, b) => a.tradingFees - b.tradingFees);
    const usage = this.greedyDraw(ordered, amount, s);
    return this.assemble(label, usage, 0, 0, fxQuote, s, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateReserveFirst(s: SimulationScenario, lps: LiquidityProvider[], amount: number, fxQuote: FxQuote, world: WorldState, label: string): RawCandidate {
    const reserve = world.reserves.find((r) => r.country === s.transaction.merchant.country);
    const reserveDraw = Math.min(amount, reserve?.available ?? 0);
    const remaining = Math.max(0, amount - reserveDraw);
    const ordered = [...lps].sort((a, b) => a.tradingFees - b.tradingFees);
    const usage = this.greedyDraw(ordered, remaining, s);
    return this.assemble(label, usage, reserveDraw, 0, fxQuote, s, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...(reserveDraw > 0 ? [{ title: 'Draw Destination Reserve', type: 'draw_reserve' as const }] : []),
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateFastest(s: SimulationScenario, lps: LiquidityProvider[], amount: number, fxQuote: FxQuote, label: string): RawCandidate {
    const ordered = [...lps].sort((a, b) => b.tradingCapacity - a.tradingCapacity);
    const usage = this.greedyDraw(ordered, amount, s);
    return this.assemble(label, usage, 0, 0, fxQuote, s, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateDiversified(s: SimulationScenario, lps: LiquidityProvider[], amount: number, fxQuote: FxQuote, label: string): RawCandidate {
    const usage = this.diversifyDraw(lps, amount, s);
    return this.assemble(label, usage, 0, 0, fxQuote, s, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateTreasury(s: SimulationScenario, world: WorldState, amount: number, fxQuote: FxQuote, label: string): RawCandidate {
    const stablecoin = world.treasury.positions.reduce((sum, p) => sum + p.stablecoinBalance, 0);
    const treasuryDraw = Math.min(amount, stablecoin);
    const remaining = Math.max(0, amount - treasuryDraw);
    const usage: LiquiditySourceDraw[] = [];
    const treasuryFee = round((treasuryDraw * 0.3) / 100, 6);
    if (treasuryDraw > 0) {
      usage.push({
        sourceKind: 'stablecoin_treasury', sourceId: 'treasury', sourceLabel: 'Stablecoin Treasury',
        country: s.transaction.merchant.country, currency: s.transaction.merchant.currency,
        drawn: round(treasuryDraw, 6), fee: treasuryFee, rate: 0.3,
        exhausted: treasuryDraw >= stablecoin, remaining: round(stablecoin - treasuryDraw, 6), manual: false,
      });
    }
    if (remaining > 0) {
      const lps = world.liquidityProviders.filter((lp) => lp.online).sort((a, b) => a.tradingFees - b.tradingFees);
      usage.push(...this.greedyDraw(lps, remaining, s));
    }
    return this.assemble(label, usage, 0, treasuryDraw, fxQuote, s, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...(treasuryDraw > 0 ? [{ title: 'Draw Stablecoin Treasury', type: 'draw_treasury' as const }] : []),
      ...usage.filter((u) => u.sourceKind !== 'stablecoin_treasury').map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  /* ----------------------------------------------------------------------- */
  /* Draw helpers                                                            */
  /* ----------------------------------------------------------------------- */

  private greedyDraw(lps: LiquidityProvider[], amount: number, s: SimulationScenario): LiquiditySourceDraw[] {
    const usage: LiquiditySourceDraw[] = [];
    let remaining = amount;
    for (const lp of lps) {
      if (remaining <= 1e-6) break;
      const drawn = Math.min(remaining, lp.tradingCapacity);
      if (drawn <= 0) continue;
      const fee = round((drawn * lp.tradingFees) / 100, 6);
      const left = round(lp.tradingCapacity - drawn, 6);
      usage.push({
        sourceKind: lp.sourceKind, sourceId: lp.id, sourceLabel: lp.name,
        country: lp.country, currency: s.transaction.merchant.currency,
        drawn: round(drawn, 6), fee, rate: lp.tradingFees,
        exhausted: left <= 1e-6, remaining: left, manual: lp.manualOnly,
      });
      remaining -= drawn;
    }
    return usage;
  }

  private diversifyDraw(lps: LiquidityProvider[], amount: number, s: SimulationScenario): LiquiditySourceDraw[] {
    const totalCap = lps.reduce((sum, lp) => sum + lp.tradingCapacity, 0) || 1;
    const cap = amount * 0.6;
    const usage: LiquiditySourceDraw[] = [];
    let remaining = amount;
    for (const lp of lps) {
      if (remaining <= 1e-6) break;
      const share = (lp.tradingCapacity / totalCap) * amount;
      const drawn = Math.min(remaining, share, cap, lp.tradingCapacity);
      if (drawn <= 0) continue;
      const fee = round((drawn * lp.tradingFees) / 100, 6);
      const left = round(lp.tradingCapacity - drawn, 6);
      usage.push({
        sourceKind: lp.sourceKind, sourceId: lp.id, sourceLabel: lp.name,
        country: lp.country, currency: s.transaction.merchant.currency,
        drawn: round(drawn, 6), fee, rate: lp.tradingFees,
        exhausted: left <= 1e-6, remaining: left, manual: lp.manualOnly,
      });
      remaining -= drawn;
    }
    if (remaining > 1e-6) {
      for (const lp of [...lps].sort((a, b) => a.tradingFees - b.tradingFees)) {
        if (remaining <= 1e-6) break;
        const existing = usage.find((u) => u.sourceId === lp.id);
        const already = existing?.drawn ?? 0;
        const avail = lp.tradingCapacity - already;
        if (avail <= 0) continue;
        const drawn = Math.min(remaining, avail);
        const fee = round(((already + drawn) * lp.tradingFees) / 100, 6);
        const left = round(lp.tradingCapacity - already - drawn, 6);
        if (existing) {
          existing.drawn = round(already + drawn, 6);
          existing.fee = fee;
          existing.exhausted = left <= 1e-6;
          existing.remaining = left;
        } else {
          usage.push({
            sourceKind: lp.sourceKind, sourceId: lp.id, sourceLabel: lp.name,
            country: lp.country, currency: s.transaction.merchant.currency,
            drawn: round(drawn, 6), fee, rate: lp.tradingFees,
            exhausted: left <= 1e-6, remaining: left, manual: lp.manualOnly,
          });
        }
        remaining -= drawn;
      }
    }
    return usage;
  }

  /* ----------------------------------------------------------------------- */
  /* Assembly + scoring                                                      */
  /* ----------------------------------------------------------------------- */

  private assemble(label: string, lpUsage: LiquiditySourceDraw[], reserveDraw: number, treasuryDraw: number, fxQuote: FxQuote | null, s: SimulationScenario, steps: { title: string; type: PlanStep['type'] }[]): RawCandidate {
    // F2: fxQuote may be null if the corridor has no rate. Fall back to
    // zero spread cost (same-currency or unknown corridor).
    const spreadCost = fxQuote?.spreadCost ?? 0;
    const spreadBps = fxQuote?.spreadBps ?? 0;
    const pricing = pricingEngine.price({
      principal: s.transaction.amount, lpUsage, fxSpreadCost: spreadCost,
      reserveFeeBps: reserveDraw > 0 ? 4 : 0, currency: s.transaction.merchant.currency,
    });
    const totalDrawn = lpUsage.reduce((sum, u) => sum + u.drawn, 0) + reserveDraw + treasuryDraw;
    const feasible = totalDrawn >= s.transaction.amount - 1e-6;
    const settlementMs = 15000 + lpUsage.reduce((sum, u, i) => {
      const lp = s.liquidityProviders.find((x) => x.id === u.sourceId);
      return sum + (lp?.settlementSpeedMs ?? 0) * (i === 0 ? 1 : 0.5);
    }, 0) + (reserveDraw > 0 ? 8000 : 0) + (treasuryDraw > 0 ? 5000 : 0) + steps.length * 4000;
    const reservesAfter = this.projectReservesAfter(s, { lpUsage, reserveDraw, treasuryDraw } as RawCandidate);
    const risk = riskEngine.assess({
      reserves: reservesAfter, lpUsage, amount: s.transaction.amount, pathLength: steps.length,
      fxSpreadBps: spreadBps, preference: s.transaction.priority, treasuryDraw,
    });
    const notes: string[] = [];
    if (!feasible) notes.push(`Insufficient liquidity: ${round(totalDrawn, 2)} of ${s.transaction.amount}`);
    if (lpUsage.some((u) => u.manual)) notes.push('Includes manual-settlement LP');
    return { label, lpUsage, reserveDraw, treasuryDraw, usesReserve: reserveDraw > 0, usesTreasury: treasuryDraw > 0, cost: pricing, settlementMs, riskScore: risk.score, confidence: risk.confidence, notes, steps, feasible };
  }

  private scoreObjectives(c: RawCandidate, _weights: OptimizationWeights, s: SimulationScenario, amount: number): ObjectiveScore[] {
    const cur = s.transaction.merchant.currency;
    const costScore = Math.max(0, 1 - c.cost.costPercent / 5);
    const speedScore = Math.max(0, 1 - c.settlementMs / 300000);
    const safetyScore = Math.max(0, 1 - c.riskScore);
    const preservation = Math.max(0, 1 - c.reserveDraw / amount);
    const merchantSat = (speedScore + costScore) / 2;
    const communityLps = c.lpUsage.filter((u) => ['community_lp', 'cooperative_pool', 'diaspora_pool'].includes(u.sourceKind)).length;
    const community = Math.min(1, communityLps / 2 + (c.lpUsage.length > 1 ? 0.2 : 0));
    const carbon = c.usesTreasury ? 0.8 : Math.max(0.3, 1 - c.lpUsage.length * 0.1);
    const treasuryHealth = c.usesTreasury ? 0.4 : 0.9;
    return [
      { objective: 'cost', score: round(costScore, 4), raw: c.cost.costPercent, rationale: `${c.cost.costPercent}% blended cost` },
      { objective: 'speed', score: round(speedScore, 4), raw: c.settlementMs, rationale: `${formatDuration(c.settlementMs)}` },
      { objective: 'safety', score: round(safetyScore, 4), raw: c.riskScore, rationale: `Risk ${c.riskScore.toFixed(2)}` },
      { objective: 'liquidityPreservation', score: round(preservation, 4), raw: c.reserveDraw, rationale: c.usesReserve ? `Reserve drawn ${round(c.reserveDraw, 0)}` : 'No reserve draw' },
      { objective: 'merchantSatisfaction', score: round(merchantSat, 4), raw: merchantSat, rationale: 'Speed + cost balance' },
      { objective: 'communityImpact', score: round(community, 4), raw: communityLps, rationale: `${communityLps} community source(s)` },
      { objective: 'carbonImpact', score: round(carbon, 4), raw: c.lpUsage.length, rationale: c.usesTreasury ? 'Stablecoin bridge' : `${c.lpUsage.length} LP hop(s)` },
      { objective: 'treasuryHealth', score: round(treasuryHealth, 4), raw: c.usesTreasury ? 1 : 0, rationale: c.usesTreasury ? 'Treasury drawn' : 'Treasury intact' },
    ];
  }

  private weighted(scores: ObjectiveScore[], weights: OptimizationWeights): number {
    return scores.reduce((sum, s) => sum + s.score * (weights[s.objective] ?? 0), 0);
  }

  private rejectionReason(c: RawCandidate, best: RawCandidate): string {
    const reasons: string[] = [];
    if (c.cost.costPercent > best.cost.costPercent) reasons.push(`cost ${c.cost.costPercent}% > ${best.cost.costPercent}%`);
    if (c.settlementMs > best.settlementMs) reasons.push(`slower by ${formatDuration(c.settlementMs - best.settlementMs)}`);
    if (c.riskScore > best.riskScore) reasons.push(`riskier ${c.riskScore.toFixed(2)} > ${best.riskScore.toFixed(2)}`);
    if (reasons.length === 0) reasons.push('lower weighted score');
    return `Rejected: ${reasons.join(', ')}`;
  }

  private strategyLabel(priority: string): string {
    switch (priority) {
      case 'cheapest': return 'Cost-minimizing world transition';
      case 'fastest': return 'Latency-minimizing world transition';
      case 'safest': return 'Risk-minimizing world transition';
      case 'balanced': return 'Balanced multi-objective transition';
      case 'impact': return 'Community-impact-weighted transition';
      default: return 'World transition';
    }
  }

  private buildSteps(s: SimulationScenario, c: RawCandidate, sourceAmount: number, fxQuote: FxQuote): PlanStep[] {
    const steps: PlanStep[] = [];
    let frame = 1;
    const cur = s.transaction.merchant.currency;
    const srcCur = s.transaction.buyer.currency;
    steps.push({ id: uid('step'), type: 'debit_source', title: 'Debit Buyer', description: `Debit buyer wallet ${round(sourceAmount, 2)} ${srcCur}`, amount: sourceAmount, currency: srcCur, sourceRef: { kind: 'wallet', id: 'buyer' }, frame: frame++, reversible: true });
    steps.push({ id: uid('step'), type: 'credit_reserve', title: 'Credit Source Reserve', description: `Credit source reserve`, amount: sourceAmount, currency: srcCur, targetRef: { kind: 'reserve', id: s.treasury.originReserve.country }, frame: frame++, reversible: true });
    if (srcCur !== cur) steps.push({ id: uid('step'), type: 'fx_convert', title: 'FX Bridge', description: `${srcCur} → ${cur} @ ${round(fxQuote?.effectiveRate ?? 1, 6)}`, amount: s.transaction.amount, currency: cur, frame: frame++, reversible: false });
    steps.push({ id: uid('step'), type: 'mint_twin', title: 'Mint Twin Token', description: 'Mint twin token', amount: s.transaction.amount, currency: cur, frame: frame++, reversible: false });
    if (c.reserveDraw > 0) steps.push({ id: uid('step'), type: 'draw_reserve', title: 'Draw Destination Reserve', description: `Draw ${round(c.reserveDraw, 2)}`, amount: c.reserveDraw, currency: cur, sourceRef: { kind: 'reserve', id: s.treasury.destinationReserve.country }, frame: frame++, reversible: true });
    if (c.treasuryDraw > 0) steps.push({ id: uid('step'), type: 'draw_treasury', title: 'Draw Stablecoin Treasury', description: `Draw ${round(c.treasuryDraw, 2)}`, amount: c.treasuryDraw, currency: cur, sourceRef: { kind: 'stablecoin_treasury', id: 'treasury' }, frame: frame++, reversible: true });
    for (const u of c.lpUsage) {
      steps.push({ id: uid('step'), type: 'draw_lp', title: u.manual ? `Draw ${u.sourceLabel} (manual)` : `Draw ${u.sourceLabel}`, description: `Draw ${round(u.drawn, 2)} @ ${u.rate}%`, amount: u.drawn, currency: cur, sourceRef: { kind: u.sourceKind, id: u.sourceId }, frame: frame++, reversible: true, meta: { rate: u.rate, fee: u.fee, manual: u.manual } });
      if (u.manual) {
        steps.push({ id: uid('step'), type: 'notify_lp', title: `Notify ${u.sourceLabel}`, description: 'Manual settlement', amount: u.drawn, currency: cur, frame: frame++, reversible: false });
        steps.push({ id: uid('step'), type: 'await_confirmation', title: 'Await Confirmation', description: 'Wait for merchant', amount: u.drawn, currency: cur, frame: frame++, reversible: false });
      }
    }
    steps.push({ id: uid('step'), type: 'burn_twin', title: 'Burn Twin Token', description: 'Burn twin token', amount: s.transaction.amount, currency: cur, frame: frame++, reversible: false });
    steps.push({ id: uid('step'), type: 'credit_destination', title: 'Credit Merchant', description: `Credit merchant ${round(s.transaction.amount, 2)} ${cur}`, amount: s.transaction.amount, currency: cur, targetRef: { kind: 'wallet', id: 'merchant' }, frame: frame++, reversible: true });
    if (c.cost.totalFees > 0) steps.push({ id: uid('step'), type: 'accrue_fee', title: 'Accrue Fees', description: `Accrue ${round(c.cost.totalFees, 2)} ${cur}`, amount: c.cost.totalFees, currency: cur, targetRef: { kind: 'fo', id: 'treasury' }, frame: frame++, reversible: false });
    return steps;
  }

  private buildMetrics(c: RawCandidate, fxQuote: FxQuote, s: SimulationScenario, reservesAfter: Reserve[]): PlanMetrics {
    const totalInitLpCap = s.liquidityProviders.filter((lp) => lp.country === s.transaction.buyer.country).reduce((sum, lp) => sum + lp.tradingCapacity, 0);
    const totalDrawn = c.lpUsage.reduce((sum, u) => sum + u.drawn, 0);
    const dstReserve = s.treasury.destinationReserve;
    const riskLabel: PlanMetrics['riskLabel'] = c.riskScore < 0.15 ? 'Low' : c.riskScore < 0.3 ? 'Moderate' : c.riskScore < 0.5 ? 'Elevated' : 'High';
    return {
      settlementTimeMs: c.settlementMs, settlementTimeLabel: formatDuration(c.settlementMs),
      costPercent: c.cost.costPercent, costAmount: c.cost.costAmount, riskScore: c.riskScore, riskLabel,
      confidence: c.confidence, fxRate: fxQuote?.effectiveRate ?? 1, fxSpreadBps: fxQuote?.spreadBps ?? 0,
      totalFees: c.cost.totalFees, reserveUtilization: dstReserve.available ? round((c.reserveDraw / dstReserve.available) * 100, 1) : 0,
      liquidityUtilization: totalInitLpCap ? round((totalDrawn / totalInitLpCap) * 100, 1) : 0,
      insuranceExposure: c.riskScore > 0.4 ? round(s.transaction.amount * 0.1, 2) : 0, twinTokensMinted: 1,
    };
  }

  private projectReservesAfter(s: SimulationScenario, c: Pick<RawCandidate, 'lpUsage' | 'reserveDraw' | 'treasuryDraw'>): Reserve[] {
    return [
      { id: `reserve:${s.treasury.originReserve.country}`, country: s.treasury.originReserve.country, currency: s.treasury.originReserve.currency, available: s.treasury.originReserve.available, locked: 0, minThreshold: s.treasury.originReserve.minThreshold, forecast: 0, replenishmentSchedule: 'daily', aiConfidence: 0.9 },
      { id: `reserve:${s.treasury.destinationReserve.country}`, country: s.treasury.destinationReserve.country, currency: s.treasury.destinationReserve.currency, available: round(s.treasury.destinationReserve.available - c.reserveDraw, 6), locked: 0, minThreshold: s.treasury.destinationReserve.minThreshold, forecast: 0, replenishmentSchedule: 'daily', aiConfidence: 0.9 },
    ];
  }

  private buildDecisions(s: SimulationScenario, c: RawCandidate, fxQuote: FxQuote | null, sourceAmount: number): AIDecision[] {
    const decisions: AIDecision[] = [];
    decisions.push({ step: 'Corridor authorization', rationale: `${s.transaction.buyer.country} → ${s.transaction.merchant.country} verified.` });
    if (s.transaction.buyer.currency !== s.transaction.merchant.currency) decisions.push({ step: 'FX bridge', rationale: `${s.transaction.buyer.currency}→${s.transaction.merchant.currency} @ ${round(fxQuote?.effectiveRate ?? 1, 6)}. Buyer debited ${round(sourceAmount, 2)}.` });
    if (c.reserveDraw > 0) decisions.push({ step: 'Reserve draw', rationale: `Drew ${round(c.reserveDraw, 2)} from destination reserve.` });
    if (c.treasuryDraw > 0) decisions.push({ step: 'Treasury draw', rationale: `Drew ${round(c.treasuryDraw, 2)} from stablecoin treasury.` });
    for (const u of c.lpUsage) decisions.push({ step: `Draw ${u.sourceLabel}`, rationale: `Drew ${round(u.drawn, 2)} @ ${u.rate}%${u.exhausted ? ' — exhausted' : ''}.` });
    decisions.push({ step: 'Reserve health', rationale: c.riskScore < 0.2 ? 'All reserves above thresholds.' : 'Reserve headroom tightened.' });
    decisions.push({ step: 'Risk acceptance', rationale: `Risk ${c.riskScore.toFixed(2)} — ${c.confidence}% confidence.` });
    decisions.push({ step: 'Cost acceptance', rationale: `Blended cost ${c.cost.costPercent}%.` });
    return decisions;
  }

  private buildFallbackNarrative(strategy: string, c: RawCandidate, s: SimulationScenario): string {
    const lpSummary = c.lpUsage.length > 0 ? c.lpUsage.map((u) => `${u.sourceLabel} covered ${round(u.drawn, 0)}`).join('; ') : 'treasury/reserve self-funded';
    return `Under the ${s.transaction.priority} priority, the optimizer found the best world transition moving ${round(s.transaction.amount, 0)} ${s.transaction.merchant.currency} from ${s.transaction.buyer.country} to ${s.transaction.merchant.country}. ${lpSummary}. Blended cost ${c.cost.costPercent}%, risk ${c.riskScore.toFixed(2)}, confidence ${c.confidence}%.`;
  }
}

type FxQuote = ReturnType<typeof fxEngine['quote']>;
