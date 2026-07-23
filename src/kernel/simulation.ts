/**
 * Simulation Engine — the PaySwap Digital Twin.
 *
 * Runs a scenario through the EXACT same planner + executor that production
 * uses, against a private (simulated) copy of world state. Produces:
 *   - the immutable Liquidity Execution Plan (+ alternatives)
 *   - any Plan Amendments triggered by injected failures
 *   - workflows (manual settlement / insurance)
 *   - treasury AI recommendations
 *   - the full 9+ frame replay timeline (Time Machine)
 *   - ledger, events, twin tokens, world state, audit
 *
 * Every artifact is identical to what production would generate. No business
 * logic is duplicated between simulator and production.
 */
import type {
  SimulationScenario,
  SimulationResult,
  ReplayFrame,
  WorldState,
  WorldStateResult,
  Reserve,
  AuditTrace,
  EngineHealth,
  PlanAmendment,
  LiquidityExecutionPlan,
  ConstitutionVerdict,
  GraphSnapshot,
  WorldInspector,
  FrameDelta,
  CandidatePlanSummary,
  StateTransitionSummary,
  WorldSnapshotSummary,
} from './types';
import { OptimizationEngine } from './optimization-engine';
import { PlanExecutor } from './plan-executor';
import { WorldStore, buildWorldFromScenario, summarizeWorld } from './world-store';
import { stateMachine, stateLabel } from './state-machine';
import { treasuryAI } from './treasury-ai';
import { treasuryEngine } from './treasury';
import { auditEngine } from './audit';
import { eventEngine } from './event';
import { permissionEngine } from './permission';
import { extensionRuntime } from './extension';
import { insuranceEngine } from './insurance';
import { lpLifecycle } from './lp-lifecycle';
import { buildGraph } from './financial-graph';
import { evaluateConstitution } from './constitution';
import { EventCatalog } from './events';
import { ENGINES } from './registry';
import { KERNEL_VERSION, uid, round, hashMetrics } from './support';

export interface SimulationOptions {
  actorId?: string;
}

export class SimulationEngine {
  run(scenario: SimulationScenario, opts: SimulationOptions = {}): SimulationResult {
    const actorId = opts.actorId ?? 'simulator';
    const runId = uid('run');

    permissionEngine.authorize(actorId, 'kernel:simulate');
    auditEngine.reset();
    eventEngine.reset();
    treasuryEngine.reset();
    insuranceEngine.reset();
    stateMachine.reset();

    auditEngine.record(actorId, 'simulation.start', `Run ${runId}: ${scenario.transaction.amount} ${scenario.transaction.currency} ${scenario.transaction.buyer.country}→${scenario.transaction.merchant.country}`);

    // === CANONICAL WORLD STATE STORE ===
    // The world is the source of truth. Every engine transforms world → world.
    const initialWorld = buildWorldFromScenario(scenario);
    const worldStore = new WorldStore(initialWorld);
    treasuryEngine.init(scenario.transaction.merchant.currency, scenario.treasury.stablecoinBalance, scenario.treasury.emergencyTreasury, 0);

    // Register the plan in the state machine.
    const planObjectId = uid('plan');
    stateMachine.register(planObjectId, 'plan');

    // === FINANCIAL GRAPH (built from world state; never mutates) ===
    const world = worldStore.world();
    const graph = buildGraph({
      reserves: world.reserves.map((r) => ({ id: r.id, country: r.country, currency: r.currency, available: r.available, minThreshold: r.minThreshold })),
      liquidityProviders: world.liquidityProviders,
      treasury: { stablecoinBalance: scenario.treasury.stablecoinBalance, emergencyBalance: scenario.treasury.emergencyTreasury },
      financialOperators: world.financialOperators,
      scenario,
    });
    const graphSnapshot: GraphSnapshot = {
      nodes: graph.allNodes().map((n) => ({ id: n.id, type: n.type, label: n.label, country: n.country, currency: n.currency, balance: n.balance, online: n.online })),
      edges: graph.allEdges().map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind, cost: e.cost, liquidity: e.liquidity, reliability: e.reliability })),
    };

    // === OPTIMIZATION ENGINE (never executes) ===
    // Finds the best world transition satisfying all constraints.
    extensionRuntime.fire('beforeRoute', { scenario, runId });
    const optimizer = new OptimizationEngine();
    const { plan, candidates } = optimizer.optimize({
      scenario,
      world,
      objectives: scenario.aiWeights,
    });
    extensionRuntime.fire('afterRoute', { scenario, plan });
    eventEngine.emit(EventCatalog.PlanCreated, { planId: plan.id, strategy: plan.reasoning.strategy }, 0);
    stateMachine.transition(planObjectId, 'validated', 'constitution pre-check passed', 0);
    auditEngine.record(actorId, 'optimization.optimize', `strategy=${plan.reasoning.strategy} score=${plan.reasoning.weightedScore} candidates=${candidates.length}`);

    // === STATE MACHINE: validated → approved ===
    stateMachine.transition(planObjectId, 'approved', 'policy passed', 0);

    // === PLAN EXECUTOR (never thinks; sim + production same code) ===
    stateMachine.transition(planObjectId, 'executing', 'execution started', 0);
    // Build the execution world (the old WorldState shape the executor expects).
    const execWorld: WorldState = {
      accounts: new Map(),
      reserves: world.reserves.map((r) => ({ ...r })),
      liquidityProviders: world.liquidityProviders.map((lp) => ({ ...lp })),
      financialOperators: world.financialOperators.map((fo) => ({ ...fo })),
      treasury: { positions: [] },
      twinTokens: [],
      wallets: [],
    };
    const executor = new PlanExecutor(execWorld, scenario);
    const out = executor.execute(plan);
    extensionRuntime.fire('afterSettle', { plan, out });
    eventEngine.emit(out.settled ? EventCatalog.ExecutionCompleted : EventCatalog.ExecutionRolledBack, { planId: plan.id, settled: out.settled }, 0);

    // === STATE MACHINE: executing → completed → settled (or failed) ===
    if (out.settled) {
      stateMachine.transition(planObjectId, 'completed', 'execution done', 0);
      stateMachine.transition(planObjectId, 'settled', 'settlement confirmed', 0);
    } else {
      stateMachine.transition(planObjectId, 'failed', 'execution failed', 0);
      stateMachine.transition(planObjectId, 'rolled_back', 'rollback', 0);
    }

    // === COMMIT NEW WORLD STATE ===
    // The executor transformed the world; commit the new snapshot.
    worldStore.transform('post-execution', (w) => ({
      ...w,
      reserves: execWorld.reserves,
      liquidityProviders: execWorld.liquidityProviders,
      financialOperators: execWorld.financialOperators,
      twinTokens: out.twinTokens,
      ledger: { accounts: execWorld.accounts, entries: out.ledger },
      events: [...w.events, ...out.events],
    }));

    // 3. Reserves after execution (for treasury AI + world state).
    const reservesAfter = execWorld.reserves.map((r) => ({ ...r }));

    // 4. Treasury AI recommendations.
    const treasuryRecs = treasuryAI.recommend(scenario, reservesAfter, {
      costPercent: plan.metrics.costPercent,
      riskScore: plan.metrics.riskScore,
      reserveUtilization: plan.metrics.reserveUtilization,
    });

    // 5. Build the Time Machine replay timeline.
    const replay = this.buildReplay(scenario, plan, out);

    // 6. World state result.
    const worldState: WorldStateResult = {
      reserves: scenario.treasury.originReserve && scenario.treasury.destinationReserve ? [
        this.reserveResult(scenario.treasury.originReserve, execWorld.reserves.find((r) => r.country === scenario.treasury.originReserve.country)),
        this.reserveResult(scenario.treasury.destinationReserve, execWorld.reserves.find((r) => r.country === scenario.treasury.destinationReserve.country)),
      ] : [],
      liquidityProviders: scenario.liquidityProviders.map((before) => {
        const after = execWorld.liquidityProviders.find((x) => x.id === before.id)!;
        return {
          id: before.id,
          name: before.name,
          country: before.country,
          currency: before.currency,
          sourceKind: before.sourceKind,
          capacity: before.tradingCapacity,
          used: round(before.tradingCapacity - after.tradingCapacity, 6),
          remaining: after.tradingCapacity,
          twinTokenPosition: before.twinTokenPosition,
          fiatPosition: before.fiatPosition,
          rate: before.tradingFees,
          online: after.online,
          manualOnly: before.manualOnly,
        };
      }),
      financialOperators: scenario.financialOperators.map((before) => {
        const after = execWorld.financialOperators.find((x) => x.id === before.id)!;
        const used = scenario.transaction.buyer.foId === before.id || scenario.transaction.merchant.foId === before.id;
        return {
          id: before.id,
          name: before.name,
          type: before.type,
          country: before.country,
          online: after.online,
          latencyMs: before.latencyMs,
          uptime: before.uptime,
          used,
        };
      }),
      treasury: { positions: treasuryEngine.all() },
    };

    auditEngine.record(actorId, 'simulation.complete', `run ${runId} settled=${out.settled}`);

    // 7. Kernel Constitution — non-overridable invariants.
    const constitution = evaluateConstitution({
      plan,
      ledger: out.ledger,
      twinTokens: out.twinTokens,
      reserves: reservesAfter,
      world: execWorld,
      result: { events: out.events } as import('./types').SimulationResult,
    });
    eventEngine.emit(constitution.passed ? EventCatalog.ConstitutionChecked : EventCatalog.ConstitutionViolated, { passed: constitution.passed, violations: constitution.violations.length }, 0);
    auditEngine.record(actorId, 'constitution.check', `passed=${constitution.passed} violations=${constitution.violations.length}`);

    // 8. World Inspector — per-frame deltas.
    const worldInspector = this.buildWorldInspector(scenario, plan, out, execWorld);

    // 9. LP lifecycle events (initialize stakes for online LPs).
    lpLifecycle.reset();
    for (const lp of execWorld.liquidityProviders) {
      if (lp.online) lpLifecycle.stake(lp, lp.twinTokenPosition, 0);
    }

    // 10. Candidate plans summary (from the Optimization Engine).
    const candidatePlans: CandidatePlanSummary[] = candidates.map((c) => ({
      id: c.id, label: c.label, strategy: c.strategy, weightedScore: c.weightedScore,
      costPercent: c.cost.costPercent, settlementTimeMs: c.settlementMs, riskScore: c.riskScore,
      lpCount: c.lpUsage.length, usesReserve: c.usesReserve, usesTreasury: c.usesTreasury,
      feasible: c.feasible, selected: c.selected, rejectionReason: c.rejectionReason,
      objectiveScores: c.objectiveScores,
    }));

    // 11. State machine transitions.
    const stateTransitions: StateTransitionSummary[] = stateMachine.allTransitions().map((t) => ({
      id: t.id, objectId: t.objectId, objectKind: t.objectKind, from: t.from, to: t.to,
      reason: t.reason, ts: t.ts, frame: t.frame,
    }));

    // 12. World history (snapshots from the World Store).
    const worldHistory: WorldSnapshotSummary[] = worldStore.history().map((snap) => {
      const sum = summarizeWorld(snap.state);
      return { version: snap.version, label: snap.label, ts: snap.ts, totalReserves: sum.totalReserves, totalLpCapacity: sum.totalLpCapacity, totalTwinSupply: sum.totalTwinSupply, totalTreasury: sum.totalTreasury, ledgerBalanced: sum.ledgerBalanced, events: sum.events };
    });

    const resultHash = hashMetrics({
      costPercent: plan.metrics.costPercent,
      settlementTimeMs: plan.metrics.settlementTimeMs,
      riskScore: plan.metrics.riskScore,
      confidence: plan.metrics.confidence,
    });

    return {
      runId,
      createdAt: Date.now(),
      kernelVersion: KERNEL_VERSION,
      scenario,
      plan,
      amendments: out.amendments,
      workflows: out.workflows,
      insuranceClaims: out.insuranceClaims,
      treasuryRecommendations: treasuryRecs,
      replay,
      ledger: out.ledger,
      events: out.events,
      twinTokens: out.twinTokens,
      worldState,
      audit: auditEngine.trace(runId, actorId),
      engines: ENGINES,
      resultHash,
      settled: out.settled,
      constitution,
      graph: graphSnapshot,
      worldInspector,
      lpLifecycleEvents: lpLifecycle.allEvents(),
      candidatePlans,
      stateTransitions,
      worldHistory,
    };
  }

  private reserveResult(before: SimulationScenario['treasury']['originReserve'], after: Reserve | undefined) {
    return {
      id: `reserve:${before.country}`,
      country: before.country,
      currency: before.currency,
      availableBefore: before.available,
      availableAfter: after?.available ?? before.available,
      locked: after?.locked ?? 0,
      minThreshold: before.minThreshold,
      delta: round((after?.available ?? before.available) - before.available, 6),
      healthy: (after?.available ?? before.available) >= before.minThreshold,
    };
  }

  /**
   * Build the World Inspector — per-frame deltas for every node in the graph.
   * Shows before/after for ledger, reserves, LPs, treasury, twin tokens and
   * events at each replay frame. This is the "debugger" view.
   */
  private buildWorldInspector(
    scenario: SimulationScenario,
    plan: LiquidityExecutionPlan,
    out: ReturnType<PlanExecutor['execute']>,
    world: WorldState,
  ): WorldInspector {
    const frames = [...new Set(out.ledger.map((e) => e.frame))].sort((a, b) => a - b);
    const deltas: FrameDelta[] = frames.map((frame) => {
      const ledgerEntries = out.ledger.filter((e) => e.frame === frame);
      const frameEvents = out.events.filter((e) => e.frame === frame);
      const twinTokens = out.twinTokens.filter((t) => t.mintedAtFrame === frame || t.burnedAtFrame === frame);
      return {
        frame,
        ledger: ledgerEntries.map((e) => ({ account: e.accountLabel, debit: e.debit, credit: e.credit, balanceAfter: e.balanceAfter })),
        reserves: world.reserves.map((r) => ({ country: r.country, availableAfter: r.available, delta: 0 })),
        liquidityProviders: world.liquidityProviders.map((lp) => ({ lpId: lp.id, remainingAfter: lp.tradingCapacity, delta: 0 })),
        treasury: treasuryEngine.all().map((p) => ({ currency: p.currency, fiatAfter: p.fiatBalance, stablecoinAfter: p.stablecoinBalance })),
        twinTokens: twinTokens.map((t) => ({ symbol: t.symbol, status: t.status })),
        events: frameEvents.map((e) => ({ type: e.type, frame: e.frame })),
      };
    });

    return {
      deltas,
      before: {
        reserves: scenario.treasury.originReserve && scenario.treasury.destinationReserve ? [
          { country: scenario.treasury.originReserve.country, available: scenario.treasury.originReserve.available },
          { country: scenario.treasury.destinationReserve.country, available: scenario.treasury.destinationReserve.available },
        ] : [],
        liquidityProviders: scenario.liquidityProviders.map((lp) => ({ lpId: lp.id, remaining: lp.tradingCapacity })),
      },
      after: {
        reserves: world.reserves.map((r) => ({ country: r.country, available: r.available })),
        liquidityProviders: world.liquidityProviders.map((lp) => ({ lpId: lp.id, remaining: lp.tradingCapacity })),
      },
    };
  }

  private buildReplay(scenario: SimulationScenario, plan: LiquidityExecutionPlan, out: ReturnType<PlanExecutor['execute']>): ReplayFrame[] {
    const frames: ReplayFrame[] = [];
    const ledgerByFrame = (f: number) => out.ledger.filter((e) => e.frame === f);
    const eventsByFrame = (f: number) => out.events.filter((e) => e.frame === f);
    const twin = out.twinTokens[0];
    const totalDebit = out.ledger.reduce((s, e) => s + e.debit, 0);
    const totalCredit = out.ledger.reduce((s, e) => s + e.credit, 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 1e-6;

    // Map plan steps to replay frames.
    const stepFrames = new Set(plan.steps.map((s) => s.frame));
    const maxFrame = Math.max(...stepFrames, 0);

    // Frame 1: Debit Buyer
    const debitStep = plan.steps.find((s) => s.type === 'debit_source');
    if (debitStep) {
      frames.push({
        index: 1, key: 'debit-buyer', title: 'Debit Buyer', type: 'debit',
        description: debitStep.description,
        ledgerEntries: ledgerByFrame(debitStep.frame),
        events: eventsByFrame(debitStep.frame),
        summary: `Buyer debited; liquidity enters the kernel.`,
      });
    }
    // Frame 2: Credit Reserve
    const creditReserveStep = plan.steps.find((s) => s.type === 'credit_reserve');
    if (creditReserveStep) {
      frames.push({
        index: 2, key: 'credit-reserve', title: 'Credit Reserve', type: 'credit',
        description: creditReserveStep.description,
        ledgerEntries: ledgerByFrame(creditReserveStep.frame),
        events: eventsByFrame(creditReserveStep.frame),
        summary: `Source reserve holds the buyer's deposit as a liability.`,
      });
    }
    // FX + Mint Twin (combined frame 3)
    const mintStep = plan.steps.find((s) => s.type === 'mint_twin');
    if (mintStep) {
      frames.push({
        index: 3, key: 'mint-twin', title: 'Mint Twin Token', type: 'mint',
        description: mintStep.description,
        twinToken: twin ? { ...twin } : undefined,
        events: eventsByFrame(mintStep.frame),
        summary: twin ? `${twin.symbol} minted for ${round(twin.amount, 2)} ${twin.currency}` : 'No twin token',
      });
    }
    // Frame 4: Liquidity draws + Burn Twin
    const drawSteps = plan.steps.filter((s) => s.type === 'draw_lp' || s.type === 'draw_reserve' || s.type === 'draw_treasury');
    const burnStep = plan.steps.find((s) => s.type === 'burn_twin');
    const drawFrames = drawSteps.map((s) => s.frame);
    const burnFrame = burnStep?.frame;
    const allDrawEntries = drawFrames.flatMap((f) => ledgerByFrame(f));
    const allDrawEvents = drawFrames.flatMap((f) => eventsByFrame(f));
    if (drawSteps.length > 0 || burnStep) {
      frames.push({
        index: 4, key: 'liquidity-burn', title: 'Source Liquidity & Burn Twin', type: 'burn',
        description: `Draw ${drawSteps.length} liquidity source(s) and burn the twin token`,
        twinToken: twin,
        ledgerEntries: [...allDrawEntries, ...(burnFrame ? ledgerByFrame(burnFrame) : [])],
        events: allDrawEvents,
        summary: `${drawSteps.length} source(s) drawn; twin token burned.`,
      });
    }
    // Frame 5: Credit Merchant
    const creditMerchStep = plan.steps.find((s) => s.type === 'credit_destination');
    if (creditMerchStep) {
      frames.push({
        index: 5, key: 'credit-merchant', title: 'Credit Merchant', type: 'credit',
        description: creditMerchStep.description,
        ledgerEntries: ledgerByFrame(creditMerchStep.frame),
        events: eventsByFrame(creditMerchStep.frame),
        summary: `Merchant credited ${round(scenario.transaction.amount, 2)} ${scenario.transaction.merchant.currency}.`,
      });
    }
    // Frame 6: Ledger
    frames.push({
      index: 6, key: 'ledger', title: 'Ledger Entries', type: 'ledger',
      description: 'Complete double-entry ledger for the transaction.',
      ledgerEntries: out.ledger,
      summary: `${out.ledger.length} entries • Dr ${round(totalDebit, 2)} = Cr ${round(totalCredit, 2)} • ${balanced ? 'balanced ✓' : 'UNBALANCED ✗'}`,
    });
    // Frame 7: Events
    frames.push({
      index: 7, key: 'events', title: 'Events', type: 'events',
      description: 'Full event stream emitted by the kernel.',
      events: out.events,
      summary: `${out.events.length} events emitted.`,
    });
    // Frame 8: AI Decisions
    frames.push({
      index: 8, key: 'ai', title: 'AI Decisions', type: 'ai',
      description: 'Planner reasoning over objectives, liquidity and risk.',
      decisions: plan.reasoning.decisions,
      summary: `${plan.reasoning.decisions.length} decisions • weighted score ${plan.reasoning.weightedScore}`,
    });
    // Frame 9+: Amendments (one per failure)
    let frameIdx = 9;
    for (const amend of out.amendments) {
      frames.push({
        index: frameIdx++, key: `amend-${amend.id}`, title: `Recovery: ${amend.triggeredBy.label}`, type: 'amendment',
        description: amend.reason,
        amendment: amend,
        events: eventsByFrame(amend.insertedAtFrame),
        summary: `${amend.recoveryStrategy} • ${amend.steps.length} recovery step(s)`,
        isRecovery: true,
      });
    }
    // Workflows frame
    if (out.workflows.length > 0) {
      frames.push({
        index: frameIdx++, key: 'workflows', title: 'Workflows', type: 'workflow',
        description: 'Manual settlement and insurance claim workflows.',
        workflow: out.workflows[0],
        summary: `${out.workflows.length} workflow(s) executed.`,
      });
    }
    // Insurance frame
    if (out.insuranceClaims.length > 0) {
      frames.push({
        index: frameIdx++, key: 'insurance', title: 'Insurance Claims', type: 'insurance',
        description: 'Insurance claims filed during execution.',
        insurance: out.insuranceClaims[0],
        summary: `${out.insuranceClaims.length} claim(s) • ${out.insuranceClaims.filter((c) => c.status === 'approved').length} approved`,
      });
    }
    // Treasury AI frame
    frames.push({
      index: frameIdx++, key: 'treasury', title: 'Treasury AI', type: 'treasury',
      description: 'Treasury AI recommendations for future liquidity decisions.',
      treasury: [],
      summary: 'Treasury health monitored.',
    });
    // Settlement complete
    frames.push({
      index: frameIdx++, key: 'settlement', title: 'Settlement Complete', type: 'settlement',
      description: 'Final settlement state and metrics.',
      summary: `${out.settled ? 'Settled' : 'Blocked/Rolled back'} • ${plan.metrics.settlementTimeLabel} • cost ${plan.metrics.costPercent}% • risk ${plan.metrics.riskScore.toFixed(2)} (${plan.metrics.riskLabel}) • confidence ${plan.metrics.confidence}%`,
    });

    return frames;
  }
}

export const simulationEngine = new SimulationEngine();
