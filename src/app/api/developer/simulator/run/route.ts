import { NextRequest, NextResponse } from 'next/server';
import { requireSession, unauthorized } from '@/lib/api-auth';
import { simulationEngine, KERNEL_VERSION, permissionEngine } from '@/kernel';
import { findScenario } from '@/lib/developer-scenarios';
import type { SimulationResult } from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TimelineStep {
  name: string;
  description: string;
  status: 'success' | 'blocked' | 'skipped' | 'failed' | 'pending';
  detail?: string;
  frame?: number;
}

interface LedgerImpact {
  before: { account: string; balance: number; currency?: string }[];
  after: { account: string; balance: number; currency?: string; delta: number }[];
  entries: {
    id: string;
    accountId: string;
    accountLabel: string;
    currency: string;
    debit: number;
    credit: number;
    balanceAfter: number;
    memo: string;
    frame: number;
  }[];
}

interface DecisionInspector {
  step: string;
  rationale: string;
  policy: { passed: boolean; findings: { policy: string; severity: string; detail: string }[] };
  alternatives: {
    label: string;
    reason: string;
    weightedScore: number;
    costPercent: number;
    settlementTimeMs: number;
    riskScore: number;
  }[];
  constitution: { section: string; passed: boolean; checks: { invariant: string; passed: boolean; detail: string }[] }[];
  council: { strategy: string; weightedScore: number; objectiveScores: { objective: string; score: number; rationale: string }[] };
  expectedRoi: { costPercent: number; settlementTimeMs: number; confidence: number };
  risk: { score: number; label: string };
  approvalLevel: string;
}

interface SimulatorRunResponse {
  runId: string;
  kernelVersion: string;
  settled: boolean;
  scenarioId: string;
  scenarioLabel: string;
  timeline: TimelineStep[];
  events: {
    id: string;
    type: string;
    aggregate: string;
    version: number;
    frame: number;
    ts: number;
    latencyMs: number;
    payload: Record<string, unknown>;
  }[];
  ledger: LedgerImpact;
  decisions: DecisionInspector[];
  metrics: {
    costPercent: number;
    settlementTimeMs: number;
    settlementTimeLabel: string;
    riskScore: number;
    riskLabel: string;
    confidence: number;
    totalFees: number;
    fxRate: number;
  };
  amendments: { description: string; reason: string; recoveryStrategy: string; insertedAtFrame: number }[];
  twinTokens: { symbol: string; amount: number; currency: string; status: string }[];
  resultHash: string;
}

/**
 * POST /api/developer/simulator/run
 *
 * Run a pre-built scenario through the kernel and return a structured
 * result with timeline, events, ledger impact, and decision inspector.
 *
 * Body: { scenarioId: string }
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  const userId = (session.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'No user id in session' }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : '';
  const scenario = findScenario(scenarioId);
  if (!scenario) {
    return NextResponse.json(
      { ok: false, error: `Unknown scenario: ${scenarioId}` },
      { status: 400 },
    );
  }

  try {
    const simScenario = scenario.build();
    const start = Date.now();
    // Register the developer as an actor with `kernel:simulate` capability so
    // the simulator can run on their behalf. The kernel's permission engine
    // only ships a single pre-registered `simulator` actor — every other
    // caller (including developers in the dev console) must be granted the
    // capability explicitly. This is a sandboxed simulation; no production
    // state is mutated.
    const actorId = `developer:${userId}`;
    permissionEngine.register({
      id: actorId,
      name: `Developer ${userId.slice(-8)}`,
      capabilities: new Set(['kernel:simulate']),
    });
    const result: SimulationResult = simulationEngine.run(simScenario, {
      actorId,
    });
    const elapsed = Date.now() - start;

    // === Build the timeline ===
    // Map the kernel's pipeline stages to a linear timeline.
    const timeline: TimelineStep[] = [
      {
        name: 'Intent',
        description: `${simScenario.transaction.amount} ${simScenario.transaction.currency} ${simScenario.transaction.buyer.country} → ${simScenario.transaction.merchant.country} (${simScenario.transaction.priority})`,
        status: 'success',
        frame: 0,
      },
      {
        name: 'Compiler',
        description: `Optimization engine evaluated ${result.candidatePlans?.length ?? 0} candidate plans.`,
        status: result.plan.feasible ? 'success' : 'failed',
        detail: result.plan.feasible
          ? `Selected strategy: ${result.plan.reasoning.strategy}`
          : 'No feasible plan found',
        frame: 0,
      },
      {
        name: 'Policy',
        description: result.plan.policy.passed
          ? 'All policy checks passed.'
          : 'Policy check failed — payment blocked.',
        status: result.plan.policy.passed ? 'success' : 'blocked',
        detail: result.plan.policy.findings
          .map((f) => `[${f.severity}] ${f.policy}: ${f.detail}`)
          .join('\n'),
        frame: 0,
      },
      {
        name: 'Council',
        description: `Weighted score: ${(result.plan.reasoning.weightedScore * 100).toFixed(1)}%. ${result.plan.reasoning.objectiveScores?.length ?? 0} objective scores evaluated.`,
        status: 'success',
        detail: result.plan.reasoning.narrative,
        frame: 0,
      },
      {
        name: 'Constitution',
        description: result.constitution.passed
          ? `Constitution checks passed (${result.constitution.passedRules}/${result.constitution.totalRules}).`
          : `Constitution checks failed (${result.constitution.passedRules}/${result.constitution.totalRules}).`,
        status: result.constitution.passed ? 'success' : 'blocked',
        detail: result.constitution.violations
          .map((v) => `[${v.severity}] ${v.section}: ${v.invariant} — ${v.detail}`)
          .join('\n'),
        frame: 0,
      },
      {
        name: 'Coordinator',
        description: `Plan executor ran ${result.plan.steps.length} steps.`,
        status: result.settled ? 'success' : 'failed',
        detail: result.plan.steps.map((s) => s.title).join(' → '),
        frame: 0,
      },
      {
        name: 'Treasury',
        description: result.treasuryRecommendations.length > 0
          ? `${result.treasuryRecommendations.length} treasury recommendation(s) issued.`
          : 'No treasury recommendations.',
        status: 'success',
        detail: result.treasuryRecommendations
          .map((r) => `${r.priority.toUpperCase()}: ${r.action} — ${r.rationale}`)
          .join('\n'),
        frame: 0,
      },
      {
        name: 'Settlement',
        description: result.settled
          ? 'Payment settled successfully.'
          : 'Settlement failed — plan rolled back.',
        status: result.settled ? 'success' : 'failed',
        detail: result.settled
          ? `Settled in ${result.plan.metrics.settlementTimeLabel}.`
          : 'Plan was not feasible — no settlement occurred.',
        frame: 0,
      },
      {
        name: 'Marketplace',
        description: `${result.plan.sourceDraws.length} liquidity source(s) drawn.`,
        status: result.plan.sourceDraws.length > 0 ? 'success' : 'skipped',
        detail: result.plan.sourceDraws
          .map((d) => `${d.sourceLabel}: ${d.drawn} ${d.currency} @ ${d.rate} (fee ${d.fee})${d.exhausted ? ' [exhausted]' : ''}`)
          .join('\n'),
        frame: 0,
      },
      {
        name: 'Ledger',
        description: `${result.ledger.length} ledger entries written.`,
        status: result.ledger.length > 0 ? 'success' : 'skipped',
        frame: 0,
      },
      {
        name: 'Events',
        description: `${result.events.length} events emitted across ${result.replay.length} replay frames.`,
        status: result.events.length > 0 ? 'success' : 'skipped',
        frame: 0,
      },
      {
        name: 'Projections',
        description: `${result.twinTokens.length} twin token(s) minted. ${result.amendments.length} amendment(s). ${result.workflows.length} workflow(s).`,
        status: 'success',
        frame: 0,
      },
    ];

    // === Build the event stream ===
    const events = result.events.map((evt, idx) => ({
      id: evt.id,
      type: evt.type,
      aggregate: (evt.payload?.aggregateId as string) ?? (evt.payload?.planId as string) ?? 'kernel',
      version: idx + 1,
      frame: evt.frame,
      ts: evt.ts,
      latencyMs: idx === 0 ? elapsed : Math.max(0, Math.round(elapsed / Math.max(1, result.events.length))),
      payload: evt.payload,
    }));

    // === Build ledger impact (before / after) ===
    // Pull unique accounts from ledger entries; compute "before" by walking
    // the entries in reverse.
    const accountMap = new Map<string, { account: string; balance: number; currency?: string }>();
    for (const entry of result.ledger) {
      const before = entry.balanceAfter - entry.credit + entry.debit;
      accountMap.set(entry.accountId, {
        account: entry.accountLabel,
        balance: entry.balanceAfter,
        currency: entry.currency,
      });
      // Stash the before-balance on the entry via a side map.
      (entry as any)._before = before;
    }
    const before = result.ledger.map((e) => ({
      account: e.accountLabel,
      balance: (e as any)._before as number,
      currency: e.currency,
    }));
    const after = Array.from(accountMap.values());
    const ledger: LedgerImpact = {
      before,
      after: after.map((a) => {
        const b = before.find((x) => x.account === a.account);
        return { ...a, delta: b ? a.balance - b.balance : a.balance };
      }),
      entries: result.ledger.map((e) => ({
        id: e.id,
        accountId: e.accountId,
        accountLabel: e.accountLabel,
        currency: e.currency,
        debit: e.debit,
        credit: e.credit,
        balanceAfter: e.balanceAfter,
        memo: e.memo,
        frame: e.frame,
      })),
    };

    // === Build decision inspector ===
    const decisions: DecisionInspector[] = result.plan.reasoning.decisions.map((d) => ({
      step: d.step,
      rationale: d.rationale,
      policy: {
        passed: result.plan.policy.passed,
        findings: result.plan.policy.findings.map((f) => ({
          policy: f.policy,
          severity: f.severity,
          detail: f.detail,
        })),
      },
      alternatives: result.plan.alternatives.map((a) => ({
        label: a.label,
        reason: a.reason,
        weightedScore: a.weightedScore,
        costPercent: a.costPercent,
        settlementTimeMs: a.settlementTimeMs,
        riskScore: a.riskScore,
      })),
      constitution: result.constitution.sections.map((s) => ({
        section: s.section,
        passed: s.passed,
        checks: s.checks.map((c) => ({
          invariant: c.invariant,
          passed: c.passed,
          detail: c.detail,
        })),
      })),
      council: {
        strategy: result.plan.reasoning.strategy,
        weightedScore: result.plan.reasoning.weightedScore,
        objectiveScores: result.plan.reasoning.objectiveScores.map((o) => ({
          objective: o.objective,
          score: o.score,
          rationale: o.rationale,
        })),
      },
      expectedRoi: {
        costPercent: result.plan.metrics.costPercent,
        settlementTimeMs: result.plan.metrics.settlementTimeMs,
        confidence: result.plan.metrics.confidence,
      },
      risk: {
        score: result.plan.metrics.riskScore,
        label: result.plan.metrics.riskLabel,
      },
      approvalLevel: result.plan.policy.passed
        ? result.constitution.passed
          ? 'autonomous'
          : 'constitution_review'
        : 'policy_block',
    }));

    const response: SimulatorRunResponse = {
      runId: result.runId,
      kernelVersion: KERNEL_VERSION,
      settled: result.settled,
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      timeline,
      events,
      ledger,
      decisions,
      metrics: {
        costPercent: result.plan.metrics.costPercent,
        settlementTimeMs: result.plan.metrics.settlementTimeMs,
        settlementTimeLabel: result.plan.metrics.settlementTimeLabel,
        riskScore: result.plan.metrics.riskScore,
        riskLabel: result.plan.metrics.riskLabel,
        confidence: result.plan.metrics.confidence,
        totalFees: result.plan.metrics.totalFees,
        fxRate: result.plan.metrics.fxRate,
      },
      amendments: result.amendments.map((a) => ({
        description: a.triggeredBy.label,
        reason: a.reason,
        recoveryStrategy: a.recoveryStrategy,
        insertedAtFrame: a.insertedAtFrame,
      })),
      twinTokens: result.twinTokens.map((t) => ({
        symbol: t.symbol,
        amount: t.amount,
        currency: t.currency,
        status: t.status,
      })),
      resultHash: result.resultHash,
    };

    return NextResponse.json({ ok: true, run: response, elapsedMs: elapsed });
  } catch (err) {
    console.error('[api/developer/simulator/run] error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
