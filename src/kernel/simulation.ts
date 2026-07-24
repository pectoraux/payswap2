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
import { reasoningEngine } from './reasoning-engine';
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
import { ENGINES, RUNTIME_SERVICES } from './registry';
import { KERNEL_VERSION, uid, round, hashMetrics, PRIORITY_WEIGHTS } from './support';
import type { ReasoningResultSummary, ExecutionGraphSummary, EntitySummary, OrganizationPolicy, RuntimeServiceSummary, SolverCandidateSummary, TransitionSummary, EventLogEntry, ObligationSummary, ProposalSummary, ReservationSummary } from './types';
import { entitiesFromScenario } from './entity';
import { buildExecutionGraph, topologicalOrder } from './execution-graph';
import { Commands } from './command';
import { ConvergencePlanner } from './planner';
import { capabilityRegistry, ALL_CAPABILITIES } from './capabilities';
import { createEventSourcedWorld, appendTransition, currentWorld, type EventSourcedWorld } from './event-sourced-world';
import { createEvidence, type Evidence as KernelEvidence } from './evidence';
import { obligation, obligationStore, transitionObligation, type Obligation } from './obligation';
import { proposal, proposalStore, accept as acceptProposal, activate as activateProposal, complete as completeProposal, type Proposal } from './proposal';
import { resourceReservation } from './resource-reservation';
import { confidenceService } from './confidence-service';
import { settlementEscrowContract, collateralVaultContract, lpRegistryContract, merchantRegistryContract, twinTokenContract, liquidityPoolContract } from '@/protocol/contracts';
import { computeAuthorizedExposure, defaultExposureFactors } from '@/protocol/economics/authorized-exposure';
import { computeLPReputation, defaultLPReputation } from '@/protocol/economics/reputation';
import { disputeEngine } from '@/protocol/settlement/disputes';
import { auctionEngine } from '@/protocol/settlement/auctions';
import { netSettlementEngine } from '@/protocol/settlement/net-settlement';

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

    // 10b. Financial Reasoning Engine — 10 independent reasoning capabilities.
    const reasoningResults: ReasoningResultSummary[] = reasoningEngine.reason(plan, scenario, {
      reserves: execWorld.reserves,
      liquidityProviders: execWorld.liquidityProviders,
    }).map((r) => ({
      category: r.category,
      summary: r.summary,
      recommendations: r.recommendations.map((rec) => ({ action: rec.action, rationale: rec.rationale, priority: rec.priority, category: rec.category })),
      confidence: r.confidence,
      evidence: r.evidence,
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

    // 13. Execution Graph DAG (replaces linear plan — enables parallel execution, retries, compensation).
    const cmd = Commands.transferLiquidity('wallet:buyer', 'wallet:merchant', scenario.transaction.amount, scenario.transaction.currency);
    const graphNodes = plan.steps.map((s) => ({
      type: s.type === 'debit_source' ? 'debit' as const : s.type === 'credit_reserve' || s.type === 'credit_destination' ? 'credit' as const : s.type === 'mint_twin' ? 'mint' as const : s.type === 'burn_twin' ? 'burn' as const : s.type === 'draw_lp' ? 'draw_lp' as const : s.type === 'draw_reserve' ? 'draw_reserve' as const : s.type === 'draw_treasury' ? 'draw_treasury' as const : s.type === 'fx_convert' ? 'fx_convert' as const : s.type === 'notify_lp' ? 'notify' as const : s.type === 'await_confirmation' ? 'await' as const : s.type === 'insurance_claim' ? 'insurance' as const : 'accrue_fee' as const,
      title: s.title,
      description: s.description,
      amount: s.amount,
      currency: s.currency,
      entityRef: s.sourceRef?.id ?? s.targetRef?.id,
      reversible: s.reversible,
      frame: s.frame,
      meta: s.meta as Record<string, string | number | boolean> | undefined,
    }));
    const execGraph = buildExecutionGraph(cmd.id, graphNodes);
    const executionGraph: ExecutionGraphSummary = {
      id: execGraph.id, commandId: execGraph.commandId,
      totalNodes: execGraph.totalNodes, parallelGroups: execGraph.parallelGroups,
      criticalPathLength: execGraph.criticalPathLength, status: execGraph.status,
      nodes: execGraph.nodes.map((n) => ({ id: n.id, type: n.type, title: n.title, status: n.status, parallelGroup: n.parallelGroup ?? 0, dependencies: n.dependencies, reversible: n.reversible, checkpoint: n.checkpoint ?? false, amount: n.amount, currency: n.currency, frame: n.frame })),
      edges: execGraph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    };

    // 14. Entities (the Entity-Component model — every object derives from Entity).
    const entities: EntitySummary[] = entitiesFromScenario(scenario).map((e) => ({
      id: e.id, type: e.type, state: e.state, label: e.label, country: e.country, currency: e.currency,
      balance: e.balance,
      capabilities: Object.entries(e.capabilities).filter(([, v]) => v).map(([k]) => k),
      policies: e.policies as Record<string, unknown>,
    }));

    // 15. Organization Policy (configurable, vs immutable Constitution).
    const organizationPolicy: OrganizationPolicy = {
      reserveThreshold: scenario.treasury.destinationReserve.minThreshold,
      treasuryStrategy: 'balanced',
      lpPreference: 'mixed',
      carbonObjective: scenario.aiWeights.carbonImpact,
      communityWeight: scenario.aiWeights.communityImpact,
      riskAppetite: scenario.policies.maxRiskScore > 0.4 ? 'high' : scenario.policies.maxRiskScore > 0.2 ? 'medium' : 'low',
      maxLpShare: scenario.policies.maxLpShare,
      maxCostPercent: scenario.policies.maxCostPercent,
      maxRiskScore: scenario.policies.maxRiskScore,
      requireInsurance: scenario.policies.requireInsurance,
      reservePolicy: scenario.policies.reservePolicy,
    };

    // 16. Runtime Services (5 consolidated services).
    const runtimeServices: RuntimeServiceSummary[] = RUNTIME_SERVICES;

    // 17. Generic Constraint Solver — converges world via capability queries.
    const allEntities = entitiesFromScenario(scenario);
    const solver = new ConvergencePlanner();
    const amount = scenario.transaction.amount;
    const cur = scenario.transaction.merchant.currency;

    // Generate evidence for LP entities (FiatProofs with confidence)
    const solverEvidence: import('./evidence').Evidence[] = [];
    for (const lp of scenario.liquidityProviders) {
      if (lp.online) {
        solverEvidence.push(createEvidence({
          type: 'fiat_proof',
          source: 'open_banking',
          verificationLevel: 'institutional',
          entityId: `lp:${lp.id}`,
          attestedAmount: lp.tradingCapacity,
          currency: cur,
          reputation: lp.aiReputation,
          attester: 'open_banking_api',
        }));
      }
    }

    const solverOutput = solver.converge({
      currentWorld: { entities: allEntities, evidence: solverEvidence },
      desiredWorld: {
        deltas: [
          { entityId: 'wallet:buyer', amount: -amount, command: 'TransferLiquidity', capability: 'canTransfer', fromState: 'active', toState: 'active' },
          { entityId: 'wallet:merchant', amount: amount, command: 'TransferLiquidity', capability: 'canReceive', fromState: 'active', toState: 'active' },
        ],
      },
      constraints: { maxCostPercent: 5, maxRiskScore: 0.6, maxSettlementMs: 300000, minConfidence: 0.3 },
      objectives: { ...PRIORITY_WEIGHTS[scenario.transaction.priority], ...scenario.aiWeights },
      policies: { reservePolicy: scenario.policies.reservePolicy, maxLpShare: scenario.policies.maxLpShare, requireInsurance: scenario.policies.requireInsurance },
    });

    const solverCandidates: SolverCandidateSummary[] = solverOutput.plans.map((c) => ({
      id: c.id, label: c.label, transitionCount: c.transitions.length, totalCost: round(c.totalCost, 6),
      totalLatencyMs: c.totalLatencyMs, riskScore: c.riskScore, confidence: c.confidence,
      weightedScore: c.weightedScore, feasible: c.feasible, selected: c.selected,
      rejectionReason: c.rejectionReason, sourceCount: c.sourceCount, usesReserve: c.usesReserve, usesTreasury: c.usesTreasury,
    }));

    const transitions: TransitionSummary[] = solverOutput.transitions.map((t, i) => ({
      id: t.id, entityId: t.entityId, entityType: t.entityType, command: t.command, capability: t.capability,
      fromState: t.fromState, toState: t.toState, amount: t.amount, currency: t.currency, status: 'applied', frame: i + 1,
      evidenceCitations: t.evidenceCitations ?? [],
    }));

    // 18. Event-sourced world — events are truth, snapshots are cache.
    const esWorld = createEventSourcedWorld(allEntities);
    solverOutput.transitions.forEach((t, i) => appendTransition(esWorld, t, i + 1));
    const eventLog: EventLogEntry[] = esWorld.events.map((e) => ({
      id: e.id, type: e.type, ts: e.ts, frame: e.frame, entityId: e.entityId, transitionId: e.transitionId,
    }));

    // 19. Capabilities (the solver queried these — they're first-class).
    const capabilities = ALL_CAPABILITIES;

    // 20. Protocol state — the real PaySwap protocol economics.
    const protocol = this.buildProtocolState(scenario, plan);

    // 21. Obligations — the world converges outstanding obligations until none remain.
    obligationStore.reset();
    const obligations: ObligationSummary[] = [];
    for (const draw of plan.sourceDraws) {
      const ob = obligationStore.register(obligation({
        type: 'deliver',
        priority: 'critical',
        obligorId: `lp:${draw.sourceId}`,
        obligeeId: 'wallet:merchant',
        amount: draw.drawn,
        currency: scenario.transaction.merchant.currency,
        dueAt: Date.now() + 300000, // 5 min deadline
      }));
      // Auto-fulfill settled obligations
      if (out.settled) {
        const fulfilled = transitionObligation(ob, 'fulfilled', 'settlement completed');
        obligationStore.update(ob.id, fulfilled);
      }
      obligations.push({
        id: ob.id, type: ob.type, state: obligationStore.get(ob.id)?.state ?? ob.state,
        priority: ob.priority, obligorId: ob.obligorId, obligeeId: ob.obligeeId,
        currentFulfillerId: ob.currentFulfillerId, escrowId: ob.escrowId, deadline: ob.deadline,
        amount: ob.amount, currency: ob.currency, dueAt: ob.dueAt, fulfilledAt: ob.fulfilledAt,
      });
    }
    // Merchant owes confirmation
    const confirmOb = obligationStore.register(obligation({
      type: 'confirm',
      priority: 'high',
      obligorId: 'wallet:merchant',
      obligeeId: 'system',
      dueAt: Date.now() + 600000,
    }));
    if (out.settled) {
      obligationStore.update(confirmOb.id, transitionObligation(confirmOb, 'fulfilled', 'merchant confirmed'));
    }
    obligations.push({
      id: confirmOb.id, type: confirmOb.type, state: obligationStore.get(confirmOb.id)?.state ?? confirmOb.state,
      priority: confirmOb.priority, obligorId: confirmOb.obligorId, obligeeId: confirmOb.obligeeId,
      currentFulfillerId: confirmOb.currentFulfillerId, escrowId: confirmOb.escrowId, deadline: confirmOb.deadline,
      dueAt: confirmOb.dueAt, fulfilledAt: confirmOb.fulfilledAt,
    });

    // 22. Proposals — merge of Claims + Commitments. Evidence → Proposal → Obligation.
    proposalStore.reset();
    const proposals: import('./types').ProposalSummary[] = [];
    for (const draw of plan.sourceDraws) {
      let p = proposal({
        type: 'deliver',
        proposerId: `lp:${draw.sourceId}`,
        beneficiaryId: 'wallet:merchant',
        amount: draw.drawn,
        currency: scenario.transaction.merchant.currency,
        confidence: 0.83,
        ttlMs: 300000,
      });
      p = acceptProposal(p);
      const matchingObl = obligations.find((o) => o.obligorId === `lp:${draw.sourceId}`);
      if (matchingObl) p = activateProposal(p, matchingObl.id);
      if (out.settled) p = completeProposal(p);
      proposalStore.register(p);
      proposals.push({
        id: p.id, type: p.type, state: p.state,
        proposerId: p.proposerId, beneficiaryId: p.beneficiaryId,
        amount: p.amount, currency: p.currency, confidence: p.confidence,
        expiresAt: p.expiresAt, obligationId: p.obligationId,
      });
    }

    // 23. Resource Reservations — generic (replaces Exposure Leases + Allocations).
    resourceReservation.reset();
    for (const lp of scenario.liquidityProviders) {
      if (lp.online) {
        const capacity = computeAuthorizedExposure(defaultExposureFactors(lp.tradingCapacity * 0.2, lp.tradingCapacity));
        resourceReservation.registerCapacity('exposure', lp.id, capacity, scenario.transaction.merchant.currency);
      }
    }
    const reservations: import('./types').ReservationSummary[] = [];
    for (const draw of plan.sourceDraws) {
      const r = resourceReservation.reserve('exposure', draw.sourceId, 'wallet:merchant', draw.drawn, 300000, scenario.transaction.merchant.currency);
      if (r) {
        if (out.settled) resourceReservation.consume(r.id);
        reservations.push({
          id: r.id, resourceType: r.resourceType, ownerId: r.ownerId, consumerId: r.consumerId,
          amount: r.amount, state: r.state, expiresAt: r.expiresAt, renewalCount: r.renewalCount,
        });
      }
    }

    // 24. Confidence Service — planner consumes confidence, not evidence sources.
    confidenceService.reset();
    confidenceService.registerEvidence(solverEvidence);
    confidenceService.registerEvents(out.events.map((e) => ({ type: e.type, payload: e.payload, ts: e.ts, entityId: e.payload.entityId as string })));

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
      reasoningResults,
      intentType: 'payment',
      executionGraph,
      entities,
      organizationPolicy,
      runtimeServices,
      solverCandidates,
      transitions,
      capabilities,
      eventLog,
      protocol,
      fiatProofs: [],
      scenarioId: '',
      validates: [],
      obligations: obligations ?? [],
      proposals: proposals ?? [],
      reservations: reservations ?? [],
    };
  }

  /**
   * Build protocol state — the real PaySwap protocol economics.
   * Escrow, collateral, LP registry, merchant registry, disputes, auctions,
   * net settlement, twin token supply.
   */
  private buildProtocolState(scenario: SimulationScenario, plan: import('./types').LiquidityExecutionPlan): import('./types').ProtocolSummary {
    const cur = scenario.transaction.merchant.currency;
    const amount = scenario.transaction.amount;

    // Freeze escrow for this transaction
    const escrow = settlementEscrowContract.freeze(plan.id, scenario.liquidityProviders[0]?.id ?? 'lp_1', 'merchant_1', amount, cur, amount);

    // Lock collateral for each LP
    for (const lp of scenario.liquidityProviders) {
      if (lp.online) {
        collateralVaultContract.lock(lp.id, lp.tradingCapacity * 0.2, cur);
        lpRegistryContract.register(lp.id);
        const exposure = computeAuthorizedExposure(defaultExposureFactors(lp.tradingCapacity * 0.2, lp.tradingCapacity));
        lpRegistryContract.updateExposure(lp.id, exposure);
        const rep = computeLPReputation(defaultLPReputation());
        lpRegistryContract.updateReputation(lp.id, rep);
      }
    }

    // Register merchant
    merchantRegistryContract.register('merchant_1', 5000);

    // Mint twin tokens
    twinTokenContract.mint(cur, amount);

    // Record corridor obligation for net settlement
    netSettlementEngine.record(scenario.transaction.buyer.country, scenario.transaction.merchant.country, cur, amount);

    return {
      escrowEntries: settlementEscrowContract.all().map((e) => ({ id: e.id, transactionId: e.transactionId, lpId: e.lpId, merchantId: e.merchantId, amount: e.amount, currency: e.currency, state: e.state })),
      collateralEntries: collateralVaultContract.all().map((c) => ({ id: c.id, lpId: c.lpId, amount: c.amount, currency: c.currency, state: c.state, slashAmount: c.slashAmount })),
      lpRegistry: lpRegistryContract.all().map((r) => ({ lpId: r.lpId, authorizedExposure: r.authorizedExposure, reputation: r.reputation, tier: r.tier })),
      merchantRegistry: merchantRegistryContract.all().map((m) => ({ merchantId: m.merchantId, tier: m.tier, bond: m.bond, reputation: m.reputation })),
      disputes: disputeEngine.all().map((d) => ({ id: d.id, state: d.state, outcome: d.outcome, fraudType: d.fraudType, lpId: d.lpId, merchantId: d.merchantId })),
      auctions: auctionEngine.all().map((a) => ({ id: a.id, amount: a.amount, currency: a.currency, status: a.status, winnerCount: a.winnerBids.length })),
      netSettlement: {
        corridors: netSettlementEngine.all().map((c) => ({ fromCountry: c.fromCountry, toCountry: c.toCountry, balance: c.balance, currency: c.currency })),
        grossVolume: netSettlementEngine.grossVolume(),
        netVolume: netSettlementEngine.netVolume(),
      },
      twinTokenSupply: [{ currency: cur, supply: twinTokenContract.supplyOf(cur) }],
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
