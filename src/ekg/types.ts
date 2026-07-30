/**
 * Economic Knowledge Graph (EKG) — Type Definitions.
 *
 * THE FOUNDATION. A unified typed property graph where everything is a node:
 * entities, capabilities, assets, goals, policies, jurisdictions, memory,
 * observations, evidence, contracts, risks, time. Capabilities become
 * relationships between nodes (Entity ──OFFERS──► Capability ──REQUIRES──► Asset).
 *
 * The planner does graph search: prove(goal) decomposes the goal into subgoals,
 * searches graph paths for capabilities that SATISFY each subgoal, recurses on
 * required assets (which become subgoals), ranks multiple proofs, and supports
 * backtracking when constraints fail.
 *
 * Every node + relationship is temporally versioned (validFrom/validTo) so
 * replay, simulation, forecasting, and counterfactuals are native graph queries.
 *
 * The proof language produces machine-verifiable Proof structures: a goal is
 * proven by exhibiting a decomposition tree + settlement graph that satisfies
 * all constraints. verify(proof) re-checks every invariant.
 *
 *   prove(goal, constraints) → Proof[]
 *   simulate(proof) → SimulationResult
 *   execute(proof) → ExecutionResult
 *   verify(proof) → boolean
 *
 * This module is the foundational layer underneath src/economic-platform/,
 * src/economic-engine/, src/economic-os/, src/economic/, src/runtime/.
 * Does NOT modify the Prisma schema.
 */

// ═══════════════════════════════════════════════════════════════════════════
// THE GRAPH — unified typed property graph. Everything is a node.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The kind of a graph node. Everything in the economic substrate is one of
 * these. Organizations disappear into ENTITY (with labels). Capabilities,
 * assets, goals, policies, jurisdictions, memory, observations, evidence,
 * contracts, risks, and time are all first-class nodes.
 */
export type NodeKind =
  | 'ENTITY'        // an autonomous participant (org, human, AI, API, bank, gov, device, DAO, service)
  | 'CAPABILITY'    // a unit of economic work
  | 'ASSET'         // anything that can flow (currency, credential, bandwidth, carbon, ...)
  | 'GOAL'          // a desired state
  | 'POLICY'        // an executable constraint
  | 'JURISDICTION'  // a regulatory region
  | 'MEMORY'        // a learned experience record
  | 'OBSERVATION'   // a sensor / real-world reading
  | 'EVIDENCE'      // a proof artifact
  | 'CONTRACT'      // an executable agreement
  | 'RISK'          // a quantified risk
  | 'TIME'          // a temporal marker (for versioning)
  | 'COST'          // a cost model
  | 'INTENT';       // a pre-goal expression

/**
 * The label on an ENTITY node. Organizations disappear — everything is an
 * Entity with one or more labels. Adding a Human is identical to adding GPT-6.
 */
export type EntityLabel =
  | 'ORGANIZATION' | 'HUMAN' | 'AI_MODEL' | 'API' | 'BANK'
  | 'GOVERNMENT' | 'DEVICE' | 'DAO' | 'SERVICE' | 'BLOCKCHAIN';

/**
 * A node in the economic knowledge graph. Every node is temporally versioned:
 * validFrom/validTo define when this version of the node was/is true. This
 * enables replay (state at time T), simulation, forecasting, and counterfactuals.
 */
export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;               // human-readable
  labels?: EntityLabel[];      // for ENTITY nodes (an entity can have multiple labels)
  /** Arbitrary typed properties (the property graph part). */
  properties: Record<string, unknown>;
  /** When this version of the node became true (epoch ms). */
  validFrom: number;
  /** When this version stopped being true (epoch ms). Undefined = still current. */
  validTo?: number;
  /** The previous version of this node (for replay). */
  previousVersionId?: string;
}

/**
 * The type of a relationship between graph nodes. Capabilities become
 * relationships: Entity ──OFFERS──► Capability ──REQUIRES──► Asset.
 */
export type RelationshipType =
  | 'OFFERS'           // Entity → Capability
  | 'REQUIRES'         // Capability → Asset (input)
  | 'PRODUCES'         // Capability → Asset (output)
  | 'SATISFIES'        // Capability → Goal
  | 'CONSTRAINED_BY'   // Capability/Entity → Policy
  | 'LOCATED_IN'       // Entity/Capability → Jurisdiction
  | 'TRUSTS'           // Entity → Entity
  | 'GOVERNS'          // Jurisdiction/Policy → Entity/Capability
  | 'OWNS'             // Entity → Asset
  | 'HOLDS'            // Entity → Asset (current balance/holding)
  | 'DEPENDS_ON'       // Capability → Capability
  | 'COMPETES_WITH'    // Entity → Entity (same capability)
  | 'LEARNED_FROM'     // Memory → Capability/Entity/Proof
  | 'OBSERVED'         // Observation → Entity/Asset
  | 'VERIFIES'         // Evidence → Capability/Proof
  | 'PRICED_IN'        // Capability → Cost
  | 'DECOMPOSES_INTO'  // Goal → Goal (subgoal)
  | 'SETTLES'          // Capability → Goal (after execution)
  | 'PRECEDES'         // Time → Time (causal ordering)
  | 'AFFECTS';         // Risk → Entity/Capability

/**
 * A typed relationship between two graph nodes. Also temporally versioned.
 */
export interface GraphRelationship {
  id: string;
  from: string;                // node id
  to: string;                  // node id
  type: RelationshipType;
  properties: Record<string, unknown>;
  validFrom: number;
  validTo?: number;
}

/**
 * The unified graph — the only data structure.
 */
export interface EconomicKnowledgeGraph {
  nodes: Map<string, GraphNode>;
  relationships: GraphRelationship[];
}

// ═══════════════════════════════════════════════════════════════════════════
// GOALS + CONSTRAINTS
// ═══════════════════════════════════════════════════════════════════════════

export interface Goal {
  id: string;
  name: string;
  description: string;
  category?: string;
  /** The asset node id that must be produced for the goal to be satisfied. */
  targetAsset: string;
  /** Assets the user brings (assetId → amount). */
  inputs: Record<string, number>;
  /** Constraints on the proof. */
  constraints?: Constraints;
  /** Whether this goal decomposes into subgoals. */
  subgoals?: string[];         // goal ids
  createdAt: number;
}

export interface Constraints {
  budget?: number;
  deadline?: number;           // ms
  minTrust?: number;
  maxCarbon?: number;
  maxRisk?: number;
  jurisdiction?: string;       // jurisdiction node id
  preferEntityLabel?: EntityLabel;
  excludeEntities?: string[];
  requireEntities?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROOFS — machine-verifiable. The planner's output.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A proof step — a node in the decomposition tree. Either:
 *   - a GOAL step (the goal or a subgoal)
 *   - a CAPABILITY step (a capability that satisfies a goal)
 *   - an INPUT step (an asset the user provides)
 *   - a SETTLEMENT step (the final atomic settlement)
 *
 * Each step records which graph nodes it involves + the invariant checks that
 * verify it. The tree structure makes the proof recursively verifiable.
 */
export interface ProofStep {
  id: string;
  kind: 'GOAL' | 'CAPABILITY' | 'INPUT' | 'SETTLEMENT';
  goalId?: string;             // for GOAL steps
  goalName?: string;
  capabilityId?: string;       // for CAPABILITY steps
  capabilityName?: string;
  entityId?: string;           // the provider entity
  entityName?: string;
  entityLabel?: EntityLabel;
  assetId?: string;            // for INPUT steps
  produces: string[];          // asset ids produced
  consumes: string[];          // asset ids consumed
  cost: number;
  latencyMs: number;
  trustScore: number;
  carbon: number;
  risk: number;
  reasoning: string;
  /** Child steps — the decomposition. */
  children: ProofStep[];
  /** Alternatives considered at this step (for ranking). */
  alternatives?: Array<{ entityId: string; entityName: string; entityLabel: EntityLabel; cost: number; latencyMs: number; trustScore: number; reason: string }>;
}

export type ProofStatus = 'proposed' | 'simulated' | 'verified' | 'settled' | 'failed' | 'verification_failed';

/**
 * A machine-verifiable economic proof. The planner produces this; verify(proof)
 * re-checks every invariant. The proof explains *why* the plan satisfies the
 * requested constraints.
 */
export interface Proof {
  id: string;
  goalId: string;
  goalName: string;
  /** The root of the decomposition tree. */
  root: ProofStep;
  /** Aggregate scores. */
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  carbon: number;
  risk: number;
  /** Distinct entity labels involved (the heterogeneity signature). */
  entityLabels: EntityLabel[];
  capabilityCount: number;
  entityCount: number;
  /** The planner's score (0–100). */
  plannerScore: number;
  scoreBreakdown: { dimension: string; score: number; weight: number }[];
  status: ProofStatus;
  /** The verification signature — re-checked by verify(proof). */
  verification?: Verification;
  /** Simulation result, if simulated. */
  simulation?: SimulationResult;
  /** Memory references that informed this proof. */
  memoryHits?: number;
  predictedSuccessRate?: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION — the proof language's checker
// ═══════════════════════════════════════════════════════════════════════════

export interface InvariantCheck {
  id: string;
  name: string;
  category: 'ASSET_CONSERVATION' | 'GOAL_SATISFACTION' | 'TRUST' | 'BUDGET' | 'DEADLINE' | 'CARBON' | 'RISK' | 'POLICY' | 'JURISDICTION' | 'DECOMPOSITION';
  passed: boolean;
  detail: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
}

export interface Verification {
  proofId: string;
  checks: InvariantCheck[];
  allPassed: boolean;
  criticalFailures: number;
  majorFailures: number;
  /** A cryptographic-style signature summarizing the proof (hash of the tree). */
  signature: string;
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATION — estimate before execution
// ═══════════════════════════════════════════════════════════════════════════

export interface SimulationResult {
  proofId: string;
  estimatedCost: number;
  estimatedLatencyMs: number;
  estimatedCarbon: number;
  estimatedRisk: number;
  /** Predicted success probability (0–1). */
  successProbability: number;
  /** Regulatory impact assessment. */
  regulatoryImpact: { jurisdiction: string; compliant: boolean; notes: string }[];
  /** Liquidity effect — how this execution affects reserve/bandwidth graph. */
  liquidityEffect: { assetId: string; delta: number };
  /** Counterfactual: what happens if we DON'T execute (the goal remains unsatisfied). */
  counterfactual: string;
  /** Forecasted state changes (which nodes would be versioned). */
  projectedStateChanges: { nodeId: string; property: string; from: unknown; to: unknown }[];
  simulatedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecutionResult {
  proofId: string;
  goalId: string;
  goalName: string;
  status: 'SETTLED' | 'FAILED' | 'VERIFICATION_FAILED';
  verification: Verification;
  /** The memory node id recorded (learning). */
  memoryNodeId?: string;
  /** Entities whose state changed (P&L, reliability). */
  affectedEntities: string[];
  totalRevenue: number;
  totalCost: number;
  /** How many graph nodes were versioned (time-stamped). */
  versionedNodes: number;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export interface EKGOverview {
  nodeCount: number;
  relationshipCount: number;
  entityCount: number;
  entityLabelCount: number;
  capabilityCount: number;
  assetCount: number;
  goalCount: number;
  policyCount: number;
  jurisdictionCount: number;
  memoryCount: number;
  proofCount: number;
  settledProofCount: number;
  /** Temporal: how many node versions exist (history). */
  versionedCount: number;
  avgSuccessRate: number;
}
