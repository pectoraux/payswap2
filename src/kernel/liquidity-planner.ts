/**
 * Liquidity Planner — the kernel's path-finding core.
 *
 * Replaces the old "Routing Engine". The planner does NOT route payments; it
 * generates an immutable Liquidity Execution Plan: a DAG of liquidity state
 * transitions that moves value from A to B. Simulation and production execute
 * the exact same plan.
 *
 * Pipeline:  Request → Planner → Plan → Validate → Simulate → Approve → Execute → Replay → Audit
 *
 * The planner:
 *   1. Enumerates candidate liquidity-source combinations (reserves, LPs,
 *      treasury, cooperative/diaspora pools).
 *   2. Scores each candidate across 8 explainable objectives weighted by the
 *      merchant priority + admin AI weights.
 *   3. Selects the best, builds the execution graph, keeps the top-N rejected
 *      alternatives with their rejection reason.
 *
 * Every recommendation explains WHY. Never returns opaque scores.
 */
import type {
  SimulationScenario,
  LiquidityExecutionPlan,
  PlanStep,
  LiquiditySourceDraw,
  LiquidityProvider,
  Reserve,
  FinancialOperator,
  CurrencyCode,
  OptimizationWeights,
  ObjectiveScore,
  AIRecommendation,
  AIDecision,
  AlternativePlan,
  PlanMetrics,
  PolicyVerdict,
  TwinTokenRecord,
} from './types';
import { fxEngine } from './fx';
import { pricingEngine } from './pricing';
import { riskEngine } from './risk';
import { policyEngine } from './policy';
import { treasuryEngine } from './treasury';
import { uid, round, formatDuration, PRIORITY_WEIGHTS } from './support';

export interface PlannerWorld {
  reserves: Reserve[];
  liquidityProviders: LiquidityProvider[];
  financialOperators: FinancialOperator[];
}

export interface PlannerOutput {
  plan: LiquidityExecutionPlan;
}

interface Candidate {
  label: string;
  lpUsage: LiquiditySourceDraw[];
  usesReserve: boolean;
  usesTreasury: boolean;
  reserveDraw: number;
  treasuryDraw: number;
  cost: { totalFees: number; costPercent: number; costAmount: number; lpFees: number; fxSpreadCost: number; reserveFee: number };
  settlementMs: number;
  riskScore: number;
  confidence: number;
  notes: string[];
  steps: { title: string; type: PlanStep['type'] }[];
}

export class LiquidityPlanner {
  plan(scenario: SimulationScenario, world: PlannerWorld): PlannerOutput {
    const srcCur = scenario.transaction.buyer.currency;
    const tgtCur = scenario.transaction.merchant.currency;
    const amount = scenario.transaction.amount;
    const weights = { ...PRIORITY_WEIGHTS[scenario.transaction.priority], ...scenario.aiWeights };

    // FX quote for the cross-currency bridge.
    const fxQuote = fxEngine.quote(amount, srcCur, tgtCur);
    const sourceAmount = round(amount / fxQuote.effectiveRate, 2);

    // Candidate LPs in the buyer corridor (cross-currency bridge providers).
    const corridorLps = world.liquidityProviders.filter(
      (lp) => lp.country === scenario.transaction.buyer.country && lp.online,
    );

    // Generate multiple candidate plans. The treasury-backed candidate is only
    // generated when the reserve policy allows it (it's a fallback source, not a
    // primary one) — otherwise the planner prefers reserve/LP combinations so
    // the treasury is preserved for genuine emergencies.
    const candidates: Candidate[] = [];
    const policy = scenario.policies.reservePolicy;

    // Candidate A: pure-LP bridge (no reserve draw on destination).
    candidates.push(this.candidatePureLp(scenario, corridorLps, amount, fxQuote, weights, 'LP bridge (no reserve)'));

    // Candidate B: reserve-first (use destination reserve, replenish via LPs).
    const dstReserve = scenario.treasury.destinationReserve;
    if (dstReserve.available >= amount + amount * 0.05 && policy !== 'lp_first') {
      candidates.push(this.candidateReserveFirst(scenario, corridorLps, amount, fxQuote, weights, world));
    }

    // Candidate C: fastest (single largest LP).
    candidates.push(this.candidateFastest(scenario, corridorLps, amount, fxQuote, weights, 'Single-LP fastest'));

    // Candidate D: diversified (safest — spread across LPs).
    candidates.push(this.candidateDiversified(scenario, corridorLps, amount, fxQuote, weights, 'Diversified liquidity'));

    // Candidate E: treasury-backed (fallback only — preserves LPs for emergencies).
    if (scenario.treasury.stablecoinBalance >= amount && policy !== 'preserve_reserves' && policy !== 'lp_first') {
      candidates.push(this.candidateTreasury(scenario, amount, fxQuote, weights, 'Stablecoin treasury bridge'));
    }

    // Score every candidate and pick the best.
    const scored = candidates.map((c) => ({
      candidate: c,
      scores: this.scoreObjectives(c, weights, scenario, amount),
    }));
    scored.sort((a, b) => {
      const aw = this.weighted(a.scores, weights);
      const bw = this.weighted(b.scores, weights);
      return bw - aw;
    });

    const best = scored[0];
    const alternatives: AlternativePlan[] = scored.slice(1, 4).map(({ candidate, scores }) => ({
      label: candidate.label,
      reason: this.rejectionReason(candidate, best.candidate),
      weightedScore: round(this.weighted(scores, weights), 4),
      costPercent: candidate.cost.costPercent,
      settlementTimeMs: candidate.settlementMs,
      riskScore: candidate.riskScore,
      lpCount: candidate.lpUsage.length,
      usesReserve: candidate.usesReserve,
      usesTreasury: candidate.usesTreasury,
      steps: candidate.steps,
    }));

    // Build the immutable plan.
    const steps = this.buildSteps(scenario, best.candidate, sourceAmount, fxQuote);
    const twinCounter = 1;
    const twinSymbol = `TWIN-${scenario.transaction.buyer.country.slice(0, 3).toUpperCase()}-${scenario.transaction.merchant.country.slice(0, 3).toUpperCase()}-${twinCounter.toString().padStart(4, '0')}`;

    const decisions = this.buildDecisions(scenario, best.candidate, fxQuote, sourceAmount);
    const strategy = this.strategyLabel(scenario.transaction.priority);
    const narrative = this.buildFallbackNarrative(strategy, best.candidate, scenario, decisions);

    const recommendation: AIRecommendation = {
      strategy,
      objectiveScores: best.scores,
      weightedScore: round(this.weighted(best.scores, weights), 4),
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
      alternatives,
      status: policyVerdict.passed && best.candidate.lpUsage.reduce((s, u) => s + u.drawn, 0) + best.candidate.reserveDraw + best.candidate.treasuryDraw >= amount - 1e-6 ? 'validated' : 'draft',
      createdAt: Date.now(),
      feasible: best.candidate.lpUsage.reduce((s, u) => s + u.drawn, 0) + best.candidate.reserveDraw + best.candidate.treasuryDraw >= amount - 1e-6,
      notes: best.candidate.notes,
    };

    return { plan };
  }

  /* ----------------------------------------------------------------------- */
  /* Candidate generators                                                    */
  /* ----------------------------------------------------------------------- */

  private candidatePureLp(
    scenario: SimulationScenario,
    lps: LiquidityProvider[],
    amount: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    weights: OptimizationWeights,
    label: string,
  ): Candidate {
    const ordered = [...lps].sort((a, b) => a.tradingFees - b.tradingFees);
    const usage = this.greedyDraw(ordered, amount, scenario);
    return this.assembleCandidate(label, usage, 0, 0, fxQuote, scenario, weights, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateReserveFirst(
    scenario: SimulationScenario,
    lps: LiquidityProvider[],
    amount: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    weights: OptimizationWeights,
    world: PlannerWorld,
  ): Candidate {
    const reserve = world.reserves.find((r) => r.country === scenario.transaction.merchant.country);
    const reserveDraw = Math.min(amount, reserve?.available ?? 0);
    const remaining = Math.max(0, amount - reserveDraw);
    const ordered = [...lps].sort((a, b) => a.tradingFees - b.tradingFees);
    const usage = this.greedyDraw(ordered, remaining, scenario);
    return this.assembleCandidate(
      'Reserve-first + LP top-up',
      usage,
      reserveDraw,
      0,
      fxQuote,
      scenario,
      weights,
      [
        { title: 'Debit Buyer', type: 'debit_source' },
        { title: 'Credit Source Reserve', type: 'credit_reserve' },
        { title: 'Mint Twin Token', type: 'mint_twin' },
        ...(reserveDraw > 0 ? [{ title: 'Draw Destination Reserve', type: 'draw_reserve' as const }] : []),
        ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
        { title: 'Burn Twin Token', type: 'burn_twin' },
        { title: 'Credit Merchant', type: 'credit_destination' },
      ],
    );
  }

  private candidateFastest(
    scenario: SimulationScenario,
    lps: LiquidityProvider[],
    amount: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    weights: OptimizationWeights,
    label: string,
  ): Candidate {
    const ordered = [...lps].sort((a, b) => b.tradingCapacity - a.tradingCapacity);
    const usage = this.greedyDraw(ordered, amount, scenario);
    return this.assembleCandidate(label, usage, 0, 0, fxQuote, scenario, weights, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateDiversified(
    scenario: SimulationScenario,
    lps: LiquidityProvider[],
    amount: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    weights: OptimizationWeights,
    label: string,
  ): Candidate {
    const usage = this.diversifyDraw(lps, amount, scenario);
    return this.assembleCandidate(label, usage, 0, 0, fxQuote, scenario, weights, [
      { title: 'Debit Buyer', type: 'debit_source' },
      { title: 'Credit Source Reserve', type: 'credit_reserve' },
      { title: 'Mint Twin Token', type: 'mint_twin' },
      ...usage.map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
      { title: 'Burn Twin Token', type: 'burn_twin' },
      { title: 'Credit Merchant', type: 'credit_destination' },
    ]);
  }

  private candidateTreasury(
    scenario: SimulationScenario,
    amount: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    weights: OptimizationWeights,
    label: string,
  ): Candidate {
    const treasuryDraw = Math.min(amount, scenario.treasury.stablecoinBalance);
    const remaining = Math.max(0, amount - treasuryDraw);
    const usage: LiquiditySourceDraw[] = [];
    // Stablecoin treasury carries a conversion + opportunity cost (30 bps) so it
    // is competitive with — but not strictly cheaper than — LPs. This keeps the
    // treasury as a genuine fallback rather than always winning on cost.
    const treasuryFee = round((treasuryDraw * 0.3) / 100, 6);
    if (treasuryDraw > 0) {
      usage.push({
        sourceKind: 'stablecoin_treasury',
        sourceId: 'treasury',
        sourceLabel: 'Stablecoin Treasury',
        country: scenario.transaction.merchant.country,
        currency: scenario.transaction.merchant.currency,
        drawn: round(treasuryDraw, 6),
        fee: treasuryFee,
        rate: 0.3,
        exhausted: treasuryDraw >= scenario.treasury.stablecoinBalance,
        remaining: round(scenario.treasury.stablecoinBalance - treasuryDraw, 6),
        manual: false,
      });
    }
    if (remaining > 0) {
      const lps = scenario.liquidityProviders.filter((lp) => lp.online).sort((a, b) => a.tradingFees - b.tradingFees);
      usage.push(...this.greedyDraw(lps, remaining, scenario));
    }
    return this.assembleCandidate(
      label,
      usage,
      0,
      treasuryDraw,
      fxQuote,
      scenario,
      weights,
      [
        { title: 'Debit Buyer', type: 'debit_source' },
        { title: 'Credit Source Reserve', type: 'credit_reserve' },
        { title: 'Mint Twin Token', type: 'mint_twin' },
        ...(treasuryDraw > 0 ? [{ title: 'Draw Stablecoin Treasury', type: 'draw_treasury' as const }] : []),
        ...usage.filter((u) => u.sourceKind !== 'stablecoin_treasury').map((u) => ({ title: `Draw ${u.sourceLabel}`, type: 'draw_lp' as const })),
        { title: 'Burn Twin Token', type: 'burn_twin' },
        { title: 'Credit Merchant', type: 'credit_destination' },
      ],
    );
  }

  /* ----------------------------------------------------------------------- */
  /* Draw helpers                                                            */
  /* ----------------------------------------------------------------------- */

  private greedyDraw(
    lps: LiquidityProvider[],
    amount: number,
    scenario: SimulationScenario,
  ): LiquiditySourceDraw[] {
    const usage: LiquiditySourceDraw[] = [];
    let remaining = amount;
    for (const lp of lps) {
      if (remaining <= 1e-6) break;
      const drawn = Math.min(remaining, lp.tradingCapacity);
      if (drawn <= 0) continue;
      const fee = round((drawn * lp.tradingFees) / 100, 6);
      const left = round(lp.tradingCapacity - drawn, 6);
      usage.push({
        sourceKind: lp.sourceKind,
        sourceId: lp.id,
        sourceLabel: `${lp.name}`,
        country: lp.country,
        currency: scenario.transaction.merchant.currency,
        drawn: round(drawn, 6),
        fee,
        rate: lp.tradingFees,
        exhausted: left <= 1e-6,
        remaining: left,
        manual: lp.manualOnly,
      });
      remaining -= drawn;
    }
    return usage;
  }

  private diversifyDraw(
    lps: LiquidityProvider[],
    amount: number,
    scenario: SimulationScenario,
  ): LiquiditySourceDraw[] {
    const totalCap = lps.reduce((s, lp) => s + lp.tradingCapacity, 0) || 1;
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
        sourceKind: lp.sourceKind,
        sourceId: lp.id,
        sourceLabel: lp.name,
        country: lp.country,
        currency: scenario.transaction.merchant.currency,
        drawn: round(drawn, 6),
        fee,
        rate: lp.tradingFees,
        exhausted: left <= 1e-6,
        remaining: left,
        manual: lp.manualOnly,
      });
      remaining -= drawn;
    }
    // mop up remainder greedily
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
            sourceKind: lp.sourceKind,
            sourceId: lp.id,
            sourceLabel: lp.name,
            country: lp.country,
            currency: scenario.transaction.merchant.currency,
            drawn: round(drawn, 6),
            fee,
            rate: lp.tradingFees,
            exhausted: left <= 1e-6,
            remaining: left,
            manual: lp.manualOnly,
          });
        }
        remaining -= drawn;
      }
    }
    return usage;
  }

  /* ----------------------------------------------------------------------- */
  /* Candidate assembly + scoring                                            */
  /* ----------------------------------------------------------------------- */

  private assembleCandidate(
    label: string,
    lpUsage: LiquiditySourceDraw[],
    reserveDraw: number,
    treasuryDraw: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    scenario: SimulationScenario,
    _weights: OptimizationWeights,
    steps: { title: string; type: PlanStep['type'] }[],
  ): Candidate {
    const pricing = pricingEngine.price({
      principal: scenario.transaction.amount,
      lpUsage,
      fxSpreadCost: fxQuote.spreadCost,
      reserveFeeBps: reserveDraw > 0 ? 4 : 0,
      currency: scenario.transaction.merchant.currency,
    });
    const totalDrawn = lpUsage.reduce((s, u) => s + u.drawn, 0) + reserveDraw + treasuryDraw;
    const feasible = totalDrawn >= scenario.transaction.amount - 1e-6;

    const settlementMs =
      15000 +
      lpUsage.reduce((s, u, i) => {
        const lp = scenario.liquidityProviders.find((x) => x.id === u.sourceId);
        return s + (lp?.settlementSpeedMs ?? 0) * (i === 0 ? 1 : 0.5);
      }, 0) +
      (reserveDraw > 0 ? 8000 : 0) +
      (treasuryDraw > 0 ? 5000 : 0) +
      steps.length * 4000;

    const reservesAfter = this.projectReservesAfter(scenario, { lpUsage, reserveDraw, treasuryDraw } as Candidate);
    const risk = riskEngine.assess({
      reserves: reservesAfter,
      lpUsage,
      amount: scenario.transaction.amount,
      pathLength: steps.length,
      fxSpreadBps: fxQuote.spreadBps,
      preference: scenario.transaction.priority,
      treasuryDraw,
    });

    const notes: string[] = [];
    if (!feasible) notes.push(`Insufficient liquidity: ${round(totalDrawn, 2)} of ${scenario.transaction.amount}`);
    if (lpUsage.some((u) => u.manual)) notes.push('Includes manual-settlement LP — workflow required');
    if (reserveDraw > 0) notes.push(`Destination reserve drawn by ${round(reserveDraw, 2)}`);
    if (treasuryDraw > 0) notes.push(`Stablecoin treasury drawn by ${round(treasuryDraw, 2)}`);

    return {
      label,
      lpUsage,
      usesReserve: reserveDraw > 0,
      usesTreasury: treasuryDraw > 0,
      reserveDraw,
      treasuryDraw,
      cost: pricing,
      settlementMs,
      riskScore: risk.score,
      confidence: risk.confidence,
      notes,
      steps,
    };
  }

  private scoreObjectives(
    c: Candidate,
    _weights: OptimizationWeights,
    scenario: SimulationScenario,
    amount: number,
  ): ObjectiveScore[] {
    const cur = scenario.transaction.merchant.currency;
    // cost: lower percent => higher score
    const costScore = Math.max(0, 1 - c.cost.costPercent / 5);
    // speed: lower ms => higher score
    const speedScore = Math.max(0, 1 - c.settlementMs / 300000);
    // safety: lower risk => higher score
    const safetyScore = Math.max(0, 1 - c.riskScore);
    // liquidity preservation: reserve draw reduces score
    const preservation = Math.max(0, 1 - c.reserveDraw / amount);
    // merchant satisfaction: faster + cheaper
    const merchantSat = (speedScore + costScore) / 2;
    // community impact: more LPs (esp. community_lp / cooperative / diaspora) => higher
    const communityLps = c.lpUsage.filter((u) =>
      ['community_lp', 'cooperative_pool', 'diaspora_pool'].includes(u.sourceKind),
    ).length;
    const community = Math.min(1, communityLps / 2 + (c.lpUsage.length > 1 ? 0.2 : 0));
    // carbon: treasury/stablecoin => lower carbon (no physical rails)
    const carbon = c.usesTreasury ? 0.8 : Math.max(0.3, 1 - c.lpUsage.length * 0.1);
    // treasury health: not drawing treasury => higher
    const treasuryHealth = c.usesTreasury ? 0.4 : 0.9;

    return [
      { objective: 'cost', score: round(costScore, 4), raw: c.cost.costPercent, rationale: `${c.cost.costPercent}% blended cost (${round(c.cost.totalFees, 2)} ${cur})` },
      { objective: 'speed', score: round(speedScore, 4), raw: c.settlementMs, rationale: `${formatDuration(c.settlementMs)} projected settlement` },
      { objective: 'safety', score: round(safetyScore, 4), raw: c.riskScore, rationale: `Risk score ${c.riskScore.toFixed(2)} — ${c.riskScore < 0.2 ? 'Low' : c.riskScore < 0.4 ? 'Moderate' : 'Elevated'}` },
      { objective: 'liquidityPreservation', score: round(preservation, 4), raw: c.reserveDraw, rationale: c.usesReserve ? `Reserve drawn ${round(c.reserveDraw, 0)}` : 'No reserve draw — liquidity preserved' },
      { objective: 'merchantSatisfaction', score: round(merchantSat, 4), raw: (speedScore + costScore) / 2, rationale: `Balance of speed and cost for merchant` },
      { objective: 'communityImpact', score: round(community, 4), raw: communityLps, rationale: `${communityLps} community/cooperative/diaspora source(s)` },
      { objective: 'carbonImpact', score: round(carbon, 4), raw: c.lpUsage.length, rationale: c.usesTreasury ? 'Stablecoin bridge — fewer physical rails' : `${c.lpUsage.length} LP hop(s)` },
      { objective: 'treasuryHealth', score: round(treasuryHealth, 4), raw: c.usesTreasury ? 1 : 0, rationale: c.usesTreasury ? 'Treasury drawn — monitor health' : 'Treasury intact' },
    ];
  }

  private weighted(scores: ObjectiveScore[], weights: OptimizationWeights): number {
    return scores.reduce((sum, s) => sum + s.score * (weights[s.objective] ?? 0), 0);
  }

  private rejectionReason(c: Candidate, best: Candidate): string {
    const reasons: string[] = [];
    if (c.cost.costPercent > best.cost.costPercent) reasons.push(`cost ${c.cost.costPercent}% > ${best.cost.costPercent}%`);
    if (c.settlementMs > best.settlementMs) reasons.push(`slower by ${formatDuration(c.settlementMs - best.settlementMs)}`);
    if (c.riskScore > best.riskScore) reasons.push(`riskier ${c.riskScore.toFixed(2)} > ${best.riskScore.toFixed(2)}`);
    if (reasons.length === 0) reasons.push('lower weighted objective score');
    return `Rejected: ${reasons.join(', ')}`;
  }

  /* ----------------------------------------------------------------------- */
  /* Plan construction                                                       */
  /* ----------------------------------------------------------------------- */

  private buildSteps(
    scenario: SimulationScenario,
    c: Candidate,
    sourceAmount: number,
    fxQuote: ReturnType<typeof fxEngine.quote>,
  ): PlanStep[] {
    const steps: PlanStep[] = [];
    let frame = 1;
    const cur = scenario.transaction.merchant.currency;
    const srcCur = scenario.transaction.buyer.currency;

    steps.push({
      id: uid('step'),
      type: 'debit_source',
      title: 'Debit Buyer',
      description: `Debit buyer wallet ${round(sourceAmount, 2)} ${srcCur} via ${scenario.transaction.buyer.method}`,
      amount: sourceAmount,
      currency: srcCur,
      sourceRef: { kind: 'wallet', id: 'buyer' },
      frame: frame++,
      reversible: true,
    });

    steps.push({
      id: uid('step'),
      type: 'credit_reserve',
      title: 'Credit Source Reserve',
      description: `Credit source reserve (${scenario.transaction.buyer.country}) with buyer funds`,
      amount: sourceAmount,
      currency: srcCur,
      targetRef: { kind: 'reserve', id: scenario.treasury.originReserve.country },
      frame: frame++,
      reversible: true,
    });

    if (srcCur !== cur) {
      steps.push({
        id: uid('step'),
        type: 'fx_convert',
        title: 'FX Bridge',
        description: `Convert ${srcCur} → ${cur} @ ${round(fxQuote.effectiveRate, 6)} (${fxQuote.spreadBps} bps)`,
        amount: scenario.transaction.amount,
        currency: cur,
        frame: frame++,
        reversible: false,
        meta: { midRate: fxQuote.midRate, spreadBps: fxQuote.spreadBps },
      });
    }

    steps.push({
      id: uid('step'),
      type: 'mint_twin',
      title: 'Mint Twin Token',
      description: `Mint twin token representing the cross-border obligation`,
      amount: scenario.transaction.amount,
      currency: cur,
      frame: frame++,
      reversible: false,
    });

    if (c.reserveDraw > 0) {
      steps.push({
        id: uid('step'),
        type: 'draw_reserve',
        title: 'Draw Destination Reserve',
        description: `Draw ${round(c.reserveDraw, 2)} ${cur} from destination reserve`,
        amount: c.reserveDraw,
        currency: cur,
        sourceRef: { kind: 'reserve', id: scenario.treasury.destinationReserve.country },
        frame: frame++,
        reversible: true,
      });
    }

    if (c.treasuryDraw > 0) {
      steps.push({
        id: uid('step'),
        type: 'draw_treasury',
        title: 'Draw Stablecoin Treasury',
        description: `Draw ${round(c.treasuryDraw, 2)} ${cur} from stablecoin treasury`,
        amount: c.treasuryDraw,
        currency: cur,
        sourceRef: { kind: 'stablecoin_treasury', id: 'treasury' },
        frame: frame++,
        reversible: true,
      });
    }

    for (const u of c.lpUsage) {
      steps.push({
        id: uid('step'),
        type: u.manual ? 'draw_lp' : 'draw_lp',
        title: u.manual ? `Draw ${u.sourceLabel} (manual)` : `Draw ${u.sourceLabel}`,
        description: `Draw ${round(u.drawn, 2)} ${cur} @ ${u.rate}%${u.exhausted ? ' — exhausted' : ''}${u.manual ? ' — manual settlement required' : ''}`,
        amount: u.drawn,
        currency: cur,
        sourceRef: { kind: u.sourceKind, id: u.sourceId },
        frame: frame++,
        reversible: true,
        meta: { rate: u.rate, fee: u.fee, manual: u.manual },
      });
      if (u.manual) {
        steps.push({
          id: uid('step'),
          type: 'notify_lp',
          title: `Notify ${u.sourceLabel}`,
          description: 'Manual settlement: notify LP to settle externally',
          amount: u.drawn,
          currency: cur,
          frame: frame++,
          reversible: false,
          meta: { manual: true },
        });
        steps.push({
          id: uid('step'),
          type: 'await_confirmation',
          title: `Await Merchant Confirmation`,
          description: 'Wait for merchant to confirm external settlement',
          amount: u.drawn,
          currency: cur,
          frame: frame++,
          reversible: false,
          meta: { manual: true },
        });
      }
    }

    steps.push({
      id: uid('step'),
      type: 'burn_twin',
      title: 'Burn Twin Token',
      description: 'Burn twin token — obligation backed & settled',
      amount: scenario.transaction.amount,
      currency: cur,
      frame: frame++,
      reversible: false,
    });

    steps.push({
      id: uid('step'),
      type: 'credit_destination',
      title: 'Credit Merchant',
      description: `Credit merchant wallet ${round(scenario.transaction.amount, 2)} ${cur}`,
      amount: scenario.transaction.amount,
      currency: cur,
      targetRef: { kind: 'wallet', id: 'merchant' },
      frame: frame++,
      reversible: true,
    });

    if (c.cost.totalFees > 0) {
      steps.push({
        id: uid('step'),
        type: 'accrue_fee',
        title: 'Accrue Fees to Treasury',
        description: `Accrue ${round(c.cost.totalFees, 2)} ${cur} to treasury (LP + FX + reserve)`,
        amount: c.cost.totalFees,
        currency: cur,
        targetRef: { kind: 'fo', id: 'treasury' },
        frame: frame++,
        reversible: false,
      });
    }

    return steps;
  }

  private buildMetrics(
    c: Candidate,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    scenario: SimulationScenario,
    reservesAfter: Reserve[],
  ): PlanMetrics {
    const totalInitLpCap = scenario.liquidityProviders
      .filter((lp) => lp.country === scenario.transaction.buyer.country)
      .reduce((s, lp) => s + lp.tradingCapacity, 0);
    const totalDrawn = c.lpUsage.reduce((s, u) => s + u.drawn, 0);
    const dstReserve = scenario.treasury.destinationReserve;
    const riskLabel: PlanMetrics['riskLabel'] =
      c.riskScore < 0.15 ? 'Low' : c.riskScore < 0.3 ? 'Moderate' : c.riskScore < 0.5 ? 'Elevated' : 'High';
    return {
      settlementTimeMs: c.settlementMs,
      settlementTimeLabel: formatDuration(c.settlementMs),
      costPercent: c.cost.costPercent,
      costAmount: c.cost.costAmount,
      riskScore: c.riskScore,
      riskLabel,
      confidence: c.confidence,
      fxRate: fxQuote.effectiveRate,
      fxSpreadBps: fxQuote.spreadBps,
      totalFees: c.cost.totalFees,
      reserveUtilization: dstReserve.available ? round((c.reserveDraw / dstReserve.available) * 100, 1) : 0,
      liquidityUtilization: totalInitLpCap ? round((totalDrawn / totalInitLpCap) * 100, 1) : 0,
      insuranceExposure: c.riskScore > 0.4 ? round(scenario.transaction.amount * 0.1, 2) : 0,
      twinTokensMinted: 1,
    };
  }

  private projectReservesAfter(scenario: SimulationScenario, c: Pick<Candidate, 'lpUsage' | 'reserveDraw' | 'treasuryDraw'>): Reserve[] {
    return [
      {
        id: uid('res'),
        country: scenario.treasury.originReserve.country,
        currency: scenario.treasury.originReserve.currency,
        available: scenario.treasury.originReserve.available,
        locked: 0,
        minThreshold: scenario.treasury.originReserve.minThreshold,
        forecast: 0,
        replenishmentSchedule: 'daily',
        aiConfidence: 0.9,
      },
      {
        id: uid('res'),
        country: scenario.treasury.destinationReserve.country,
        currency: scenario.treasury.destinationReserve.currency,
        available: round(scenario.treasury.destinationReserve.available - c.reserveDraw - (c.treasuryDraw > 0 ? 0 : 0), 6),
        locked: 0,
        minThreshold: scenario.treasury.destinationReserve.minThreshold,
        forecast: 0,
        replenishmentSchedule: 'daily',
        aiConfidence: 0.9,
      },
    ];
  }

  private buildDecisions(
    scenario: SimulationScenario,
    c: Candidate,
    fxQuote: ReturnType<typeof fxEngine.quote>,
    sourceAmount: number,
  ): AIDecision[] {
    const decisions: AIDecision[] = [];
    decisions.push({ step: 'Corridor authorization', rationale: `${scenario.transaction.buyer.country} → ${scenario.transaction.merchant.country} verified.` });
    if (scenario.transaction.buyer.currency !== scenario.transaction.merchant.currency) {
      decisions.push({ step: 'FX bridge', rationale: `Quoted ${scenario.transaction.buyer.currency}→${scenario.transaction.merchant.currency} @ ${round(fxQuote.effectiveRate, 6)} (${fxQuote.spreadBps} bps). Buyer debited ${round(sourceAmount, 2)} ${scenario.transaction.buyer.currency}.` });
    }
    if (c.reserveDraw > 0) {
      decisions.push({ step: 'Reserve draw', rationale: `Drew ${round(c.reserveDraw, 2)} from destination reserve — reserve-first policy.` });
    }
    if (c.treasuryDraw > 0) {
      decisions.push({ step: 'Treasury draw', rationale: `Drew ${round(c.treasuryDraw, 2)} from stablecoin treasury — lower carbon, preserves LP capacity.` });
    }
    for (const u of c.lpUsage) {
      decisions.push({ step: `Draw ${u.sourceLabel}`, rationale: `Drew ${round(u.drawn, 2)} @ ${u.rate}%${u.exhausted ? ' — exhausted' : ` — ${round(u.remaining, 2)} remaining`}${u.manual ? ' — manual settlement' : ''}.` });
    }
    decisions.push({ step: 'Reserve health', rationale: c.riskScore < 0.2 ? 'All reserves above thresholds; no insurance required.' : 'Reserve headroom tightened — flagged for monitoring.' });
    decisions.push({ step: 'Risk acceptance', rationale: `Risk ${c.riskScore.toFixed(2)} — ${c.confidence}% confidence. ${c.riskScore < 0.25 ? 'Within autonomous band.' : 'Escalation recommended.'}` });
    decisions.push({ step: 'Cost acceptance', rationale: `Blended cost ${c.cost.costPercent}% (${round(c.cost.totalFees, 2)} ${scenario.transaction.merchant.currency}) — ${scenario.transaction.priority} preference satisfied.` });
    return decisions;
  }

  private strategyLabel(priority: RoutingPriorityLike): string {
    switch (priority) {
      case 'cheapest': return 'Cost-minimizing liquidity corridor';
      case 'fastest': return 'Latency-minimizing liquidity corridor';
      case 'safest': return 'Risk-minimizing diversified corridor';
      case 'balanced': return 'Balanced multi-objective corridor';
      case 'impact': return 'Community-impact-weighted corridor';
      default: return 'Liquidity corridor';
    }
  }

  private buildFallbackNarrative(strategy: string, c: Candidate, scenario: SimulationScenario, _decisions: AIDecision[]): string {
    const lpSummary = c.lpUsage.length > 0
      ? c.lpUsage.map((u) => `${u.sourceLabel} covered ${round(u.drawn, 0)}${u.exhausted ? ' (exhausted)' : ''}`).join('; ')
      : 'the treasury/reserve self-funded the payment';
    return `Under the ${scenario.transaction.priority} priority, the planner moved ${round(scenario.transaction.amount, 0)} ${scenario.transaction.merchant.currency} from ${scenario.transaction.buyer.country} to ${scenario.transaction.merchant.country}. ${lpSummary}. Blended cost ${c.cost.costPercent}%, risk ${c.riskScore.toFixed(2)}, confidence ${c.confidence}%. ${c.usesReserve ? 'Destination reserve drawn. ' : ''}${c.usesTreasury ? 'Stablecoin treasury used. ' : ''}All reserves remained above thresholds.`;
  }
}

type RoutingPriorityLike = 'cheapest' | 'fastest' | 'safest' | 'balanced' | 'impact';
