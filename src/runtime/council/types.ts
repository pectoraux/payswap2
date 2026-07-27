/**
 * Economic Council & Decision Protocol — Types. (M-ECO-37.)
 *
 * The Economic Council coordinates all directors. Instead of each director
 * producing independent recommendations, proposals go through a council
 * debate where directors express opinions (support/neutral/oppose),
 * counter-propose modifications, and reach weighted consensus.
 *
 *   Proposal → Evidence → Director Reviews → Challenges → Counter-Proposals
 *   → Consensus → Constitutional Review → Governance → Execution Request
 *
 * No execution happens in the Council. It produces coordinated decisions
 * that still go through the Transaction Coordinator.
 */

import type { DirectorType, StrategicAction, TimeHorizon, AffectedEntities } from '../directorate/types';

// ─── Council Proposal ──────────────────────────────────────────────────────

export interface CouncilProposal {
  proposalId: string;
  proposedBy: DirectorType;
  action: StrategicAction;
  description: string;
  targetCountries: string[];
  targetCorridors: Array<{ from: string; to: string }>;
  amount?: number;
  currency?: string;
  timeHorizon: TimeHorizon;
  evidence: ProposalEvidence[];
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  createdAt: number;
}

export interface ProposalEvidence {
  source: string;
  metric: string;
  value: string;
  interpretation: string;
}

// ─── Director Opinions ─────────────────────────────────────────────────────

export type OpinionPosition = 'support' | 'neutral' | 'oppose';

export interface DirectorOpinion {
  director: DirectorType;
  position: OpinionPosition;
  confidence: number;           // [0, 1]
  reason: string;
  expectedROI: number;
  expectedRisk: number;
  alternatives: string[];
  counterProposal?: CounterProposal;
  submittedAt: number;
}

export interface CounterProposal {
  counterProposalId: string;
  proposedBy: DirectorType;
  modifiedAction: StrategicAction;
  modifiedAmount?: number;
  modifications: string[];
  reason: string;
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
}

// ─── Consensus ─────────────────────────────────────────────────────────────

export type ConsensusOutcome = 'accepted' | 'accepted_with_modifications' | 'rejected' | 'requires_governance';

export interface ConsensusResult {
  outcome: ConsensusOutcome;
  weightedScore: number;          // weighted consensus score [-1, 1]
  supportWeight: number;
  opposeWeight: number;
  neutralWeight: number;
  acceptedCounterProposal?: CounterProposal;
  rationale: string;
  directorWeights: Record<string, number>;  // director → weight used
}

// ─── Council Decision ──────────────────────────────────────────────────────

export type DecisionStatus =
  | 'pending' | 'in_debate' | 'consensus_reached' | 'constitutional_review'
  | 'approved' | 'requires_governance' | 'rejected' | 'executed';

export interface CouncilDecision {
  decisionId: string;
  proposal: CouncilProposal;
  opinions: DirectorOpinion[];
  consensus: ConsensusResult;
  constitutionalReview: {
    passed: boolean;
    violations: string[];
  };
  status: DecisionStatus;
  approvalClass: 'automatic' | 'operator' | 'treasury' | 'governance' | 'constitution_forbidden';
  debateRecord: DebateRecord;
  decidedAt: number;
}

export interface DebateRecord {
  proposalId: string;
  rounds: DebateRound[];
  totalDurationMs: number;
  finalOutcome: ConsensusOutcome;
}

export interface DebateRound {
  round: number;
  opinions: DirectorOpinion[];
  counterProposals: CounterProposal[];
  summary: string;
}

// ─── Council Memory ────────────────────────────────────────────────────────

export interface CouncilMemoryEntry {
  memoryId: string;
  decisionId: string;
  proposal: { action: StrategicAction; description: string; countries: string[] };
  opinions: Array<{ director: DirectorType; position: OpinionPosition; confidence: number }>;
  consensus: ConsensusOutcome;
  outcome: 'success' | 'partial' | 'failure' | 'pending';
  actualROI?: number;
  actualRisk?: number;
  lessonsLearned: string[];
  directorAccuracy: Record<string, boolean>;  // director → was their opinion correct?
  timestamp: number;
}

// ─── Historical Accuracy Tracker ───────────────────────────────────────────

export interface DirectorAccuracyRecord {
  director: DirectorType;
  totalDecisions: number;
  correctDecisions: number;
  accuracyRate: number;          // [0, 1]
  weight: number;                // current consensus weight [0, 1]
  recentTrend: 'improving' | 'stable' | 'declining';
}

// ─── Council Report ────────────────────────────────────────────────────────

export interface CouncilReport {
  activeProposals: number;
  pendingDecisions: CouncilDecision[];
  recentDecisions: CouncilDecision[];
  directorAccuracy: DirectorAccuracyRecord[];
  memory: CouncilMemoryEntry[];
  totalProposals: number;
  acceptanceRate: number;
  generatedAt: number;
}
