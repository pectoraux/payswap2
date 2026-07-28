/**
 * GET /api/developer/inspectors/council
 *
 * Reads from payswapRuntime.council (the Economic Council). Lists:
 *   - Recent council decisions (debate records + consensus scores)
 *   - Director accuracy records
 *   - Council memory (outcome tracking)
 *   - Stats (total proposals, acceptance rate, average confidence)
 *
 * If the council hasn't been convened yet (no decisions recorded), we
 * automatically convene it once so the inspector has data to show.
 */

import { NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { runtime as payswapRuntime } from '@/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DirectorOpinionView {
  director: string;
  position: 'support' | 'neutral' | 'oppose';
  confidence: number;
  reason: string;
  expectedROI: number;
  expectedRisk: number;
  alternatives: string[];
  submittedAt: number;
}

interface CouncilDecisionView {
  decisionId: string;
  proposedBy: string;
  action: string;
  description: string;
  targetCountries: string[];
  amount?: number;
  currency?: string;
  expectedROI: number;
  expectedRisk: number;
  confidence: number;
  status: string;
  approvalClass: string;
  decidedAt: number;
  consensus: {
    outcome: string;
    weightedScore: number;
    supportWeight: number;
    opposeWeight: number;
    neutralWeight: number;
    rationale: string;
    directorWeights: Record<string, number>;
  };
  constitutionalReview: {
    passed: boolean;
    violations: string[];
  };
  opinions: DirectorOpinionView[];
}

interface DirectorAccuracyView {
  director: string;
  totalDecisions: number;
  correctDecisions: number;
  accuracyRate: number;
  weight: number;
  recentTrend: string;
}

interface CouncilMemoryView {
  memoryId: string;
  decisionId: string;
  proposal: { action: string; description: string; countries: string[] };
  consensus: string;
  outcome: string;
  actualROI?: number;
  actualRisk?: number;
  lessonsLearned: string[];
  timestamp: number;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    // Auto-convene if no decisions have been recorded.
    let decisions = payswapRuntime.council.getDecisions();
    if (decisions.length === 0) {
      try {
        payswapRuntime.council.convene();
        decisions = payswapRuntime.council.getDecisions();
      } catch (err) {
        console.warn('[api/developer/inspectors/council] convene failed:', err);
      }
    }

    const directorAccuracy = payswapRuntime.council.getDirectorAccuracy();
    const memory = payswapRuntime.council.getMemory();
    const report = payswapRuntime.council.getReport();

    const decisionViews: CouncilDecisionView[] = decisions.map((d) => ({
      decisionId: d.decisionId,
      proposedBy: d.proposal.proposedBy,
      action: d.proposal.action,
      description: d.proposal.description,
      targetCountries: d.proposal.targetCountries,
      amount: d.proposal.amount,
      currency: d.proposal.currency,
      expectedROI: d.proposal.expectedROI,
      expectedRisk: d.proposal.expectedRisk,
      confidence: d.proposal.confidence,
      status: d.status,
      approvalClass: d.approvalClass,
      decidedAt: d.decidedAt,
      consensus: {
        outcome: d.consensus.outcome,
        weightedScore: d.consensus.weightedScore,
        supportWeight: d.consensus.supportWeight,
        opposeWeight: d.consensus.opposeWeight,
        neutralWeight: d.consensus.neutralWeight,
        rationale: d.consensus.rationale,
        directorWeights: d.consensus.directorWeights,
      },
      constitutionalReview: {
        passed: d.constitutionalReview.passed,
        violations: d.constitutionalReview.violations,
      },
      opinions: d.opinions.map((o) => ({
        director: o.director,
        position: o.position,
        confidence: o.confidence,
        reason: o.reason,
        expectedROI: o.expectedROI,
        expectedRisk: o.expectedRisk,
        alternatives: o.alternatives,
        submittedAt: o.submittedAt,
      })),
    }));

    const accuracyViews: DirectorAccuracyView[] = directorAccuracy.map((a) => ({
      director: a.director,
      totalDecisions: a.totalDecisions,
      correctDecisions: a.correctDecisions,
      accuracyRate: a.accuracyRate,
      weight: a.weight,
      recentTrend: a.recentTrend,
    }));

    const memoryViews: CouncilMemoryView[] = memory.map((m) => ({
      memoryId: m.memoryId,
      decisionId: m.decisionId,
      proposal: m.proposal,
      consensus: m.consensus,
      outcome: m.outcome,
      actualROI: m.actualROI,
      actualRisk: m.actualRisk,
      lessonsLearned: m.lessonsLearned,
      timestamp: m.timestamp,
    }));

    // Stats.
    const totalProposals = decisions.length;
    const accepted = decisions.filter((d) => d.status === 'approved' || d.status === 'constitutional_review').length;
    const acceptanceRate = totalProposals > 0 ? accepted / totalProposals : 0;
    const avgConfidence = decisions.length > 0
      ? decisions.reduce((s, d) => s + d.proposal.confidence, 0) / decisions.length
      : 0;
    const avgWeightedScore = decisions.length > 0
      ? decisions.reduce((s, d) => s + d.consensus.weightedScore, 0) / decisions.length
      : 0;

    return NextResponse.json({
      ok: true,
      decisions: decisionViews.reverse(), // most recent first
      directorAccuracy: accuracyViews,
      memory: memoryViews.reverse(),
      stats: {
        totalProposals,
        accepted,
        acceptanceRate,
        avgConfidence,
        avgWeightedScore,
        activeProposals: report.activeProposals,
      },
    });
  } catch (err) {
    console.error('[api/developer/inspectors/council] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
