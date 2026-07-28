/**
 * Global Audit & Transparency Layer — Types. (M-TRUST-1 through M-TRUST-10.)
 *
 * This is a new family of milestones focused on making PaySwap provably
 * trustworthy. The Economic Kernel is complete — now the rest of the world
 * must be able to verify that the brain works correctly.
 *
 * 10 capabilities:
 *   1. Global Audit (every economic action explainable)
 *   2. External Proof Engine (publish proofs to blockchain + IPFS)
 *   3. Cryptographic Proofs (Merkle Tree → root hash → blockchain)
 *   4. Network Risk Observatory (AWS Health Dashboard for finance)
 *   5. Public Economic API (anyone can query network state)
 *   6. Explainable AI (central bank minutes for every decision)
 *   7. Continuous Stress Testing (nightly: bank collapse, depeg, etc.)
 *   8. Regulatory Operating Mode (EU/UK/GH/NG/US/SG compliance switch)
 *   9. Formal Verification (machine-checkable invariants)
 *  10. Economic Replay Explorer (pick any day → replay entire economy)
 */

import type { CouncilDecision } from '../council/types';

// ─── 1. Global Audit ───────────────────────────────────────────────────────

export interface AuditEntry {
  auditId: string;
  timestamp: number;
  action: string;
  actor: string;
  reason: string;
  simulationResult?: string;
  councilDebate?: {
    support: number; oppose: number; neutral: number;
    outcome: string; rationale: string;
  };
  constitutionalReview?: { passed: boolean; violations: string[] };
  governanceApproval?: string;
  ledgerImpact?: { assetsChanged: boolean; balanced: boolean };
  proofAvailable: boolean;
  eventHash?: string;
}

export interface AuditReport {
  totalActions: number;
  entries: AuditEntry[];
  constitutionalViolations: number;
  governanceApprovals: number;
  automaticActions: number;
  generatedAt: number;
}

// ─── 2. External Proof Engine ──────────────────────────────────────────────

export interface PublishedProof {
  proofId: string;
  type: 'reserve' | 'twin_token' | 'solvency' | 'balance_sheet';
  hash: string;
  payload: Record<string, unknown>;
  publishedTo: PublicationTarget[];
  generatedAt: number;
}

export interface PublicationTarget {
  network: 'stellar' | 'ethereum' | 'ipfs' | 'internal';
  txHash?: string;
  url?: string;
  publishedAt: number;
}

// ─── 3. Cryptographic Proofs ──────────────────────────────────────────────

export interface MerkleProof {
  rootHash: string;
  leafHash: string;
  path: string[];
  eventCount: number;
  generatedAt: number;
}

// ─── 4. Network Risk Observatory ──────────────────────────────────────────

export interface NetworkHealthDashboard {
  globalHealthScore: number;       // [0, 100]
  reserveCoverage: number;         // percentage
  settlementSuccessRate: number;   // percentage
  liquidityEfficiency: number;     // percentage
  twinTokenBacking: number;        // percentage
  solvencyRatio: number;
  countries: {
    healthy: number;
    watch: number;
    critical: number;
    total: number;
  };
  activeLPs: number;
  activeCorridors: number;
  pendingSettlements: number;
  generatedAt: number;
}

// ─── 5. Public Economic API ────────────────────────────────────────────────

export interface PublicEconomicState {
  // Current state.
  totalReserves: number;
  fiatReserves: number;
  stablecoinReserves: number;
  twinTokenSupply: number;
  twinTokenBackingRatio: number;
  totalBandwidth: number;
  activeLPs: number;
  activeCorridors: number;
  settlementLatencyMs: number;
  solvencyRatio: number;
  // Historical (simplified — would use time-series in production).
  reserveGrowth30d: number;
  liquidityGrowth30d: number;
  twinTokenGrowth30d: number;
  generatedAt: number;
}

// ─── 6. Explainable AI ────────────────────────────────────────────────────

export interface ExplainableDecision {
  decisionId: string;
  proposal: { action: string; description: string; countries: string[] };
  decisionTree: DecisionTreeNode;
  evidence: EvidenceItem[];
  simulationSummary: string;
  alternatives: AlternativeOption[];
  rejectedAlternatives: RejectedAlternative[];
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  finalOutcome: string;
  governancePath: string;
  generatedAt: number;
}

export interface DecisionTreeNode {
  step: string;
  question: string;
  answer: string;
  children: DecisionTreeNode[];
}

export interface EvidenceItem {
  source: string;
  metric: string;
  value: string;
  weight: number;
}

export interface AlternativeOption {
  description: string;
  roi: number;
  risk: number;
  whyRejected: string;
}

export interface RejectedAlternative {
  description: string;
  reason: string;
}

// ─── 7. Continuous Stress Testing ──────────────────────────────────────────

export interface StressTestResult {
  testId: string;
  scenario: string;
  networkSurvives: boolean;
  margin: number;               // percentage (how close to failure)
  recoveryTimeMs: number;
  recommendations: string[];
  testedAt: number;
}

export interface NightlyStressReport {
  date: number;
  tests: StressTestResult[];
  networkSurvivesAll: boolean;
  worstCaseMargin: number;
  recommendations: string[];
}

// ─── 8. Regulatory Operating Mode ──────────────────────────────────────────

export type RegulatoryJurisdiction = 'EU' | 'UK' | 'GH' | 'NG' | 'US' | 'SG' | 'DEFAULT';

export interface RegulatoryConfig {
  jurisdiction: RegulatoryJurisdiction;
  minReserveRatio: number;
  maxLPExposurePercent: number;
  maxCountryConcentration: number;
  kycRequired: boolean;
  kycThreshold: number;
  reportingFormat: 'IFRS' | 'US_GAAP' | 'LOCAL';
  proofFrequency: 'realtime' | 'hourly' | 'daily';
  governanceRequired: boolean;
  capitalAdequacyRatio: number;
}

// ─── 9. Formal Verification ────────────────────────────────────────────────

export interface FormalInvariant {
  invariantId: string;
  name: string;
  description: string;
  /** Machine-checkable: returns { holds, proof }. */
  check: () => { holds: boolean; proof: string };
  lastChecked: number;
  lastResult: boolean;
}

export interface FormalVerificationReport {
  invariants: Array<{
    invariantId: string;
    name: string;
    holds: boolean;
    proof: string;
    lastChecked: number;
  }>;
  allHold: boolean;
  generatedAt: number;
}

// ─── 10. Economic Replay Explorer ──────────────────────────────────────────

export interface ReplaySnapshot {
  timestamp: number;
  eventCount: number;
  balanceSheet: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    isBalanced: boolean;
  };
  reserves: number;
  twinTokens: number;
  bandwidth: number;
  activeLPs: number;
  description: string;
}

export interface ReplayExplorer {
  snapshots: ReplaySnapshot[];
  totalEventsReplayed: number;
  startTime: number;
  endTime: number;
  generatedAt: number;
}
