/**
 * Economic Council — coordinates all directors through debate + consensus.
 * (M-ECO-37.)
 *
 *   Proposal → Evidence → Director Reviews → Challenges → Counter-Proposals
 *   → Consensus → Constitutional Review → Governance → Execution Request
 *
 * The Council doesn't replace anything. It coordinates everything.
 * No execution happens here — decisions still go through the Transaction
 * Coordinator after constitutional review and governance approval.
 *
 * Weighted Consensus:
 *   Directors don't have equal say. Weights come from:
 *     - Historical accuracy (directors who were right more often weigh more)
 *     - Confidence in their opinion
 *     - Jurisdiction (treasury director weighs more on reserve decisions)
 *     - Economic impact (higher-impact proposals get more scrutiny)
 *     - Constitution (constitutional rules are absolute)
 */

import type {
  CouncilProposal, DirectorOpinion, CounterProposal,
  ConsensusResult, ConsensusOutcome,
  CouncilDecision, DecisionStatus, DebateRecord, DebateRound,
  CouncilMemoryEntry, DirectorAccuracyRecord,
  CouncilReport,
  OpinionPosition,
} from './types';
import type { DirectorType, StrategicAction } from '../directorate/types';
import { uid } from '../types';

/** Inputs from the runtime. */
export interface CouncilInputs {
  /** Get all director recommendations (raw proposals). */
  getDirectorRecommendations: () => Array<{
    director: DirectorType;
    action: StrategicAction;
    description: string;
    targetCountries: string[];
    amount?: number;
    currency?: string;
    expectedROI: number;
    expectedRisk: number;
    confidence: number;
    rationale: string;
  }>;
  /** Validate against the economic constitution. */
  validateConstitution: (context: Record<string, unknown>) => { passed: boolean; violations: string[] };
}

/**
 * EconomicCouncil — the coordinating body.
 *
 * Pipeline:
 *   1. Collect proposals from all directors
 *   2. Each director reviews every proposal (support/neutral/oppose + counter)
 *   3. Weighted consensus engine computes the outcome
 *   4. Constitutional review (absolute — can override consensus)
 *   5. Governance classification (automatic → operator → treasury → governance)
 *   6. Decision recorded in journal + memory
 */
export class EconomicCouncil {
  private readonly accuracyTracker = new Map<DirectorType, DirectorAccuracyRecord>();
  private readonly memory: CouncilMemoryEntry[] = [];
  private readonly decisions: CouncilDecision[] = [];
  private readonly pendingProposals: CouncilProposal[] = [];

  constructor(private inputs: CouncilInputs) {
    // Initialize accuracy tracker for all directors.
    const directors: DirectorType[] = ['treasury', 'corridor', 'lp', 'fx', 'settlement', 'country'];
    for (const d of directors) {
      this.accuracyTracker.set(d, {
        director: d, totalDecisions: 0, correctDecisions: 0,
        accuracyRate: 0.5, weight: 1.0, recentTrend: 'stable',
      });
    }
  }

  /**
   * Convene the council: collect all proposals, debate them, reach consensus.
   *
   * This is the main entry point. It:
   *   1. Collects raw recommendations from all directors
   *   2. Converts them to formal proposals
   *   3. Each director reviews every proposal
   *   4. Consensus engine computes the outcome
   *   5. Constitutional review
   *   6. Returns the list of council decisions
   */
  convene(): CouncilDecision[] {
    const rawRecs = this.inputs.getDirectorRecommendations();
    const decisions: CouncilDecision[] = [];

    for (const rec of rawRecs) {
      // Create formal proposal.
      const proposal: CouncilProposal = {
        proposalId: uid('prop'),
        proposedBy: rec.director,
        action: rec.action,
        description: rec.description,
        targetCountries: rec.targetCountries,
        targetCorridors: [],
        amount: rec.amount,
        currency: rec.currency,
        timeHorizon: 'medium_term',
        evidence: [{
          source: rec.director,
          metric: 'expectedROI',
          value: rec.expectedROI.toString(),
          interpretation: rec.rationale,
        }],
        expectedROI: rec.expectedROI,
        expectedRisk: rec.expectedRisk,
        confidence: rec.confidence,
        createdAt: Date.now(),
      };

      // Collect opinions from all directors.
      const opinions = this.collectOpinions(proposal);

      // Counter-proposals.
      const counterProposals = this.generateCounterProposals(proposal, opinions);

      // Consensus.
      const consensus = this.computeConsensus(proposal, opinions, counterProposals);

      // Constitutional review.
      const constitutionalReview = this.inputs.validateConstitution({
        action: proposal.action,
        amount: proposal.amount ?? 0,
        countries: proposal.targetCountries,
      });

      // Determine status.
      let status: DecisionStatus;
      let approvalClass: CouncilDecision['approvalClass'];

      if (!constitutionalReview.passed) {
        status = 'rejected';
        approvalClass = 'constitution_forbidden';
      } else if (consensus.outcome === 'rejected') {
        status = 'rejected';
        approvalClass = 'constitution_forbidden';
      } else if (consensus.outcome === 'requires_governance') {
        status = 'requires_governance';
        approvalClass = 'governance';
      } else if (consensus.weightedScore > 0.5 && consensus.outcome === 'accepted') {
        status = consensus.weightedScore > 0.8 ? 'approved' : 'constitutional_review';
        approvalClass = consensus.weightedScore > 0.8 ? 'automatic' : 'operator';
      } else {
        status = 'consensus_reached';
        approvalClass = 'treasury';
      }

      // Build debate record.
      const debateRecord: DebateRecord = {
        proposalId: proposal.proposalId,
        rounds: [{
          round: 1,
          opinions,
          counterProposals,
          summary: this.summarizeDebate(opinions, consensus),
        }],
        totalDurationMs: 0,
        finalOutcome: consensus.outcome,
      };

      const decision: CouncilDecision = {
        decisionId: uid('dec'),
        proposal,
        opinions,
        consensus,
        constitutionalReview,
        status,
        approvalClass,
        debateRecord,
        decidedAt: Date.now(),
      };

      decisions.push(decision);
      this.decisions.push(decision);
    }

    return decisions;
  }

  /**
   * Collect opinions from all directors on a proposal.
   *
   * Each director evaluates the proposal from their perspective:
   *   - Treasury: does this make financial sense?
   *   - LP: are there enough LPs/bandwidth?
   *   - FX: is there FX risk?
   *   - Settlement: can settlement handle this?
   *   - Corridor: is the corridor ready?
   *   - Country: does the country need this?
   */
  private collectOpinions(proposal: CouncilProposal): DirectorOpinion[] {
    const opinions: DirectorOpinion[] = [];
    const directors: DirectorType[] = ['treasury', 'corridor', 'lp', 'fx', 'settlement', 'country'];

    for (const director of directors) {
      // The proposing director always supports.
      if (director === proposal.proposedBy) {
        opinions.push({
          director, position: 'support', confidence: proposal.confidence,
          reason: `Original proposer — ${proposal.description}`,
          expectedROI: proposal.expectedROI, expectedRisk: proposal.expectedRisk,
          alternatives: [], submittedAt: Date.now(),
        });
        continue;
      }

      // Other directors evaluate based on their domain.
      const opinion = this.evaluateProposal(director, proposal);
      opinions.push(opinion);
    }

    return opinions;
  }

  /** A director evaluates a proposal from their domain perspective. */
  private evaluateProposal(director: DirectorType, proposal: CouncilProposal): DirectorOpinion {
    // Simplified domain-specific evaluation.
    // In production, each director would use its own intelligence engine.
    let position: OpinionPosition = 'neutral';
    let confidence = 0.5;
    let reason = 'No strong opinion';
    let expectedROI = proposal.expectedROI;
    let expectedRisk = proposal.expectedRisk;

    switch (director) {
      case 'treasury':
        // Treasury cares about ROI and risk.
        if (proposal.expectedROI > 0.1 && proposal.expectedRisk < 0.3) {
          position = 'support'; confidence = 0.8;
          reason = `Positive ROI (${(proposal.expectedROI * 100).toFixed(1)}%) with manageable risk`;
        } else if (proposal.expectedRisk > 0.5) {
          position = 'oppose'; confidence = 0.7;
          reason = `Risk too high (${(proposal.expectedRisk * 100).toFixed(1)}%)`;
        }
        break;

      case 'lp':
        // LP director cares about bandwidth and LP density.
        if (proposal.action === 'recruit_lps' || proposal.action === 'increase_lp_incentive') {
          position = 'support'; confidence = 0.85;
          reason = 'Action directly benefits LP network';
        } else if (proposal.action === 'open_reserve' || proposal.action === 'open_corridor') {
          position = 'neutral'; confidence = 0.6;
          reason = 'May increase demand for LP bandwidth — neutral without more data';
        }
        break;

      case 'fx':
        // FX director cares about currency risk.
        if (proposal.expectedRisk > 0.4) {
          position = 'oppose'; confidence = 0.65;
          reason = `High risk suggests potential FX exposure`;
          expectedRisk = proposal.expectedRisk * 1.2; // FX sees more risk
        } else {
          position = 'neutral'; confidence = 0.55;
          reason = 'No significant FX concern';
        }
        break;

      case 'settlement':
        // Settlement director cares about latency and rail capacity.
        if (proposal.action === 'optimize_settlement_latency' || proposal.action === 'switch_settlement_rail') {
          position = 'support'; confidence = 0.8;
          reason = 'Action improves settlement performance';
        } else {
          position = 'neutral'; confidence = 0.6;
          reason = 'No direct settlement impact identified';
        }
        break;

      case 'corridor':
        // Corridor director cares about corridor health.
        if (proposal.action === 'open_corridor') {
          position = 'support'; confidence = 0.75;
          reason = 'New corridor expansion aligns with growth strategy';
        } else if (proposal.action === 'close_corridor') {
          position = 'oppose'; confidence = 0.7;
          reason = 'Closing corridors reduces network connectivity';
        }
        break;

      case 'country':
        // Country director cares about local impact.
        if (proposal.targetCountries.length > 0) {
          position = 'support'; confidence = 0.7;
          reason = `Positive impact for ${proposal.targetCountries.join(', ')}`;
        }
        break;
    }

    return {
      director, position, confidence, reason,
      expectedROI, expectedRisk,
      alternatives: position === 'oppose' ? ['Reduce scope by 50%', 'Delay 90 days'] : [],
      submittedAt: Date.now(),
    };
  }

  /**
   * Generate counter-proposals from directors who oppose or have modifications.
   */
  private generateCounterProposals(proposal: CouncilProposal, opinions: DirectorOpinion[]): CounterProposal[] {
    const counters: CounterProposal[] = [];

    for (const op of opinions) {
      if (op.position === 'oppose' && op.alternatives.length > 0) {
        // Generate a counter-proposal that modifies the original.
        const modifiedAmount = proposal.amount ? proposal.amount * 0.6 : undefined;
        counters.push({
          counterProposalId: uid('ctr'),
          proposedBy: op.director,
          modifiedAction: proposal.action,
          modifiedAmount,
          modifications: op.alternatives,
          reason: op.reason,
          expectedROI: proposal.expectedROI * 0.7,
          expectedRisk: proposal.expectedRisk * 0.6,
          confidence: op.confidence,
        });
      }
    }

    return counters;
  }

  /**
   * Compute weighted consensus.
   *
   * Weights come from:
   *   - Historical accuracy (directors who were right more often weigh more)
   *   - Confidence in their opinion
   *   - Jurisdiction (proposing director weighs more on their domain)
   *
   * Score: [-1, 1] where 1 = unanimous support, -1 = unanimous oppose.
   */
  private computeConsensus(proposal: CouncilProposal, opinions: DirectorOpinion[], counters: CounterProposal[]): ConsensusResult {
    let supportWeight = 0;
    let opposeWeight = 0;
    let neutralWeight = 0;
    const directorWeights: Record<string, number> = {};

    for (const op of opinions) {
      const accuracy = this.accuracyTracker.get(op.director);
      const baseWeight = accuracy?.weight ?? 1.0;
      const jurisdictionBonus = op.director === proposal.proposedBy ? 1.3 : 1.0;
      const weight = baseWeight * jurisdictionBonus * op.confidence;
      directorWeights[op.director] = weight;

      if (op.position === 'support') supportWeight += weight;
      else if (op.position === 'oppose') opposeWeight += weight;
      else neutralWeight += weight;
    }

    const totalWeight = supportWeight + opposeWeight + neutralWeight;
    const weightedScore = totalWeight > 0 ? (supportWeight - opposeWeight) / totalWeight : 0;

    let outcome: ConsensusOutcome;
    let acceptedCounterProposal: CounterProposal | undefined;
    let rationale: string;

    if (weightedScore > 0.5) {
      outcome = 'accepted';
      rationale = `Strong consensus (score: ${weightedScore.toFixed(2)}) — ${supportWeight.toFixed(1)} support vs ${opposeWeight.toFixed(1)} oppose`;
    } else if (weightedScore > 0.1 && counters.length > 0) {
      // Accept with modifications (best counter-proposal).
      outcome = 'accepted_with_modifications';
      acceptedCounterProposal = counters[0];
      rationale = `Modified consensus (score: ${weightedScore.toFixed(2)}) — counter-proposal from ${counters[0].proposedBy} accepted`;
    } else if (weightedScore > -0.2) {
      outcome = 'requires_governance';
      rationale = `Insufficient consensus (score: ${weightedScore.toFixed(2)}) — requires governance vote`;
    } else {
      outcome = 'rejected';
      rationale = `Consensus rejected (score: ${weightedScore.toFixed(2)}) — ${opposeWeight.toFixed(1)} oppose vs ${supportWeight.toFixed(1)} support`;
    }

    return { outcome, weightedScore, supportWeight, opposeWeight, neutralWeight, acceptedCounterProposal, rationale, directorWeights };
  }

  /** Summarize the debate for the debate record. */
  private summarizeDebate(opinions: DirectorOpinion[], consensus: ConsensusResult): string {
    const supports = opinions.filter((o) => o.position === 'support').map((o) => o.director);
    const opposes = opinions.filter((o) => o.position === 'oppose').map((o) => o.director);
    const neutrals = opinions.filter((o) => o.position === 'neutral').map((o) => o.director);
    return `Support: ${supports.join(', ') || 'none'} | Oppose: ${opposes.join(', ') || 'none'} | Neutral: ${neutrals.join(', ') || 'none'} | ${consensus.rationale}`;
  }

  // ── Memory + Accuracy Tracking ──────────────────────────────────────────

  /**
   * Record the outcome of a decision in council memory.
   * Updates director accuracy based on whether their opinion was correct.
   */
  recordOutcome(decisionId: string, outcome: 'success' | 'partial' | 'failure', actualROI?: number, actualRisk?: number): void {
    const decision = this.decisions.find((d) => d.decisionId === decisionId);
    if (!decision) return;

    const lessonsLearned: string[] = [];
    const directorAccuracy: Record<string, boolean> = {};

    for (const op of decision.opinions) {
      // Was the director's opinion correct?
      // Support + success = correct. Oppose + failure = correct.
      const wasCorrect =
        (op.position === 'support' && outcome === 'success') ||
        (op.position === 'oppose' && outcome === 'failure') ||
        (op.position === 'neutral');

      directorAccuracy[op.director] = wasCorrect;

      // Update accuracy tracker.
      const record = this.accuracyTracker.get(op.director);
      if (record) {
        record.totalDecisions++;
        if (wasCorrect) record.correctDecisions++;
        record.accuracyRate = record.correctDecisions / record.totalDecisions;
        // Adjust weight based on accuracy (0.5 to 1.5).
        record.weight = 0.5 + record.accuracyRate;
        // Trend.
        if (record.accuracyRate > 0.7) record.recentTrend = 'improving';
        else if (record.accuracyRate < 0.4) record.recentTrend = 'declining';
        else record.recentTrend = 'stable';
      }

      if (!wasCorrect) {
        lessonsLearned.push(`${op.director} director's ${op.position} was incorrect — outcome was ${outcome}`);
      }
    }

    if (actualROI !== undefined && actualROI < (decision.proposal.expectedROI * 0.5)) {
      lessonsLearned.push(`Actual ROI (${actualROI.toFixed(2)}) was significantly below expected (${decision.proposal.expectedROI.toFixed(2)})`);
    }

    this.memory.push({
      memoryId: uid('mem'),
      decisionId,
      proposal: {
        action: decision.proposal.action,
        description: decision.proposal.description,
        countries: decision.proposal.targetCountries,
      },
      opinions: decision.opinions.map((o) => ({ director: o.director, position: o.position, confidence: o.confidence })),
      consensus: decision.consensus.outcome,
      outcome,
      actualROI, actualRisk,
      lessonsLearned,
      directorAccuracy,
      timestamp: Date.now(),
    });
  }

  /** Get director accuracy records. */
  getDirectorAccuracy(): DirectorAccuracyRecord[] {
    return [...this.accuracyTracker.values()];
  }

  /** Get all council memory. */
  getMemory(): CouncilMemoryEntry[] {
    return [...this.memory];
  }

  /** Get all decisions. */
  getDecisions(): CouncilDecision[] {
    return [...this.decisions];
  }

  /** Get recent decisions. */
  getRecentDecisions(limit: number = 10): CouncilDecision[] {
    return this.decisions.slice(-limit);
  }

  /** Get the full council report. */
  getReport(): CouncilReport {
    const recent = this.getRecentDecisions(10);
    const accepted = this.decisions.filter((d) => d.status === 'approved' || d.status === 'constitutional_review');
    const acceptanceRate = this.decisions.length > 0 ? accepted.length / this.decisions.length : 0;

    return {
      activeProposals: this.pendingProposals.length,
      pendingDecisions: this.decisions.filter((d) => d.status === 'pending' || d.status === 'in_debate'),
      recentDecisions: recent,
      directorAccuracy: this.getDirectorAccuracy(),
      memory: this.getMemory(),
      totalProposals: this.decisions.length,
      acceptanceRate,
      generatedAt: Date.now(),
    };
  }
}
