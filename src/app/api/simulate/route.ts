import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import {
  simulationEngine,
  defaultScenario,
  COUNTRY_OPTIONS,
  ENGINES,
  KERNEL_VERSION,
  type SimulationScenario,
  type SimulationResult,
  type AIDecision,
} from '@/kernel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/simulate — returns the default scenario + simulator metadata. */
export async function GET() {
  return NextResponse.json({
    scenario: defaultScenario(),
    countryOptions: COUNTRY_OPTIONS,
    engines: ENGINES,
    kernelVersion: KERNEL_VERSION,
  });
}

/** POST /api/simulate — runs a scenario through the kernel and returns the result. */
export async function POST(req: NextRequest) {
  let scenario: SimulationScenario;
  try {
    const body = await req.json();
    scenario = body?.scenario as SimulationScenario;
    if (!scenario || !scenario.buyer || !scenario.merchant) {
      scenario = defaultScenario();
    }
  } catch {
    scenario = defaultScenario();
  }

  // 1. Run the kernel simulation (deterministic, in-memory).
  const result: SimulationResult = simulationEngine.run(scenario);

  // 2. Enhance the AI narrative with an LLM (best-effort; falls back cleanly).
  try {
    const narrative = await generateLLMNarrative(result);
    if (narrative) {
      result.reasoning.narrative = narrative;
      result.reasoning.llmPowered = true;
    }
  } catch (err) {
    // Keep the deterministic fallback narrative; flag that LLM was unavailable.
    console.error('[simulate] LLM narrative failed:', err);
  }

  // 3. Persist the run (fire-and-forget; failures don't break the response).
  persistRun(result).catch((err) => {
    console.error('[simulate] persist failed:', err);
  });

  return NextResponse.json(result);
}

/**
 * Ask the kernel's AI Agent to narrate the settlement decision in natural
 * language. Uses the deterministic reasoning as structured context.
 */
async function generateLLMNarrative(result: SimulationResult): Promise<string | null> {
  const zai = await ZAI.create();
  const decisions = result.reasoning.decisions
    .map((d: AIDecision) => `- ${d.step}: ${d.rationale}`)
    .join('\n');

  const system =
    'You are the PaySwap Kernel AI Agent. You explain cross-border payment routing decisions in clear, concise, technical prose for a payments engineer. Be specific about liquidity, reserves, risk and cost. 2-3 sentences. No bullet points, no markdown, no preamble.';

  const user = `Scenario: ${result.scenario.buyer.country} (${result.scenario.buyer.method}) pays ${result.scenario.amount} ${result.scenario.currency} to a merchant in ${result.scenario.merchant.country}. Preference: ${result.scenario.preference}.

Routing decisions:
${decisions}

Metrics:
- Settlement time: ${result.metrics.settlementTimeLabel}
- Blended cost: ${result.metrics.costPercent}% (${result.metrics.totalFees} ${result.scenario.currency})
- Risk score: ${result.metrics.riskScore} (${result.metrics.riskLabel})
- Confidence: ${result.metrics.confidence}%
- LPs used: ${result.plan.lpUsage.map((u) => `LP${u.lpId} (${u.drawn} @ ${u.rate}%${u.exhausted ? ', exhausted' : ''})`).join(', ') || 'none'}
- Twin token: ${result.plan.twinTokenSymbol}

Explain in 2-3 sentences why the kernel chose this path and why it is safe to settle autonomously.`;

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

/** Persist the run and its ledger/twin/audit records to the kernel store. */
async function persistRun(result: SimulationResult): Promise<void> {
  await db.simulationRun.create({
    data: {
      runId: result.runId,
      kernelVersion: result.kernelVersion,
      scenario: JSON.stringify(result.scenario),
      result: JSON.stringify(result),
      amount: result.scenario.amount,
      currency: result.scenario.currency,
      preference: result.scenario.preference,
      buyerCountry: result.scenario.buyer.country,
      merchantCountry: result.scenario.merchant.country,
      riskScore: result.metrics.riskScore,
      costPercent: result.metrics.costPercent,
      settlementMs: result.metrics.settlementTimeMs,
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
