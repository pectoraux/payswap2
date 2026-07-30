/**
 * Economic Computation Platform — Type Definitions.
 *
 * THE FINAL ARCHITECTURE. Capabilities are the primitive; everything else is
 * emergent. The platform has ONE data structure: a graph. Nodes are
 * capabilities, providers (heterogeneous: organizations, AI models, humans,
 * APIs, IoT devices, banks, government agencies), assets, memory, policies,
 * goals, constraints, proofs, jurisdictions. Edges are typed relations
 * (produces, consumes, owns, trusts, prices, verifies, settles, governs,
 * requires, depends_on, competes_with, compatible_with).
 *
 * The planner does graph search over CAPABILITIES, not organizations. Anyone
 * can provide a capability — a university, an AI model, a freelancer, an API,
 * a government agency. The planner doesn't care what kind of entity provides
 * it; it picks the best provider per capability based on cost, latency, trust,
 * and learned memory.
 *
 * The economy is self-improving: every execution teaches the graph. Memory
 * records structured capability-to-capability performance under context
 * (jurisdiction, time, risk, seasonality). measure() → learn() → update
 * scores → next resolve() is better.
 *
 *   resolve(goal)
 *     → graph search
 *     → capability discovery
 *     → market optimization (pick best provider per capability)
 *     → constraint solving
 *     → economic proof
 *     → settlement
 *     → learning
 *
 * This module is a NEW layer parallel to src/economic-engine/, src/economic-os/,
 * src/economic/, src/runtime/. Does NOT modify the Prisma schema.
 */

// ═══════════════════════════════════════════════════════════════════════════
// CAPABILITIES — THE primitive. Everything else is emergent.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A capability — a unit of economic work that can be provided by anyone.
 * "Issue Education Credit", "Settle Payment", "Verify Identity",
 * "Summarize Text", "Translate", "Provide Storage", "Detect Fraud".
 *
 * Capabilities are implementation-agnostic. The planner discovers which
 * capabilities are required to satisfy a goal, then finds providers for each.
 */
export interface Capability {
  id: string;                  // 'cap.issue_education_credit'
  name: string;                // 'Issue Education Credit'
  description: string;
  category: string;            // 'education' | 'finance' | 'ai' | 'identity' | ...
  /** The asset types this capability produces. */
  produces: string[];          // asset type ids
  /** The asset types this capability requires (consumes as inputs). */
  requires: string[];          // asset type ids
  /** Trust requirements for this capability to be invoked. */
  minTrust?: number;
  /** Typical latency range across providers (ms). */
  typicalLatencyMs: number;
  /** Whether this capability can be provided by multiple provider types. */
  universal: boolean;          // true = anyone can provide (e.g. storage); false = restricted (e.g. issue_license)
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDERS — heterogeneous. Anything can provide a capability.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The kind of entity that provides a capability. This is the key abstraction:
 * organizations, AI models, humans, APIs, IoT devices, banks, and government
 * agencies are ALL just providers. The planner treats them identically.
 */
export type ProviderKind =
  | 'ORGANIZATION'    // a company / institution
  | 'AI_MODEL'        // Claude, GPT, Gemini, a custom model
  | 'HUMAN'           // a freelancer, worker, expert
  | 'API'             // Stripe, Twilio, AWS, PaySwap
  | 'IOT_DEVICE'      // a sensor, robot, physical device
  | 'BANK'            // a financial institution
  | 'GOVERNMENT'      // a government agency
  | 'BLOCKCHAIN';     // a smart contract / protocol

export const PROVIDER_KIND_META: Record<ProviderKind, { label: string; color: string; icon: string }> = {
  ORGANIZATION: { label: 'Organization', color: 'emerald', icon: 'Building2' },
  AI_MODEL:     { label: 'AI Model',     color: 'violet',  icon: 'Brain' },
  HUMAN:        { label: 'Human',        color: 'amber',   icon: 'User' },
  API:          { label: 'API',          color: 'sky',     icon: 'Webhook' },
  IOT_DEVICE:   { label: 'IoT Device',   color: 'orange',  icon: 'Cpu' },
  BANK:         { label: 'Bank',         color: 'teal',    icon: 'Landmark' },
  GOVERNMENT:   { label: 'Government',   color: 'rose',    icon: 'Scale' },
  BLOCKCHAIN:   { label: 'Blockchain',   color: 'fuchsia', icon: 'Box' },
};

export type ProviderStatus = 'ACTIVE' | 'PAUSED' | 'SUSPENDED';

/**
 * A capability provider — any entity that can provide one or more capabilities.
 * This is the unified abstraction: a university, Claude, a freelancer, Stripe,
 * a temperature sensor, a central bank, and a smart contract are all providers.
 */
export interface CapabilityProvider {
  id: string;
  name: string;                // 'University of Ghana' | 'Claude 3.5' | 'Stripe' | 'Temperature Sensor #42'
  kind: ProviderKind;
  status: ProviderStatus;
  description: string;
  /** The capabilities this provider offers. */
  offers: ProviderOffer[];
  /** Aggregate trust score (0–100), updated by the learning loop. */
  trustScore: number;
  /** Aggregate reputation (0–100). */
  reputation: number;
  /** Cumulative revenue earned (USD). */
  revenue: number;
  /** Cumulative costs (USD). */
  costs: number;
  /** Total capability invocations. */
  invocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  /** Self-improving reliability score (0–100), updated by measure() + learn(). */
  reliabilityScore: number;
  /** Trend of reliability over time. */
  reliabilityTrend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  /** Jurisdictions where this provider is approved. */
  jurisdictions: string[];
  /** Carbon footprint per invocation (kgCO2e) — negative for carbon-removing providers. */
  carbonPerInvocation: number;
  registeredAt: number;
}

/**
 * A provider's offer for a specific capability — the marketplace listing.
 * Multiple providers can offer the same capability at different prices,
 * latencies, and trust levels. The planner picks the best per resolve().
 */
export interface ProviderOffer {
  capabilityId: string;
  pricePerInvocation: number;  // USD
  latencyMs: number;
  slaSuccessRate: number;      // 0–1
  capacity: number;            // max concurrent invocations
  region: string;              // 'global' | 'GH' | 'NG' | ...
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSET TYPES — anything that can flow. Tokens become one implementation.
// ═══════════════════════════════════════════════════════════════════════════

export type AssetTypeCategory =
  | 'CURRENCY' | 'CREDENTIAL' | 'REPUTATION' | 'BANDWIDTH' | 'ATTENTION'
  | 'CARBON' | 'ENERGY' | 'IDENTITY' | 'TIME' | 'GPU' | 'CPU' | 'STORAGE'
  | 'RISK' | 'KNOWLEDGE' | 'PROOF' | 'OWNERSHIP' | 'GOVERNANCE' | 'LICENSE'
  | 'API_CALL' | 'INFERENCE' | 'RESERVATION' | 'QUOTA' | 'PROMISE' | 'DEBT'
  | 'INSURANCE' | 'ROUTE' | 'CAPACITY' | 'RECEIPT' | 'EVIDENCE' | 'RIGHT';

export interface AssetType {
  id: string;                  // 'currency.usd' | 'credential.identity' | 'inference.text'
  name: string;
  category: AssetTypeCategory;
  unit: string;
  description: string;
  color: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED GRAPH — the only data structure. Everything is a node + typed edges.
// ═══════════════════════════════════════════════════════════════════════════

export type GraphNodeKind =
  | 'CAPABILITY' | 'PROVIDER' | 'ASSET' | 'GOAL' | 'PROOF'
  | 'MEMORY' | 'POLICY' | 'JURISDICTION';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel?: string;
  group?: string;
  color?: string;
}

export type GraphEdgeKind =
  | 'produces' | 'consumes' | 'offers' | 'trusts' | 'prices'
  | 'verifies' | 'settles' | 'governs' | 'requires' | 'depends_on'
  | 'competes_with' | 'compatible_with' | 'learns_from';

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  weight?: number;
}

export interface UnifiedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ═══════════════════════════════════════════════════════════════════════════
// GOALS + CONSTRAINTS (carried forward, refined)
// ═══════════════════════════════════════════════════════════════════════════

export interface Goal {
  id: string;
  name: string;
  description: string;
  category: string;
  /** The asset type that must be produced for the goal to be satisfied. */
  targetAsset: string;
  /** Assets the user brings. */
  inputs: AssetBinding[];
  /** Constraints on the resolution. */
  constraints?: ConstraintBundle;
  createdAt: number;
}

export interface AssetBinding {
  assetId: string;
  amount: number;
}

export interface ConstraintBundle {
  budget?: number;
  deadline?: number;           // ms
  minTrust?: number;
  maxCarbon?: number;
  jurisdiction?: string;
  region?: string;
  preferProviderKind?: ProviderKind;
  excludeProviders?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC PROOFS — the planner's output. Capability-centric.
// ═══════════════════════════════════════════════════════════════════════════

export type ProofNodeKind = 'INPUT' | 'CAPABILITY' | 'OUTPUT' | 'OPPORTUNISTIC';

export interface ProofNode {
  id: string;
  kind: ProofNodeKind;
  capabilityId?: string;
  capabilityName?: string;
  providerId?: string;
  providerName?: string;
  providerKind?: ProviderKind;
  produces: AssetBinding[];
  consumes: AssetBinding[];
  cost: number;
  latencyMs: number;
  trustScore: number;
  carbon: number;
  reasoning?: string;
  /** Alternative providers considered for this capability. */
  alternatives?: Array<{ providerId: string; providerName: string; providerKind: ProviderKind; cost: number; latencyMs: number; trustScore: number; reason: string }>;
  status: 'pending' | 'selected' | 'executing' | 'completed' | 'failed';
}

export interface ProofEdge {
  from: string;
  to: string;
  assetId: string;
  amount: number;
}

export type ProofStatus = 'proposed' | 'verified' | 'settled' | 'failed' | 'verification_failed';

export interface EconomicProof {
  id: string;
  goalId: string;
  goalName: string;
  nodes: ProofNode[];
  edges: ProofEdge[];
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  carbon: number;
  capabilityCount: number;
  providerCount: number;
  /** Distinct provider kinds involved (the heterogeneity signature). */
  providerKinds: ProviderKind[];
  plannerScore: number;
  scoreBreakdown: { dimension: string; score: number; weight: number }[];
  status: ProofStatus;
  verification?: VerificationResult;
  memoryHits?: number;
  predictedSuccessRate?: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION — compositional + hierarchical
// ═══════════════════════════════════════════════════════════════════════════

export interface InvariantCheck {
  id: string;
  name: string;
  description: string;
  category: 'ASSET_CONSERVATION' | 'CAPABILITY_SATISFACTION' | 'TRUST' | 'BUDGET' | 'DEADLINE' | 'CARBON' | 'POLICY' | 'JURISDICTION';
  passed: boolean;
  detail: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
}

export interface VerificationResult {
  proofId: string;
  checks: InvariantCheck[];
  allPassed: boolean;
  criticalFailures: number;
  majorFailures: number;
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC MEMORY — structured, self-improving
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A structured economic memory record. Records that capability A was performed
 * by provider P under context C with outcome O. This is the data the learning
 * loop uses to update provider scores + planner biases.
 *
 * Unlike simple "goal succeeded" logs, these records are structured for
 * reinforcement learning: they capture the capability-to-capability
 * relationships, the context (jurisdiction, time, risk, seasonality), and
 * the outcome (latency, cost, trust, satisfaction).
 */
export interface EconomicMemoryRecord {
  id: string;
  goalId: string;
  goalName: string;
  proofId: string;
  /** The capability chain that was executed. */
  capabilities: string[];
  /** The providers that participated. */
  providers: string[];
  /** The context under which the execution happened. */
  context: {
    jurisdiction?: string;
    region?: string;
    timeOfDay?: string;        // 'morning' | 'afternoon' | 'evening' | 'night'
    seasonality?: string;      // 'peak' | 'off-peak' | 'holiday'
    riskLevel?: number;        // 0–100
  };
  /** The outcome. */
  outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  failureReason?: string;
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  carbon: number;
  customerSatisfaction?: number; // 0–100
  executedAt: number;
  durationMs: number;
}

/**
 * Learned provider scores — updated by the learning loop after every execution.
 * These feed back into the planner's provider selection.
 */
export interface ProviderLearningScore {
  providerId: string;
  providerName: string;
  capabilityId: string;
  totalExecutions: number;
  successRate: number;
  avgCost: number;
  avgLatencyMs: number;
  avgSatisfaction: number;
  /** The learned score (0–100) the planner uses for ranking. */
  learnedScore: number;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export interface PlatformOverview {
  capabilityCount: number;
  providerCount: number;
  providerKindCount: number;
  assetTypeCount: number;
  goalCount: number;
  proofCount: number;
  settledProofCount: number;
  memoryRecordCount: number;
  avgSuccessRate: number;
  totalExecutions: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  learningEntries: number;
}
