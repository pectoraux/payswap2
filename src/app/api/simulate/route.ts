import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import {
  simulationEngine,
  defaultScenario,
  libraryScenarios,
  COUNTRY_OPTIONS,
  ENGINES,
  KERNEL_VERSION,
  FO_META,
  type SimulationScenario,
  type SimulationResult,
  type AIDecision,
} from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/simulate — default scenario + simulator metadata + library scenarios. */
export async function GET() {
  return NextResponse.json({
    scenario: defaultScenario(),
    countryOptions: COUNTRY_OPTIONS,
    engines: ENGINES,
    kernelVersion: KERNEL_VERSION,
    foMeta: FO_META,
    libraryScenarios: libraryScenarios().map((s) => ({ scenario: s.scenario, category: s.category })),
  });
}

/** POST /api/simulate — run a scenario through the kernel Digital Twin. */
export async function POST(req: NextRequest) {
  let scenario: SimulationScenario;
  try {
    const body = await req.json();
    scenario = body?.scenario as SimulationScenario;
    if (!scenario || !scenario.transaction) scenario = defaultScenario();
  } catch {
    scenario = defaultScenario();
  }

  // 1. Run the Digital Twin (deterministic, in-memory).
  const result: SimulationResult = simulationEngine.run(scenario);

  // 2. Enhance the AI narrative with an LLM (best-effort; falls back cleanly).
  try {
    const narrative = await generateLLMNarrative(result);
    if (narrative) {
      result.plan.reasoning.narrative = narrative;
      result.plan.reasoning.llmPowered = true;
    }
  } catch (err) {
    console.error('[simulate] LLM narrative failed:', err);
  }

  // 3. Persist (fire-and-forget).
  persistRun(result).catch((err) => console.error('[simulate] persist failed:', err));

  return NextResponse.json(result);
}

async function generateLLMNarrative(result: SimulationResult): Promise<string | null> {
  const zai = await ZAI.create();
  const decisions = result.plan.reasoning.decisions
    .map((d: AIDecision) => `- ${d.step}: ${d.rationale}`)
    .join('\n');
  const objectives = result.plan.reasoning.objectiveScores
    .map((s) => `${s.objective}=${s.score} (${s.rationale})`)
    .join('; ');

  const system =
    'You are the PaySwap Kernel AI Agent — a Global Liquidity Operating System. You explain liquidity movement decisions in clear, technical prose for a payments engineer. Be specific about liquidity sources, reserves, treasury, risk and cost. 2-3 sentences. No bullet points, no markdown, no preamble.';

  const user = `Scenario: ${result.scenario.transaction.buyer.country} (${result.scenario.transaction.buyer.method}) moves ${result.scenario.transaction.amount} ${result.scenario.transaction.currency} to ${result.scenario.transaction.merchant.country}. Priority: ${result.scenario.transaction.priority}.

Decisions:
${decisions}

Objective scores: ${objectives}

Metrics: cost ${result.plan.metrics.costPercent}% (${result.plan.metrics.totalFees} ${result.scenario.transaction.currency}), time ${result.plan.metrics.settlementTimeLabel}, risk ${result.plan.metrics.riskScore} (${result.plan.metrics.riskLabel}), confidence ${result.plan.metrics.confidence}%.
Amendments: ${result.amendments.length}. Insurance claims: ${result.insuranceClaims.length}.

Explain in 2-3 sentences why the planner chose this liquidity path and whether it is safe to settle autonomously.`;

  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  });

  const text = completion.choices[0]?.message?.content?.trim();
  return text && text.length > 0 ? text : null;
}

async function persistRun(result: SimulationResult): Promise<void> {
  await db.simulationRun.create({
    data: {
      runId: result.runId,
      kernelVersion: result.kernelVersion,
      scenarioName: result.scenario.name,
      scenario: JSON.stringify(result.scenario),
      result: JSON.stringify(result),
      resultHash: result.resultHash,
      amount: result.scenario.transaction.amount,
      currency: result.scenario.transaction.currency,
      priority: result.scenario.transaction.priority,
      buyerCountry: result.scenario.transaction.buyer.country,
      merchantCountry: result.scenario.transaction.merchant.country,
      costPercent: result.plan.metrics.costPercent,
      settlementMs: result.plan.metrics.settlementTimeMs,
      riskScore: result.plan.metrics.riskScore,
      confidence: result.plan.metrics.confidence,
      settled: result.settled,
      amendments: result.amendments.length,
      failures: result.scenario.failures.length,
    },
  });

  if (result.ledger.length > 0) {
    await db.ledgerEntryRecord.createMany({
      data: result.ledger.map((e) => ({
        runId: result.runId,
        txId: e.txId,
        accountId: e.accountId,
        accountLabel: e.accountLabel,
        accountType: e.accountType,
        currency: e.currency,
        debit: e.debit,
        credit: e.credit,
        balanceAfter: e.balanceAfter,
        memo: e.memo,
        frame: e.frame,
      })),
    });
  }

  if (result.twinTokens.length > 0) {
    await db.twinTokenRecord.createMany({
      data: result.twinTokens.map((t) => ({
        runId: result.runId,
        symbol: t.symbol,
        amount: t.amount,
        currency: t.currency,
        fromCountry: t.fromCountry,
        toCountry: t.toCountry,
        status: t.status,
        mintedAtFrame: t.mintedAtFrame,
        burnedAtFrame: t.burnedAtFrame,
        memo: t.memo,
      })),
    });
  }

  if (result.amendments.length > 0) {
    await db.planAmendmentRecord.createMany({
      data: result.amendments.map((a) => ({
        runId: result.runId,
        failureType: a.triggeredBy.type,
        failureLabel: a.triggeredBy.label,
        reason: a.reason,
        recoveryStrategy: a.recoveryStrategy,
        insertedAtFrame: a.insertedAtFrame,
        stepCount: a.steps.length,
      })),
    });
  }

  if (result.audit.entries.length > 0) {
    await db.auditLog.createMany({
      data: result.audit.entries.map((a) => ({
        runId: result.runId,
        actor: a.actor,
        action: a.action,
        detail: a.detail,
      })),
    });
  }
}
