/**
 * Decision — the universal explainability record. (Principle 3: Explainability
 * by Default; Vocabulary: Decision.)
 *
 * Every decision-producing stage produces a Decision that answers the eight
 * questions: Why? Why not? Alternative? Evidence? Confidence? Policy? Cost?
 * Risk? The Protocol Inspector renders these uniformly on any trace node.
 */

import type { EvidenceCitation } from '../types';

export type DecisionKind =
  | 'lp_select'
  | 'route'
  | 'treasury_alloc'
  | 'reserve_move'
  | 'compliance'
  | 'fraud'
  | 'settlement_plan'
  | 'fx'
  | 'retry'
  | 'policy'
  | 'risk'
  | 'other';

export interface DecisionAlternative {
  option: string;
  score: number;        // 0..1
  rejectedBecause: string;
}

export interface DecisionTradeoff {
  dimension: string;    // e.g. 'cost' | 'speed' | 'risk' | 'liquidity'
  delta: number;        // signed change vs the baseline
}

export interface DecisionConstraint {
  name: string;
  value: string;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  /** Pipeline stage that produced this decision. */
  stage: string;
  /** What was decided about (e.g. intent id, aggregate id). */
  subject: string;
  /** What was chosen. */
  choice: string;
  /** 0..1 score of the chosen option. */
  score: number;
  /** 0..1 confidence in the choice. */
  confidence: number;
  /** The rejected options and why. */
  alternatives: DecisionAlternative[];
  /** How this choice trades off against alternatives. */
  tradeoffs: DecisionTradeoff[];
  /** Constraints that bound the decision. */
  constraints: DecisionConstraint[];
  /** Evidence cited for this decision. */
  evidence: EvidenceCitation[];
  /** Human-readable reasoning. */
  reasoning: string;
  /** Cost in basis points (if applicable). */
  costBps?: number;
  /** Risk score 0..1 (if applicable). */
  riskScore?: number;
  /** Which policy rule(s) allowed/constrained this (if applicable). */
  policyRuleIds?: string[];
  /** Runtime Clock time. */
  ts: number;
}

/** Factory: build a Decision. */
export function decision(params: {
  kind: DecisionKind;
  stage: string;
  subject: string;
  choice: string;
  score?: number;
  confidence?: number;
  alternatives?: DecisionAlternative[];
  tradeoffs?: DecisionTradeoff[];
  constraints?: DecisionConstraint[];
  evidence?: EvidenceCitation[];
  reasoning?: string;
  costBps?: number;
  riskScore?: number;
  policyRuleIds?: string[];
  ts: number;
}): Decision {
  return {
    id: `dec_${Math.random().toString(36).slice(2, 10)}`,
    kind: params.kind,
    stage: params.stage,
    subject: params.subject,
    choice: params.choice,
    score: params.score ?? 1,
    confidence: params.confidence ?? 1,
    alternatives: params.alternatives ?? [],
    tradeoffs: params.tradeoffs ?? [],
    constraints: params.constraints ?? [],
    evidence: params.evidence ?? [],
    reasoning: params.reasoning ?? '',
    costBps: params.costBps,
    riskScore: params.riskScore,
    policyRuleIds: params.policyRuleIds,
    ts: params.ts,
  };
}
