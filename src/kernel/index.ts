/**
 * PaySwap Kernel — public entry point (Global Liquidity OS).
 *
 * The kernel manages GLOBAL LIQUIDITY, not payments. A payment is one
 * possible liquidity movement. Every operation is a desired liquidity state
 * transition captured in an immutable Liquidity Execution Plan that simulation
 * and production execute identically.
 */
export * from './types';
export { KERNEL_VERSION, CURRENCIES, COUNTRY_FLAGS, COUNTRIES, COUNTRY_OPTIONS, FO_META, PRIORITY_WEIGHTS, formatMoney, formatDuration, round, hashMetrics } from './support';
export { ENGINES, ENGINE_COUNT, RUNTIME_SERVICES } from './registry';
export { simulationEngine, SimulationEngine } from './simulation';
export { OptimizationEngine } from './optimization-engine';
export { WorldStore, buildWorldFromScenario, summarizeWorld } from './world-store';
export type { WorldState, WorldSnapshot } from './world-store';
export { stateMachine, StateMachineEngine, STATE_MACHINES, stateLabel, allowedNextStates } from './state-machine';
export type { ObjectKind, PlanState, InsuranceState, LPState, MerchantState, ReserveState, StateTransition, StateMachineDefinition } from './state-machine';
export { FinancialReasoningEngine, reasoningEngine } from './reasoning-engine';
export type { ReasoningCategory, ReasoningResult, ReasoningRecommendation } from './reasoning-engine';
export { createEntity, entitiesFromScenario, ENTITY_META } from './entity';
export type { Entity, EntityType, EntityCapabilities, EntityPolicies, EntityRelationship, EntityMetadata } from './entity';
export { Commands, COMMAND_LABELS } from './command';
export type { Command, CommandType } from './command';
export { buildExecutionGraph, topologicalOrder, parallelLayers } from './execution-graph';
export type { ExecutionGraph, GraphNode, GraphEdge, GraphNodeStatus, GraphNodeType } from './execution-graph';
export { ConvergencePlanner, convergencePlanner } from './planner';
export type { ConvergenceIntent, PlannerOutput, ConvergencePlan, Strategy } from './planner';
export { capabilityRegistry, ALL_CAPABILITIES, CAPABILITY_LABELS, entitiesWithCapability, entitiesWithCapabilityIn, canPerform } from './capabilities';
export type { Capability } from './capabilities';
export { transition, buildTransitionsForDelta, verifyPreconditions, verifyPostconditions } from './transition';
export type { Transition } from './transition';
export { createEventSourcedWorld, appendEvent, appendTransition, currentWorld, rebuildWorld, rewindTo, diffWorlds, eventLogSummary } from './event-sourced-world';
export type { EventSourcedWorld, WorldEvent } from './event-sourced-world';
export { createEvidence, computeEvidenceConfidence, effectiveLiquidityFromEvidence, expireEvidence, revokeEvidence, validEvidenceFor, EvidenceStore, evidenceStore, EvidenceGraph, evidenceGraph } from './evidence';
export type { Evidence, EvidenceType, EvidenceSource, VerificationLevel, EvidenceCitation, EvidenceNode } from './evidence';
export { obligation, transitionObligation, transferFulfiller, isOverdue, isActive, ObligationStore, obligationStore, OBLIGATION_LABELS } from './obligation';
export type { Obligation, ObligationType, ObligationState, ObligationPriority } from './obligation';
export { proposal, accept as acceptProposal, reject as rejectProposal, activate as activateProposal, complete as completeProposal, expire as expireProposal, withdraw as withdrawProposal, breach as breachProposal, canActivate, isExpired as isProposalExpired, isActive as isProposalActive, ProposalStore, proposalStore, PROPOSAL_LABELS } from './proposal';
export type { Proposal, ProposalType, ProposalState } from './proposal';
export { ResourceReservation, resourceReservation } from './resource-reservation';
export type { Reservation, ReservationState, ResourceCapacity } from './resource-reservation';
export { ConfidenceService, confidenceService } from './confidence-service';
export type { ConfidenceQuery, ConfidenceResult } from './confidence-service';
export { ProjectionEngine, projectionEngine, reputationProjection, exposureProjection, settlementRateProjection, riskProjection, capacityProjection } from './projection-engine';
export type { Projection, WorldEvent as ProjectionEvent } from './projection-engine';
export { PlanExecutor } from './plan-executor';
export { LedgerEngine } from './ledger';
export { ReserveEngine } from './reserve';
export { TwinTokenEngine } from './twin-token';
export { FxEngine, fxEngine } from './fx';
export { PricingEngine, pricingEngine } from './pricing';
export { RiskEngine, riskEngine } from './risk';
export { ComplianceEngine, complianceEngine } from './compliance';
export { FraudEngine, fraudEngine } from './fraud';
export { TreasuryEngine, treasuryEngine } from './treasury';
export { TreasuryAI, treasuryAI } from './treasury-ai';
export { InsuranceEngine, insuranceEngine, statusLabel as insuranceStatusLabel } from './insurance';
export { AIAgentEngine, aiAgentEngine } from './ai-agent';
export { PolicyEngine, policyEngine } from './policy';
export { PermissionEngine, permissionEngine } from './permission';
export { AuditEngine, auditEngine } from './audit';
export { EventEngine, eventEngine } from './event';
export { WorkflowEngine, workflowEngine, manualSettlementSteps, insuranceClaimSteps } from './workflow';
export { ExtensionRuntime, extensionRuntime } from './extension';
export { TransactionEngine } from './transaction';
export { ScenarioLibrary } from './scenario-library';
export { FinancialGraph, buildGraph } from './financial-graph';
export { CONSTITUTION, evaluateConstitution } from './constitution';
export { kernel, intentToScenario } from './api';
export type { LiquidityIntent } from './api';
export { EventCatalog, EVENT_LABELS } from './events';
export { lpLifecycle, LPLifecycleEngine } from './lp-lifecycle';
export type { TwinTokenContract, LiquidityPoolContract, TreasuryContract, InsuranceContract, GovernanceContract } from './lp-lifecycle';

import type { SimulationScenario, LiquidityProvider, FinancialOperator, FailureInjection } from './types';
import { uid } from './support';

/**
 * Canonical default scenario: Kenya → Ghana, 25,000 GHS, cheapest.
 * Includes 3 community LPs in the buyer corridor + 2 financial operators.
 */
export function defaultScenario(): SimulationScenario {
  return {
    name: 'Kenya → Ghana (cheapest)',
    description: 'Canonical cross-border corridor. LP2 (0.8%) exhausted first, then LP1 (1.1%).',
    transaction: {
      type: 'cross_border',
      buyer: { country: 'Kenya', currency: 'KES', method: 'M-Pesa', foId: 'fo-mpesa-ke' },
      merchant: { country: 'Ghana', currency: 'GHS', method: 'Bank Transfer', foId: 'fo-bank-gh' },
      amount: 25000,
      currency: 'GHS',
      merchantType: 'Export merchant',
      customerType: 'Retail buyer',
      priority: 'cheapest',
    },
    treasury: {
      originReserve: { country: 'Kenya', currency: 'KES', available: 0, minThreshold: 0 },
      destinationReserve: { country: 'Ghana', currency: 'GHS', available: 100000, minThreshold: 10000 },
      stablecoinBalance: 50000,
      emergencyTreasury: 20000,
      reservePolicy: 'hybrid',
    },
    liquidityProviders: [
      lp('1', 'Acacia LP', 'Kenya', 'GHS', 'community_lp', 50000, 1.1, 52000, false),
      lp('2', 'Baobab LP', 'Kenya', 'GHS', 'community_lp', 10000, 0.8, 44000, false),
      lp('3', 'Cooperative Pool KE', 'Kenya', 'GHS', 'cooperative_pool', 250000, 1.4, 61000, false),
    ],
    financialOperators: [
      fo('fo-mpesa-ke', 'mobile_money', 'M-Pesa', 'Kenya', ['KES'], 12000, 80, 0, 0.985, 500000, 10, ['domestic', 'cross_border']),
      fo('fo-bank-gh', 'bank_account', 'Ghana Commercial Bank', 'Ghana', ['GHS'], 30000, 40, 0, 0.97, 1000000, 100, ['domestic', 'cross_border']),
      fo('fo-visa', 'visa', 'Visa', 'Kenya', ['KES', 'USD'], 4000, 150, 0, 0.999, 200000, 5, ['cross_border']),
    ],
    policies: {
      reservePolicy: 'hybrid',
      maxLpShare: 0.7,
      maxCostPercent: 5,
      maxRiskScore: 0.6,
      requireInsurance: false,
    },
    failures: [],
    aiWeights: { cost: 0.7, speed: 0.1, safety: 0.2, liquidityPreservation: 0.2, merchantSatisfaction: 0.3, communityImpact: 0.05, carbonImpact: 0.05, treasuryHealth: 0.3 },
  };
}

/** Library of canonical regression scenarios. */
export function libraryScenarios(): { scenario: SimulationScenario; category: string }[] {
  const base = defaultScenario();
  return [
    { scenario: base, category: 'Canonical' },
    {
      scenario: {
        ...base,
        name: 'Reserve exhaustion + manual settlement',
        description: 'Destination reserve drained; LP requires manual settlement.',
        treasury: { ...base.treasury, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 8000, minThreshold: 10000 } },
        liquidityProviders: [lp('1', 'Acacia LP', 'Kenya', 'GHS', 'community_lp', 50000, 1.1, 52000, true), lp('2', 'Baobab LP', 'Kenya', 'GHS', 'community_lp', 10000, 0.8, 44000, false)],
        failures: [{ id: uid('fail'), type: 'reserve_exhaustion', label: 'Ghana reserve exhausted', targetId: 'Ghana', atFrame: 4 }],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      category: 'Failure',
    },
    {
      scenario: {
        ...base,
        name: 'Dual LP failure',
        description: 'LP disappears mid-transaction; treasury bridge fallback.',
        failures: [{ id: uid('fail'), type: 'lp_disappear', label: 'Baobab LP goes offline', targetId: '2', atFrame: 4 }],
        transaction: { ...base.transaction, priority: 'fastest' },
      },
      category: 'Failure',
    },
    {
      scenario: {
        ...base,
        name: 'Nigeria PSP outage',
        description: 'PSP timeout with network partition in origin country.',
        transaction: { ...base.transaction, buyer: { country: 'Nigeria', currency: 'NGN', method: 'Bank Transfer', foId: 'fo-bank-ng' }, amount: 500000, currency: 'GHS' },
        treasury: { originReserve: { country: 'Nigeria', currency: 'NGN', available: 5000000, minThreshold: 500000 }, destinationReserve: { country: 'Ghana', currency: 'GHS', available: 200000, minThreshold: 20000 }, stablecoinBalance: 100000, emergencyTreasury: 50000, reservePolicy: 'lp_first' },
        liquidityProviders: [lp('1', 'Lagos LP', 'Nigeria', 'GHS', 'community_lp', 200000, 1.2, 55000, false), lp('2', 'Abuja Pool', 'Nigeria', 'GHS', 'diaspora_pool', 300000, 1.0, 48000, false)],
        failures: [
          { id: uid('fail'), type: 'psp_timeout', label: 'PSP timeout', targetId: 'fo-bank-ng', atFrame: 2 },
          { id: uid('fail'), type: 'network_partition', label: 'Network partition Nigeria', targetId: 'Nigeria', atFrame: 3 },
        ],
        transaction_priority: undefined as never,
      } as SimulationScenario,
      category: 'Failure',
    },
    {
      scenario: {
        ...base,
        name: 'Peak harvest season',
        description: 'High-volume corridor with community-impact priority.',
        transaction: { ...base.transaction, amount: 150000, priority: 'impact' },
        liquidityProviders: [lp('1', 'Acacia LP', 'Kenya', 'GHS', 'community_lp', 200000, 1.0, 50000, false), lp('2', 'Cooperative Pool', 'Kenya', 'GHS', 'cooperative_pool', 300000, 0.9, 55000, false), lp('3', 'Diaspora Pool', 'Kenya', 'GHS', 'diaspora_pool', 150000, 1.1, 60000, false)],
        aiWeights: { cost: 0.2, speed: 0.1, safety: 0.3, liquidityPreservation: 0.2, merchantSatisfaction: 0.2, communityImpact: 0.5, carbonImpact: 0.4, treasuryHealth: 0.2 },
      },
      category: 'Stress',
    },
    {
      scenario: {
        ...base,
        name: 'Fraud alert + insurance claim',
        description: 'Fraud detected mid-transaction; insurance claim filed and denied.',
        failures: [{ id: uid('fail'), type: 'fraud_alert', label: 'Fraud alert', atFrame: 3 }],
        transaction: { ...base.transaction, priority: 'safest' },
      },
      category: 'Failure',
    },
  ];
}

function lp(
  id: string, name: string, country: string, currency: import('./types').CurrencyCode,
  sourceKind: import('./types').LiquiditySourceKind, capacity: number, fees: number, speed: number, manual: boolean,
): LiquidityProvider {
  return {
    id, name, country, currency, sourceKind,
    twinTokenPosition: capacity * 0.5, fiatPosition: capacity,
    financialOperators: [], tradingFees: fees, tradingCapacity: capacity,
    riskProfile: 0.2, settlementSpeedMs: speed, insuranceCoverage: capacity * 0.5,
    availability: 0.95, historicalPerformance: 0.97, aiReputation: 0.85,
    manualOnly: manual, online: true,
  };
}

function fo(
  id: string, type: import('./types').FinancialOperatorType, name: string, country: string,
  currencies: import('./types').CurrencyCode[], latencyMs: number, feeBps: number, feeFixed: number,
  uptime: number, maxAmount: number, minAmount: number, routes: ('domestic' | 'cross_border')[],
): FinancialOperator {
  return {
    id, type, name, country, supportedCurrencies: currencies,
    latencyMs, feeBps, feeFixed, uptime, failureRate: 1 - uptime,
    maxAmount, minAmount, supportedRoutes: routes, online: true, manualOnly: false,
  };
}
