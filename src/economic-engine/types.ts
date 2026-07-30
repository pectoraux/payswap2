/**
 * General-Purpose Economic Computation Engine — Type Definitions.
 *
 * The capstone evolution. PaySwap is no longer a payment platform, a fintech
 * platform, an extension system, or even an economic operating system. It is
 * a runtime that compiles high-level GOALS into verified networks of autonomous
 * economic organizations exchanging typed assets under explicit constraints
 * and policies. Payments are just one specialization.
 *
 * Key shifts from src/economic-os/:
 *   1. Intent → Goal. Users express implementation-agnostic goals
 *      ("Ensure this student is enrolled") not implementations ("Pay tuition").
 *      The planner is free to choose payment, scholarship, sponsorship, voucher,
 *      credits, financing, tokenized rights, donations, or grants.
 *   2. Compiler → Planner. A constraint solver that finds MULTIPLE proofs
 *      (different strategies), scores them using economic memory, returns
 *      ranked alternatives.
 *   3. Actors → Organizations. Autonomous economic entities with governance,
 *      objectives, profit targets, workforce, liabilities — essentially
 *      programmable micro-companies.
 *   4. Pipelines disappear. Every execution is synthesized. No hand-written
 *      workflows. The planner discovers the graph from contracts + memory.
 *   5. Economic Memory. The platform remembers which graphs succeed/fail,
 *      which organizations cooperate well, cost/latency/trust patterns.
 *      The planner becomes adaptive.
 *   6. Verification Layer. Every execution produces an Economic Proof —
 *      a verifiable assertion that assets were conserved, policies respected,
 *      trust satisfied, settlement completed, no invariants broken.
 *   7. Universal resolve(). The primary programming model:
 *         resolve(goal, constraints, policies) → EconomicProof[]
 *
 * This module is a NEW layer parallel to src/economic-os/, src/economic/,
 * src/runtime/. It does NOT modify the Prisma schema.
 */

// ═══════════════════════════════════════════════════════════════════════════
// GOALS — implementation-agnostic. The user specifies WHAT, not HOW.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A goal — what the user wants to achieve. The planner is free to determine
 * the implementation. "Ensure this student is enrolled" could resolve to
 * payment, scholarship, sponsorship, voucher, credits, financing, etc.
 */
export interface Goal {
  id: string;
  name: string;                // 'Ensure student is enrolled'
  description: string;
  category: string;            // 'education' | 'logistics' | 'healthcare' | ...
  /** The target asset type that must exist for the goal to be satisfied. */
  targetAssetType: string;     // 'CREDENTIAL' | 'RECEIPT' | 'RESERVATION' | ...
  /** More specific target — an asset id or a predicate. */
  targetAsset?: string;        // 'education.enrollment'
  /** Assets the user brings to satisfy the goal. */
  inputs: AssetBinding[];
  /** The set of acceptable implementation strategies. The planner chooses. */
  acceptableStrategies: Strategy[];
  createdAt: number;
}

export type Strategy =
  | 'PAYMENT'          // pay for it with currency
  | 'SCHOLARSHIP'      // obtain via scholarship / grant
  | 'SPONSORSHIP'      // employer / third-party sponsorship
  | 'VOUCHER'          // government / institutional voucher
  | 'STORED_CREDITS'   // redeem previously-earned credits
  | 'DEFERRED_FINANCE' // financing / BNPL / loan
  | 'TOKENIZED_RIGHT'  // redeem a tokenized right
  | 'DONATION'         // funded by donation / charity
  | 'GRANT'            // government / institutional grant
  | 'TRADE'            // barter / asset swap
  | 'INSURANCE'        // insurance claim
  | 'SUBSCRIPTION';    // subscription entitlement

export const ALL_STRATEGIES: Strategy[] = [
  'PAYMENT', 'SCHOLARSHIP', 'SPONSORSHIP', 'VOUCHER', 'STORED_CREDITS',
  'DEFERRED_FINANCE', 'TOKENIZED_RIGHT', 'DONATION', 'GRANT', 'TRADE',
  'INSURANCE', 'SUBSCRIPTION',
];

export const STRATEGY_META: Record<Strategy, { label: string; color: string; icon: string; description: string }> = {
  PAYMENT:          { label: 'Payment',           color: 'emerald', icon: 'Coins',        description: 'Pay for it with currency.' },
  SCHOLARSHIP:      { label: 'Scholarship',       color: 'violet',  icon: 'Award',        description: 'Obtain via scholarship or merit-based grant.' },
  SPONSORSHIP:      { label: 'Sponsorship',       color: 'sky',     icon: 'Handshake',    description: 'Employer or third-party sponsorship.' },
  VOUCHER:          { label: 'Voucher',           color: 'amber',   icon: 'Ticket',       description: 'Government or institutional voucher.' },
  STORED_CREDITS:   { label: 'Stored Credits',    color: 'teal',    icon: 'Database',     description: 'Redeem previously-earned credits.' },
  DEFERRED_FINANCE: { label: 'Deferred Finance',  color: 'rose',    icon: 'CreditCard',   description: 'Financing, BNPL, or loan.' },
  TOKENIZED_RIGHT:  { label: 'Tokenized Right',   color: 'fuchsia', icon: 'Key',          description: 'Redeem a tokenized right.' },
  DONATION:         { label: 'Donation',          color: 'cyan',    icon: 'Heart',        description: 'Funded by donation or charity.' },
  GRANT:            { label: 'Grant',             color: 'indigo',  icon: 'FileText',     description: 'Government or institutional grant.' },
  TRADE:            { label: 'Trade',             color: 'orange',  icon: 'ArrowLeftRight',description: 'Barter or asset swap.' },
  INSURANCE:        { label: 'Insurance',         color: 'lime',    icon: 'Shield',       description: 'Insurance claim.' },
  SUBSCRIPTION:     { label: 'Subscription',      color: 'slate',   icon: 'Repeat',       description: 'Subscription entitlement.' },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRAINTS — what the proof must satisfy
// ═══════════════════════════════════════════════════════════════════════════

export interface ConstraintBundle {
  budget?: number;              // max total cost (USD)
  deadline?: number;            // max total latency (ms)
  minTrust?: number;            // minimum trust score (0–100)
  maxRisk?: number;             // max risk score (0–100)
  maxCarbon?: number;           // max carbon footprint (kgCO2e)
  jurisdiction?: string;        // regulatory jurisdiction
  region?: string;              // geographic region
  preferStrategy?: Strategy;    // preferred implementation strategy
  excludeOrganizations?: string[]; // orgs to avoid
  requireOrganizations?: string[]; // orgs that must be included
  minReputation?: number;       // minimum org reputation
  policyOverrides?: PolicyOverride[];
}

export interface PolicyOverride {
  policyId: string;
  action: 'RELAX' | 'TIGHTEN' | 'DISABLE';
  params?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ORGANIZATIONS — autonomous economic entities (actors evolved)
// ═══════════════════════════════════════════════════════════════════════════

export type OrganizationStatus = 'ACTIVE' | 'PAUSED' | 'SUSPENDED';

export interface OrganizationObjective {
  id: string;
  description: string;          // 'Maximize enrollment'
  type: 'MAXIMIZE_REVENUE' | 'MAXIMIZE_IMPACT' | 'MINIMIZE_RISK' | 'MAXIMIZE_TRUST' | 'GROWTH';
  target: number;
  current: number;
}

export interface GovernanceRule {
  id: string;
  name: string;
  description: string;
  rule: string;
  type: 'CONSENT' | 'MAJORITY' | 'AUTONOMOUS' | 'SUPERVISORY';
}

/**
 * An autonomous economic organization — a programmable micro-company.
 * Extends the Actor concept with governance, objectives, profit targets,
 * workforce, and recursive programmability (each org runs its own compiler).
 */
export interface Organization {
  id: string;
  name: string;                 // 'Education Organization' (not 'Education Actor')
  legalName: string;            // 'PaySwap Education LLC'
  version: string;
  status: OrganizationStatus;
  category: string;
  description: string;

  // ── Contracts (the only coupling to the outside world) ──
  produces: string[];           // asset ids
  consumes: string[];           // asset ids
  capabilities: string[];       // capability names
  policies: OrgPolicy[];

  // ── Business ──
  treasury: Record<string, number>;
  revenue: number;
  costs: number;
  profit: number;
  profitTarget: number;         // quarterly target (USD)
  balanceSheetAssets: number;
  balanceSheetLiabilities: number;
  reputation: number;
  trustScore: number;

  // ── Autonomous organization additions ──
  objectives: OrganizationObjective[];
  governance: GovernanceRule[];
  workforceSize: number;
  reserveRequirement: number;   // min treasury to maintain

  // ── Operational ──
  invocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  avgLatencyMs: number;
  carbonPerInvocation: number;  // kgCO2e

  registeredAt: number;
}

export interface OrgPolicy {
  id: string;
  name: string;
  description: string;
  rule: string;
  enforcement: 'BLOCK' | 'WARN' | 'REQUIRE_APPROVAL';
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC PROOFS — the planner's output. Multiple proofs may exist.
// ═══════════════════════════════════════════════════════════════════════════

export interface AssetBinding {
  assetId: string;
  amount: number;
  holderId?: string;
}

export type ProofNodeKind = 'INPUT' | 'ORGANIZATION' | 'OUTPUT' | 'OPPORTUNISTIC';

export interface ProofNode {
  id: string;
  kind: ProofNodeKind;
  organizationId?: string;
  organizationName?: string;
  capability?: string;
  produces: AssetBinding[];
  consumes: AssetBinding[];
  cost: number;
  latencyMs: number;
  trustScore: number;
  carbon: number;               // kgCO2e
  risk: number;                 // 0–100
  reasoning?: string;
  alternatives?: Array<{ organizationId: string; organizationName: string; cost: number; latencyMs: number; trustScore: number; reason: string }>;
}

export interface ProofEdge {
  from: string;
  to: string;
  assetId: string;
  amount: number;
}

export type ProofStatus = 'proposed' | 'verified' | 'executing' | 'settled' | 'failed' | 'verification_failed';

/**
 * An economic proof — a verifiable assertion that, if executed, will satisfy
 * the goal under the given constraints. The planner may produce multiple
 * proofs (different strategies). Each is scored and ranked.
 */
export interface EconomicProof {
  id: string;
  goalId: string;
  goalName: string;
  strategy: Strategy;           // the implementation strategy chosen
  strategyRationale: string;    // why this strategy
  nodes: ProofNode[];
  edges: ProofEdge[];

  // ── Aggregate scores ──
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  carbon: number;
  risk: number;
  organizationCount: number;
  opportunisticCount: number;

  // ── Planner scoring ──
  plannerScore: number;         // 0–100, weighted by constraints
  scoreBreakdown: { dimension: string; score: number; weight: number }[];

  // ── Verification ──
  status: ProofStatus;
  verification?: VerificationResult;

  // ── Memory reference ──
  memoryHits?: number;          // how many similar past executions informed this
  predictedSuccessRate?: number;

  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION — mathematical proof that invariants held
// ═══════════════════════════════════════════════════════════════════════════

export interface InvariantCheck {
  id: string;
  name: string;
  description: string;
  category: 'ASSET_CONSERVATION' | 'POLICY_COMPLIANCE' | 'TRUST_SATISFACTION' | 'SETTLEMENT_COMPLETENESS' | 'REGULATORY' | 'JURISDICTION';
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
  minorFailures: number;
  verifiedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMIC MEMORY — the platform learns from every execution
// ═══════════════════════════════════════════════════════════════════════════

export interface MemoryEntry {
  id: string;
  goalId: string;
  goalName: string;
  strategy: Strategy;
  proofId: string;
  organizationIds: string[];
  totalCost: number;
  totalLatencyMs: number;
  trustScore: number;
  carbon: number;
  outcome: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  failureReason?: string;
  customerSatisfaction?: number; // 0–100
  executedAt: number;
  durationMs: number;
}

export interface CooperationScore {
  orgA: string;
  orgB: string;
  jointExecutions: number;
  successRate: number;
  avgCost: number;
  avgLatencyMs: number;
}

export interface StrategyEffectiveness {
  strategy: Strategy;
  totalExecutions: number;
  successRate: number;
  avgCost: number;
  avgLatencyMs: number;
  avgTrust: number;
  avgSatisfaction: number;
}

export interface OrganizationReliability {
  organizationId: string;
  organizationName: string;
  totalExecutions: number;
  successRate: number;
  avgCost: number;
  avgLatencyMs: number;
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

export interface EconomicEngineOverview {
  organizationCount: number;
  activeOrganizationCount: number;
  goalCount: number;
  proofCount: number;
  settledProofCount: number;
  memoryEntries: number;
  avgSuccessRate: number;
  totalExecutions: number;
  totalRevenue: number;
  totalProfit: number;
  cooperationPairs: number;
  strategiesUsed: number;
}
