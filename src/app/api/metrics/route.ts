import { NextResponse } from 'next/server';
import { simulationEngine, defaultScenario } from '@/kernel';
import { computeMetrics, aggregateMetrics, METRIC_META } from '@/kernel/metrics';
import { protocolScenarios } from '@/protocol/scenarios';
import { runProtocolScenario } from '@/protocol/runner';
import { fuzz } from '@/protocol/fuzz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/metrics — operational metrics dashboard */
export async function GET() {
  // Run the 20 protocol scenarios
  const scenarios = protocolScenarios();
  const protocolResults = scenarios.map((s) => {
    try { return runProtocolScenario(s); } catch { return null; }
  }).filter((r) => r !== null) as any[];

  // Run 100 fuzz iterations
  const fuzzResult = fuzz(100);

  // Compute aggregated metrics
  const protocolMetrics = aggregateMetrics(protocolResults);
  const fuzzMetrics = aggregateMetrics(fuzzResult.results.map((r) => ({
    runId: '', createdAt: 0, kernelVersion: '', scenario: defaultScenario(), plan: { id: '', requestId: '', steps: [], sourceDraws: [], twinTokenSymbol: '', metrics: { settlementTimeMs: r.durationMs, settlementTimeLabel: '', costPercent: 0, costAmount: 0, riskScore: 0, riskLabel: 'Low' as const, confidence: 0, fxRate: 0, fxSpreadBps: 0, totalFees: 0, reserveUtilization: 0, liquidityUtilization: 0, insuranceExposure: 0, twinTokensMinted: 0 }, reasoning: { strategy: '', objectiveScores: [], weightedScore: 0, narrative: '', llmPowered: false, decisions: [] }, policy: { passed: r.constitutionPassed, findings: [] }, alternatives: [], status: 'validated' as const, createdAt: 0, feasible: r.settled, notes: [] },
    amendments: [], workflows: [], insuranceClaims: [], treasuryRecommendations: [], replay: [], ledger: [], events: [], twinTokens: [], worldState: { reserves: [], liquidityProviders: [], financialOperators: [], treasury: { positions: [] } }, audit: { runId: '', actor: '', entries: [] }, engines: [], resultHash: '', settled: r.settled, constitution: { passed: r.constitutionPassed, sections: [], violations: [], checks: [], totalRules: 9, passedRules: r.constitutionPassed ? 9 : 7 }, graph: { nodes: [], edges: [] }, worldInspector: { deltas: [], before: { reserves: [], liquidityProviders: [] }, after: { reserves: [], liquidityProviders: [] } }, lpLifecycleEvents: [], candidatePlans: [], stateTransitions: [], worldHistory: [], reasoningResults: [], intentType: 'payment', executionGraph: { id: '', commandId: '', totalNodes: 0, parallelGroups: 0, criticalPathLength: 0, status: '', nodes: [], edges: [] }, entities: [], organizationPolicy: { reserveThreshold: 0, treasuryStrategy: 'balanced' as const, lpPreference: 'mixed' as const, carbonObjective: 0, communityWeight: 0, riskAppetite: 'low' as const, maxLpShare: 0, maxCostPercent: 0, maxRiskScore: 0, requireInsurance: false, reservePolicy: 'hybrid' as const }, runtimeServices: [], solverCandidates: [], transitions: [], capabilities: [], eventLog: [], protocol: { escrowEntries: [], collateralEntries: [], lpRegistry: [], merchantRegistry: [], disputes: [], auctions: [], netSettlement: { corridors: [], grossVolume: 0, netVolume: 0 }, twinTokenSupply: [] }, fiatProofs: [], scenarioId: '', validates: [], obligations: [], proposals: [], reservations: [],
  } as any)));

  return NextResponse.json({
    metrics: {
      protocol: protocolMetrics,
      fuzz: { ...fuzzMetrics, fuzzSummary: fuzzResult.summary },
    },
    metricMeta: METRIC_META,
    fuzzSummary: fuzzResult.summary,
  });
}
