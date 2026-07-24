/**
 * PaySwap Kernel — Canonical Type System (Global Liquidity OS)
 * -----------------------------------------------------------------------------
 * The kernel does NOT process payments. It manages GLOBAL LIQUIDITY.
 * A payment is merely one possible liquidity movement.
 *
 * Every operation is represented as a desired liquidity state transition.
 * The kernel answers one question:
 *   "How can liquidity move from A to B with lowest cost, highest safety,
 *    and highest reliability?"
 *
 * Canonical Financial Objects (Kubernetes Pods / AWS EC2 equivalents):
 *   Country, Currency, Corridor, Reserve, LiquidityProvider, FinancialOperator,
 *   Treasury, TwinToken, Wallet, Merchant, Customer, Ledger, Event, Workflow,
 *   Route, Policy, AIRecommendation, LiquidityExecutionPlan, SettlementPlan.
 *
 * Single source of truth for kernel engines, API routes, and the Digital Twin UI.
 */

/* ========================================================================== */
/* Geographic & monetary primitives                                           */
/* ========================================================================== */

export type CurrencyCode = 'KES' | 'GHS' | 'NGN' | 'USD' | 'ZAR' | 'UGX' | 'TZS';

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
  countries: string[];
}

export interface Country {
  name: string;
  currency: CurrencyCode;
  flag: string;
  region: string;
}

export interface Corridor {
  id: string;
  fromCountry: string;
  toCountry: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  authorized: boolean;
  avgLatencyMs: number;
  avgCostBps: number;
}

/* ========================================================================== */
/* Financial Operators (FOs) — infrastructure resources                       */
/* ========================================================================== */

export type FinancialOperatorType =
  | 'mobile_money'
  | 'visa'
  | 'mastercard'
  | 'bank_account'
  | 'ach'
  | 'sepa'
  | 'instant_transfer'
  | 'card_processor'
  | 'psp_wallet';

export interface FinancialOperator {
  id: string;
  type: FinancialOperatorType;
  name: string;
  country: string;
  supportedCurrencies: CurrencyCode[];
  latencyMs: number;
  feeBps: number; // fee in basis points
  feeFixed: number;
  uptime: number; // 0..1
  failureRate: number; // 0..1
  maxAmount: number;
  minAmount: number;
  supportedRoutes: ('domestic' | 'cross_border')[];
  online: boolean;
  manualOnly: boolean; // cannot auto-debit LPs
}

/* ========================================================================== */
/* Reserves — infrastructure resources                                        */
/* ========================================================================== */

export interface Reserve {
  id: string;
  country: string;
  currency: CurrencyCode;
  available: number;
  locked: number;
  minThreshold: number;
  forecast: number; // projected replenishment
  replenishmentSchedule: string; // e.g. "daily", "weekly"
  aiConfidence: number; // 0..1
}

/* ========================================================================== */
/* Liquidity Sources — 8 canonical types                                      */
/* ========================================================================== */

export type LiquiditySourceKind =
  | 'reserve'
  | 'community_lp'
  | 'merchant_lp'
  | 'stablecoin_treasury'
  | 'bank_credit_line'
  | 'cooperative_pool'
  | 'diaspora_pool'
  | 'emergency_treasury';

export interface LiquiditySourceAttributes {
  capacity: number;
  latencyMs: number;
  feeBps: number;
  riskScore: number; // 0..1
  coverage: string; // corridor coverage description
  failureProbability: number; // 0..1
  trustScore: number; // 0..1
  availability: number; // 0..1
}

export interface LiquidityProvider {
  id: string;
  name: string;
  country: string;
  currency: CurrencyCode;
  sourceKind: LiquiditySourceKind;
  twinTokenPosition: number;
  fiatPosition: number;
  financialOperators: string[]; // FO ids
  tradingFees: number; // percent
  tradingCapacity: number;
  riskProfile: number; // 0..1
  settlementSpeedMs: number;
  insuranceCoverage: number;
  availability: number; // 0..1
  historicalPerformance: number; // 0..1 success rate
  aiReputation: number; // 0..1
  manualOnly: boolean;
  online: boolean;
}

/* ========================================================================== */
/* Treasury                                                                   */
/* ========================================================================== */

export interface TreasuryPosition {
  currency: CurrencyCode;
  stablecoinBalance: number;
  emergencyBalance: number;
  fiatBalance: number;
}

export interface Treasury {
  positions: TreasuryPosition[];
}

/* ========================================================================== */
/* Twin Token — canonical liquidity receipts                                  */
/* ========================================================================== */

export type TwinTokenStatus = 'minted' | 'transferred' | 'burned';

export interface TwinTokenRecord {
  id: string;
  symbol: string;
  amount: number;
  currency: CurrencyCode;
  fromCountry: string;
  toCountry: string;
  status: TwinTokenStatus;
  mintedAtFrame: number;
  burnedAtFrame: number | null;
  memo: string;
}

/* ========================================================================== */
/* Actors                                                                     */
/* ========================================================================== */

export interface Wallet {
  id: string;
  ownerLabel: string;
  country: string;
  currency: CurrencyCode;
  balance: number;
  financialOperatorId: string;
}

export interface Merchant {
  id: string;
  name: string;
  country: string;
  currency: CurrencyCode;
  walletId: string;
  preference: RoutingPriority;
}

export interface Customer {
  id: string;
  name: string;
  country: string;
  currency: CurrencyCode;
  walletId: string;
}

/* ========================================================================== */
/* Ledger (double-entry, multi-currency)                                      */
/* ========================================================================== */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface LedgerAccount {
  id: string;
  label: string;
  currency: CurrencyCode;
  type: AccountType;
  balance: number;
}

export interface LedgerEntry {
  id: string;
  txId: string;
  accountId: string;
  accountLabel: string;
  accountType: AccountType;
  currency: CurrencyCode;
  debit: number;
  credit: number;
  balanceAfter: number;
  memo: string;
  frame: number;
  ts: number;
}

/* ========================================================================== */
/* Events                                                                     */
/* ========================================================================== */

export interface SimulationEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  frame: number;
}

/* ========================================================================== */
/* AI — optimization weights + explainable recommendations                    */
/* ========================================================================== */

export type RoutingPriority =
  | 'cheapest'
  | 'fastest'
  | 'safest'
  | 'balanced'
  | 'impact';

export interface OptimizationWeights {
  cost: number;
  speed: number;
  safety: number;
  liquidityPreservation: number;
  merchantSatisfaction: number;
  communityImpact: number;
  carbonImpact: number;
  treasuryHealth: number;
}

/** A single objective score with explanation. Never opaque. */
export interface ObjectiveScore {
  objective: keyof OptimizationWeights;
  score: number; // 0..1 (higher is better)
  raw: number; // underlying metric (e.g. cost percent, seconds)
  rationale: string;
}

export interface AIRecommendation {
  strategy: string;
  objectiveScores: ObjectiveScore[];
  weightedScore: number; // 0..1
  narrative: string; // LLM-enhanced (falls back to deterministic)
  llmPowered: boolean;
  decisions: AIDecision[];
}

export interface AIDecision {
  step: string;
  rationale: string;
}

/* ========================================================================== */
/* The Liquidity Execution Plan — the canonical object                        */
/* ========================================================================== */

export type PlanStepType =
  | 'debit_source'
  | 'credit_reserve'
  | 'draw_reserve'
  | 'draw_lp'
  | 'draw_treasury'
  | 'fx_convert'
  | 'mint_twin'
  | 'burn_twin'
  | 'credit_destination'
  | 'accrue_fee'
  | 'notify_lp'
  | 'await_confirmation'
  | 'insurance_claim';

export interface SourceRef {
  kind: LiquiditySourceKind | 'wallet' | 'fo';
  id: string;
}

export interface PlanStep {
  id: string;
  type: PlanStepType;
  title: string;
  description: string;
  amount?: number;
  currency?: CurrencyCode;
  sourceRef?: SourceRef;
  targetRef?: SourceRef;
  frame: number; // maps to replay frame
  reversible: boolean;
  meta?: Record<string, string | number | boolean>;
}

export interface LiquiditySourceDraw {
  sourceKind: LiquiditySourceKind;
  sourceId: string;
  sourceLabel: string;
  country: string;
  currency: CurrencyCode;
  drawn: number;
  fee: number;
  rate: number;
  exhausted: boolean;
  remaining: number;
  manual: boolean;
}

export interface PlanMetrics {
  settlementTimeMs: number;
  settlementTimeLabel: string;
  costPercent: number;
  costAmount: number;
  riskScore: number;
  riskLabel: 'Low' | 'Moderate' | 'Elevated' | 'High';
  confidence: number;
  fxRate: number;
  fxSpreadBps: number;
  totalFees: number;
  reserveUtilization: number;
  liquidityUtilization: number;
  insuranceExposure: number;
  twinTokensMinted: number;
}

export interface PolicyFinding {
  policy: string;
  severity: 'info' | 'warn' | 'block';
  detail: string;
}

export interface PolicyVerdict {
  passed: boolean;
  findings: PolicyFinding[];
}

export interface AlternativePlan {
  label: string;
  reason: string; // why it was rejected
  weightedScore: number;
  costPercent: number;
  settlementTimeMs: number;
  riskScore: number;
  lpCount: number;
  usesReserve: boolean;
  usesTreasury: boolean;
  steps: { title: string; type: PlanStepType }[];
}

export interface LiquidityExecutionPlan {
  id: string;
  requestId: string;
  steps: PlanStep[];
  sourceDraws: LiquiditySourceDraw[];
  twinTokenSymbol: string;
  metrics: PlanMetrics;
  reasoning: AIRecommendation;
  policy: PolicyVerdict;
  alternatives: AlternativePlan[];
  status: 'draft' | 'validated' | 'approved' | 'executing' | 'settled' | 'failed' | 'rolled_back';
  createdAt: number;
  feasible: boolean;
  notes: string[];
}

/* ========================================================================== */
/* Failure injection (Digital Twin)                                           */
/* ========================================================================== */

export type FailureType =
  | 'lp_disappear'
  | 'reserve_exhaustion'
  | 'psp_timeout'
  | 'fx_spike'
  | 'network_partition'
  | 'treasury_depletion'
  | 'fraud_alert'
  | 'compliance_block'
  | 'manual_settlement_required'
  | 'insurance_claim';

export interface FailureInjection {
  id: string;
  type: FailureType;
  label: string;
  targetId?: string; // lpId / foId / country
  atFrame: number;
  params?: Record<string, number | string>;
}

/* ========================================================================== */
/* Plan amendments (triggered by failures during execution)                   */
/* ========================================================================== */

export interface PlanAmendment {
  id: string;
  triggeredBy: FailureInjection;
  reason: string;
  steps: PlanStep[];
  insertedAtFrame: number;
  recoveryStrategy: string;
}

/* ========================================================================== */
/* Workflow (manual settlement, insurance claims)                             */
/* ========================================================================== */

export type WorkflowType = 'manual_settlement' | 'insurance_claim' | 'standard';

export interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
  output?: string;
  frame?: number;
}

export interface Workflow {
  id: string;
  type: WorkflowType;
  name: string;
  steps: WorkflowStep[];
  startedAt: number;
  finishedAt: number | null;
  triggeredBy?: string; // failure id
}

/* ========================================================================== */
/* Insurance                                                                  */
/* ========================================================================== */

export type InsuranceClaimStatus =
  | 'filed'
  | 'evidence_required'
  | 'community_review'
  | 'payswap_vote'
  | 'approved'
  | 'denied'
  | 'appealed';

export interface InsuranceClaim {
  id: string;
  amount: number;
  currency: CurrencyCode;
  reason: string;
  status: InsuranceClaimStatus;
  evidence: string[];
  communityVotes: number;
  payswapVote: 'pending' | 'approve' | 'deny';
  coverage: number;
  filedAtFrame: number;
  resolvedAtFrame: number | null;
}

/* ========================================================================== */
/* Treasury AI recommendations                                                */
/* ========================================================================== */

export interface TreasuryRecommendation {
  id: string;
  action: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  estimatedImpact: string;
}

/* ========================================================================== */
/* Replay frames (Time Machine)                                               */
/* ========================================================================== */

export type ReplayFrameType =
  | 'debit'
  | 'credit'
  | 'mint'
  | 'burn'
  | 'ledger'
  | 'events'
  | 'ai'
  | 'amendment'
  | 'workflow'
  | 'insurance'
  | 'treasury'
  | 'settlement';

export interface ReplayFrame {
  index: number;
  key: string;
  title: string;
  description: string;
  type: ReplayFrameType;
  ledgerEntries?: LedgerEntry[];
  twinToken?: TwinTokenRecord;
  events?: SimulationEvent[];
  decisions?: AIDecision[];
  amendment?: PlanAmendment;
  workflow?: Workflow;
  insurance?: InsuranceClaim;
  treasury?: TreasuryRecommendation[];
  summary?: string;
  isRecovery?: boolean;
}

/* ========================================================================== */
/* Audit                                                                      */
/* ========================================================================== */

export interface AuditEntry {
  ts: number;
  action: string;
  detail: string;
  actor: string;
}

export interface AuditTrace {
  runId: string;
  actor: string;
  entries: AuditEntry[];
}

/* ========================================================================== */
/* Engine health                                                              */
/* ========================================================================== */

export type EngineStatus = 'online' | 'degraded' | 'offline';

export interface EngineHealth {
  id: string;
  name: string;
  category: string;
  status: EngineStatus;
  version: string;
  description: string;
}

/* ========================================================================== */
/* World state (the Digital Twin's mutable network snapshot)                  */
/* ========================================================================== */

export interface WorldState {
  accounts: Map<string, LedgerAccount>;
  reserves: Reserve[];
  liquidityProviders: LiquidityProvider[];
  financialOperators: FinancialOperator[];
  treasury: Treasury;
  twinTokens: TwinTokenRecord[];
  wallets: Wallet[];
}

export interface WorldStateResult {
  reserves: ReserveStateResult[];
  liquidityProviders: LpStateResult[];
  financialOperators: FoStateResult[];
  treasury: Treasury;
}

export interface ReserveStateResult {
  id: string;
  country: string;
  currency: CurrencyCode;
  availableBefore: number;
  availableAfter: number;
  locked: number;
  minThreshold: number;
  delta: number;
  healthy: boolean;
}

export interface LpStateResult {
  id: string;
  name: string;
  country: string;
  currency: CurrencyCode;
  sourceKind: LiquiditySourceKind;
  capacity: number;
  used: number;
  remaining: number;
  twinTokenPosition: number;
  fiatPosition: number;
  rate: number;
  online: boolean;
  manualOnly: boolean;
}

export interface FoStateResult {
  id: string;
  name: string;
  type: FinancialOperatorType;
  country: string;
  online: boolean;
  latencyMs: number;
  uptime: number;
  used: boolean;
}

/* ========================================================================== */
/* Scenario (Digital Twin input)                                              */
/* ========================================================================== */

export type ReservePolicy =
  | 'reserve_first'
  | 'lp_first'
  | 'hybrid'
  | 'preserve_reserves';

export interface SimulationScenario {
  id?: string;
  name: string;
  description?: string;
  transaction: {
    type: 'domestic' | 'cross_border';
    buyer: { country: string; currency: CurrencyCode; method: string; foId?: string };
    merchant: { country: string; currency: CurrencyCode; method: string; foId?: string };
    amount: number;
    currency: CurrencyCode;
    merchantType: string;
    customerType: string;
    priority: RoutingPriority;
  };
  treasury: {
    originReserve: { country: string; currency: CurrencyCode; available: number; minThreshold: number };
    destinationReserve: { country: string; currency: CurrencyCode; available: number; minThreshold: number };
    stablecoinBalance: number;
    emergencyTreasury: number;
    reservePolicy: ReservePolicy;
  };
  liquidityProviders: LiquidityProvider[];
  financialOperators: FinancialOperator[];
  policies: {
    reservePolicy: ReservePolicy;
    maxLpShare: number;
    maxCostPercent: number;
    maxRiskScore: number;
    requireInsurance: boolean;
  };
  failures: FailureInjection[];
  aiWeights: OptimizationWeights;
}

/* ========================================================================== */
/* Simulation Result — the full Digital Twin output                           */
/* ========================================================================== */

export interface SimulationResult {
  runId: string;
  createdAt: number;
  kernelVersion: string;
  scenario: SimulationScenario;
  plan: LiquidityExecutionPlan;
  amendments: PlanAmendment[];
  workflows: Workflow[];
  insuranceClaims: InsuranceClaim[];
  treasuryRecommendations: TreasuryRecommendation[];
  replay: ReplayFrame[];
  ledger: LedgerEntry[];
  events: SimulationEvent[];
  twinTokens: TwinTokenRecord[];
  worldState: WorldStateResult;
  audit: AuditTrace;
  engines: EngineHealth[];
  resultHash: string; // for regression comparison
  settled: boolean;
  constitution: ConstitutionVerdict;
  graph: GraphSnapshot;
  worldInspector: WorldInspector;
  lpLifecycleEvents: LPLifecycleEvent[];
  candidatePlans: CandidatePlanSummary[];
  stateTransitions: StateTransitionSummary[];
  worldHistory: WorldSnapshotSummary[];
  reasoningResults: ReasoningResultSummary[];
  intentType: string;
  executionGraph: ExecutionGraphSummary;
  entities: EntitySummary[];
  organizationPolicy: OrganizationPolicy;
  runtimeServices: RuntimeServiceSummary[];
}

export interface RuntimeServiceSummary {
  name: string;
  owns: string;
  status: 'online' | 'degraded' | 'offline';
  engineCount: number;
}

/* ========================================================================== */
/* Optimization Engine — candidate plans                                      */
/* ========================================================================== */

export interface CandidatePlanSummary {
  id: string;
  label: string;
  strategy: string;
  weightedScore: number;
  costPercent: number;
  settlementTimeMs: number;
  riskScore: number;
  lpCount: number;
  usesReserve: boolean;
  usesTreasury: boolean;
  feasible: boolean;
  selected: boolean;
  rejectionReason?: string;
  objectiveScores: ObjectiveScore[];
}

/* ========================================================================== */
/* State Machine — transitions                                                */
/* ========================================================================== */

export interface StateTransitionSummary {
  id: string;
  objectId: string;
  objectKind: string;
  from: string;
  to: string;
  reason: string;
  ts: number;
  frame?: number;
}

/* ========================================================================== */
/* World Store — snapshots                                                    */
/* ========================================================================== */

export interface WorldSnapshotSummary {
  version: number;
  label: string;
  ts: number;
  totalReserves: number;
  totalLpCapacity: number;
  totalTwinSupply: number;
  totalTreasury: number;
  ledgerBalanced: boolean;
  events: number;
}

/* ========================================================================== */
/* Financial Reasoning Engine                                                  */
/* ========================================================================== */

export interface ReasoningRecommendationSummary {
  action: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  category: string;
}

export interface ReasoningResultSummary {
  category: string;
  summary: string;
  recommendations: ReasoningRecommendationSummary[];
  confidence: number;
  evidence: string[];
}

/* ========================================================================== */
/* Scenario Library                                                            */
/* ========================================================================== */

export interface SavedScenario {
  id: string;
  name: string;
  description: string;
  category: string;
  scenario: SimulationScenario;
  baselineHash: string;
  baselineMetrics: {
    costPercent: number;
    settlementTimeMs: number;
    riskScore: number;
    confidence: number;
  };
  createdAt: number;
  lastRunAt: number | null;
  lastRunPassed: boolean | null;
}

export interface RegressionResult {
  scenarioId: string;
  name: string;
  passed: boolean;
  baseline: SavedScenario['baselineMetrics'];
  current: SavedScenario['baselineMetrics'];
  drift: { costPercent: number; settlementTimeMs: number; riskScore: number };
}

/* ========================================================================== */
/* Kernel Constitution (non-overridable invariants)                          */
/* ========================================================================== */

export interface ConstitutionCheck {
  section: string;
  invariant: string;
  passed: boolean;
  detail: string;
  severity: 'block' | 'warn';
}

export interface ConstitutionVerdict {
  passed: boolean;
  sections: { section: string; passed: boolean; checks: ConstitutionCheck[] }[];
  violations: { section: string; invariant: string; detail: string; severity: 'block' | 'warn' }[];
  checks: { invariant: string; passed: boolean; detail: string; section: string }[];
  totalRules: number;
  passedRules: number;
}

/* ========================================================================== */
/* Financial Graph snapshot (for the UI)                                      */
/* ========================================================================== */

export interface GraphSnapshot {
  nodes: { id: string; type: string; label: string; country?: string; currency?: CurrencyCode; balance: number; online: boolean }[];
  edges: { id: string; from: string; to: string; kind: string; cost: number; liquidity: number; reliability: number }[];
}

/* ========================================================================== */
/* World Inspector — per-frame deltas                                         */
/* ========================================================================== */

export interface FrameDelta {
  frame: number;
  ledger: { account: string; debit: number; credit: number; balanceAfter: number }[];
  reserves: { country: string; availableAfter: number; delta: number }[];
  liquidityProviders: { lpId: string; remainingAfter: number; delta: number }[];
  treasury: { currency: CurrencyCode; fiatAfter: number; stablecoinAfter: number }[];
  twinTokens: { symbol: string; status: string }[];
  events: { type: string; frame: number }[];
}

export interface WorldInspector {
  deltas: FrameDelta[];
  before: { reserves: { country: string; available: number }[]; liquidityProviders: { lpId: string; remaining: number }[] };
  after: { reserves: { country: string; available: number }[]; liquidityProviders: { lpId: string; remaining: number }[] };
}

/* ========================================================================== */
/* Liquidity Intent (extension API)                                           */
/* ========================================================================== */

export interface LiquidityIntent {
  amount: number;
  currency: CurrencyCode;
  origin: { country: string; currency: CurrencyCode; method: string };
  destination: { country: string; currency: CurrencyCode; method: string };
  objective: RoutingPriority;
  policy?: Partial<SimulationScenario['policies']>;
  aiWeights?: Partial<OptimizationWeights>;
  failures?: FailureInjection[];
}

/* ========================================================================== */
/* LP Lifecycle                                                               */
/* ========================================================================== */

export type LPLifecycleState = 'active' | 'manual' | 'inactive' | 'suspended';

export interface LPStake {
  lpId: string;
  twinTokenAmount: number;
  stakedAt: number;
  slashingHistory: { amount: number; reason: string; ts: number }[];
}

export interface LPLifecycleEvent {
  id: string;
  lpId: string;
  action: 'mint' | 'stake' | 'trade' | 'withdraw' | 'restake' | 'suspend' | 'reactivate' | 'slash';
  amount?: number;
  ts: number;
  detail: string;
}

/* ========================================================================== */
/* PaySwap Runtime — Entity, Command, Execution Graph                         */
/* ========================================================================== */

export interface ExecutionGraphSummary {
  id: string;
  commandId: string;
  totalNodes: number;
  parallelGroups: number;
  criticalPathLength: number;
  status: string;
  nodes: { id: string; type: string; title: string; status: string; parallelGroup: number; dependencies: string[]; reversible: boolean; checkpoint: boolean; amount?: number; currency?: string; frame?: number }[];
  edges: { from: string; to: string; kind: string }[];
}

export interface EntitySummary {
  id: string;
  type: string;
  state: string;
  label: string;
  country?: string;
  currency?: CurrencyCode;
  balance: number;
  capabilities: string[];
  policies: Record<string, unknown>;
}

/* ========================================================================== */
/* Organization Policy (configurable, vs immutable Constitution)              */
/* ========================================================================== */

export interface OrganizationPolicy {
  reserveThreshold: number;
  treasuryStrategy: 'conservative' | 'balanced' | 'aggressive';
  lpPreference: 'community' | 'institutional' | 'mixed';
  carbonObjective: number; // 0..1 weight
  communityWeight: number; // 0..1 weight
  riskAppetite: 'low' | 'medium' | 'high';
  maxLpShare: number;
  maxCostPercent: number;
  maxRiskScore: number;
  requireInsurance: boolean;
  reservePolicy: ReservePolicy;
}


